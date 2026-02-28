#!/usr/bin/env python3
"""
Backfill clean titles for GothamChess's entire video catalog.

Uses the YouTube Data API to paginate through all uploads and generates
clean titles using Claude Haiku. Processes in batches with progress saving.
"""

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import anthropic
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import WebshareProxyConfig

from generate_titles import (
    GOTHAMCHESS_CHANNEL_ID,
    TITLES_JSON_PATH,
    load_prompt,
    load_titles,
    save_titles,
    TRANSCRIPT_WORD_LIMIT,
)

# Configuration
BATCH_SIZE = 50  # Save progress every N videos
DELAY_BETWEEN_VIDEOS = 2  # Seconds between requests (can be lower with proxy)
DELAY_BETWEEN_BATCHES = 3  # Seconds between batches
PROGRESS_FILE = Path(__file__).parent / "backfill_progress.json"

# Webshare rotating residential proxy credentials
WEBSHARE_USERNAME = os.environ.get("WEBSHARE_USERNAME", "")
WEBSHARE_PASSWORD = os.environ.get("WEBSHARE_PASSWORD", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def get_transcript_with_proxy(video_id: str) -> Optional[str]:
    """Fetch transcript using Webshare proxy to avoid rate limiting."""
    try:
        if WEBSHARE_USERNAME and WEBSHARE_PASSWORD:
            proxy_config = WebshareProxyConfig(
                proxy_username=WEBSHARE_USERNAME,
                proxy_password=WEBSHARE_PASSWORD,
            )
            ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
        else:
            # Fall back to no proxy
            ytt_api = YouTubeTranscriptApi()

        transcript_data = ytt_api.fetch(video_id, languages=['en'])

        # Join transcript text
        full_text = " ".join(entry.text for entry in transcript_data)

        # Limit to first N words
        words = full_text.split()
        limited_text = " ".join(words[:TRANSCRIPT_WORD_LIMIT])

        return limited_text

    except Exception as e:
        logger.warning(f"Could not get transcript for {video_id}: {e}")
        return None


def load_progress() -> Dict:
    """Load backfill progress."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"next_page_token": None, "processed_count": 0}


def save_progress(progress: Dict) -> None:
    """Save backfill progress."""
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, indent=2)


def get_uploads_playlist_id(youtube) -> str:
    """Get the uploads playlist ID for the channel."""
    response = youtube.channels().list(
        part="contentDetails",
        id=GOTHAMCHESS_CHANNEL_ID,
    ).execute()

    if not response.get("items"):
        raise ValueError(f"Channel not found: {GOTHAMCHESS_CHANNEL_ID}")

    return response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]


def fetch_videos_page(youtube, playlist_id: str, page_token: Optional[str] = None) -> Tuple[List[Dict], Optional[str]]:
    """Fetch a page of videos from the uploads playlist, filtering out Shorts."""
    request = youtube.playlistItems().list(
        part="snippet",
        playlistId=playlist_id,
        maxResults=50,
        pageToken=page_token,
    )
    response = request.execute()

    # Get video IDs
    video_ids = []
    video_data = {}
    for item in response.get("items", []):
        snippet = item.get("snippet", {})
        video_id = snippet.get("resourceId", {}).get("videoId")
        if video_id:
            video_ids.append(video_id)
            video_data[video_id] = {
                "video_id": video_id,
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "published": snippet.get("publishedAt", ""),
            }

    # Get video durations to filter out Shorts
    if video_ids:
        details_response = youtube.videos().list(
            part="contentDetails",
            id=",".join(video_ids),
        ).execute()

        for item in details_response.get("items", []):
            video_id = item["id"]
            duration = item.get("contentDetails", {}).get("duration", "PT0S")
            video_data[video_id]["duration"] = duration

    # Filter: keep only videos > 60 seconds (not Shorts)
    videos = []
    for video_id in video_ids:
        data = video_data[video_id]
        duration = data.get("duration", "PT0S")
        # Parse ISO 8601 duration (e.g., PT1M30S, PT10M, PT1H2M3S)
        seconds = parse_duration(duration)
        if seconds > 60:
            videos.append(data)
            logger.debug(f"Including {data['title'][:40]} ({seconds}s)")
        else:
            logger.info(f"Skipping Short: {data['title'][:40]} ({seconds}s)")

    next_page_token = response.get("nextPageToken")
    return videos, next_page_token


def parse_duration(duration: str) -> int:
    """Parse ISO 8601 duration to seconds."""
    import re
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def generate_clean_title(
    client: anthropic.Anthropic,
    system_prompt: str,
    original_title: str,
    transcript: Optional[str],
    description: str = "",
    retries: int = 1,
) -> Optional[Dict]:
    """Generate a clean title using Claude Haiku with retry logic."""
    import json
    import re

    # Build user prompt
    if transcript:
        user_content = f"""Original title: {original_title}

Transcript excerpt (first ~500 words):
{transcript}

Generate the clean title JSON."""
    else:
        user_content = f"""Original title: {original_title}

Description: {description[:500] if description else "No description available."}

Note: No transcript available for this video. Generate the best title you can from the original title and description.

Generate the clean title JSON."""

    for attempt in range(retries + 1):
        try:
            response = client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=150,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )

            response_text = response.content[0].text.strip()

            # Try to parse as JSON
            try:
                result = json.loads(response_text)
                if "tag" in result and "title" in result:
                    return result
            except json.JSONDecodeError:
                # Try to extract JSON from response with regex
                json_match = re.search(r'\{.*?\}', response_text, re.DOTALL)
                if json_match:
                    try:
                        result = json.loads(json_match.group())
                        if "tag" in result and "title" in result:
                            return result
                    except json.JSONDecodeError:
                        pass  # Fall through to warning

            logger.warning(f"Invalid response format (attempt {attempt + 1}): {response_text[:100]}")

        except anthropic.APIError as e:
            logger.warning(f"API error (attempt {attempt + 1}): {e}")
            if attempt < retries:
                time.sleep(2)

    return None


def process_video(
    client: anthropic.Anthropic,
    system_prompt: str,
    video: Dict,
) -> Optional[Dict]:
    """Process a single video and return its title entry."""
    video_id = video["video_id"]
    original_title = video["title"]

    # Skip deleted/private videos
    if original_title in ["Deleted video", "Private video"]:
        logger.info(f"Skipping {video_id}: {original_title}")
        return None

    logger.info(f"Processing: {original_title} ({video_id})")

    # Get transcript - REQUIRED for quality titles
    transcript = get_transcript_with_proxy(video_id)

    # Skip videos without transcripts (Shorts, etc.) - don't generate garbage
    if not transcript:
        logger.info(f"Skipping {video_id}: No transcript available (likely a Short)")
        return None

    # Generate clean title
    result = generate_clean_title(
        client=client,
        system_prompt=system_prompt,
        original_title=original_title,
        transcript=transcript,
        description=video.get("description", ""),
    )

    if result:
        clean_title = f"[{result['tag']}] {result['title']}"
        return {
            "clean_title": clean_title,
            "tag": result["tag"],
            "original_title": original_title,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # Skip if generation failed - don't save garbage
    logger.warning(f"Skipping {video_id}: Title generation failed")
    return None


def main():
    """Main entry point."""
    # Check for API keys
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    youtube_key = os.environ.get("YOUTUBE_API_KEY")

    if not anthropic_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    if not youtube_key:
        logger.error("YOUTUBE_API_KEY environment variable not set")
        sys.exit(1)

    # Initialize clients
    anthropic_client = anthropic.Anthropic(api_key=anthropic_key)
    youtube = build("youtube", "v3", developerKey=youtube_key)

    # Load existing data
    titles = load_titles()
    system_prompt = load_prompt()
    progress = load_progress()

    logger.info(f"Loaded {len(titles)} existing titles")
    logger.info(f"Resuming from progress: {progress['processed_count']} videos processed")

    try:
        # Get uploads playlist ID
        uploads_playlist_id = get_uploads_playlist_id(youtube)
        logger.info(f"Uploads playlist ID: {uploads_playlist_id}")

        page_token = progress["next_page_token"]
        total_processed = progress["processed_count"]
        batch_count = 0

        while True:
            # Fetch a page of videos
            videos, next_page_token = fetch_videos_page(youtube, uploads_playlist_id, page_token)

            if not videos:
                logger.info("No more videos to process")
                break

            logger.info(f"Fetched {len(videos)} videos (page token: {page_token})")

            # Process each video
            for video in videos:
                video_id = video["video_id"]

                # Skip if already processed
                if video_id in titles:
                    logger.debug(f"Skipping {video_id} (already processed)")
                    continue

                # Process video
                entry = process_video(anthropic_client, system_prompt, video)
                if entry:
                    titles[video_id] = entry
                    total_processed += 1
                    batch_count += 1
                    logger.info(f"[{total_processed}] Generated: {entry['clean_title']}")

                # Rate limiting
                time.sleep(DELAY_BETWEEN_VIDEOS)

                # Save progress every batch
                if batch_count >= BATCH_SIZE:
                    save_titles(titles)
                    progress["processed_count"] = total_processed
                    progress["next_page_token"] = page_token
                    save_progress(progress)
                    logger.info(f"Saved progress: {total_processed} total processed")
                    batch_count = 0
                    time.sleep(DELAY_BETWEEN_BATCHES)

            # Move to next page
            page_token = next_page_token
            if not page_token:
                logger.info("Reached end of uploads")
                break

        # Final save
        save_titles(titles)
        progress["processed_count"] = total_processed
        progress["next_page_token"] = None
        save_progress(progress)

        logger.info(f"Backfill complete! Total videos in database: {len(titles)}")

    except HttpError as e:
        logger.error(f"YouTube API error: {e}")
        # Save progress before exiting
        save_titles(titles)
        save_progress(progress)
        logger.info("Progress saved. Run again to resume.")
        sys.exit(1)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        save_titles(titles)
        save_progress(progress)
        logger.info("Progress saved. Run again to resume.")
        sys.exit(0)


if __name__ == "__main__":
    main()
