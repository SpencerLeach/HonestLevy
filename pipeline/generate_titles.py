#!/usr/bin/env python3
"""
Generate clean titles for new GothamChess videos.

Fetches the RSS feed, pulls transcripts, and uses Claude Haiku to generate
accurate, descriptive titles. Updates titles.json with new entries.
"""

import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import anthropic
import feedparser
from youtube_transcript_api import YouTubeTranscriptApi

# Configuration
GOTHAMCHESS_CHANNEL_ID = "UCQHX6ViZmPsWiYSFAyS0a3Q"
RSS_FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={GOTHAMCHESS_CHANNEL_ID}"
TITLES_JSON_PATH = Path(__file__).parent.parent / "titles.json"
PROMPT_PATH = Path(__file__).parent / "prompt.txt"
TRANSCRIPT_WORD_LIMIT = 500

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def load_titles() -> Dict:
    """Load existing titles from titles.json."""
    if TITLES_JSON_PATH.exists():
        with open(TITLES_JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_titles(titles: Dict) -> None:
    """Save titles to titles.json."""
    with open(TITLES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(titles, f, indent=2, ensure_ascii=False)


def load_prompt() -> str:
    """Load the system prompt from prompt.txt."""
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read().strip()


def extract_video_id(url: str) -> Optional[str]:
    """Extract video ID from a YouTube URL."""
    patterns = [
        r"[?&]v=([a-zA-Z0-9_-]{11})",
        r"youtu\.be/([a-zA-Z0-9_-]{11})",
        r"/shorts/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_rss_feed() -> List[Dict]:
    """Fetch and parse the GothamChess RSS feed."""
    logger.info(f"Fetching RSS feed: {RSS_FEED_URL}")
    feed = feedparser.parse(RSS_FEED_URL)

    videos = []
    for entry in feed.entries:
        video_id = entry.get("yt_videoid")
        if not video_id:
            video_id = extract_video_id(entry.get("link", ""))

        if video_id:
            videos.append({
                "video_id": video_id,
                "title": entry.get("title", ""),
                "description": entry.get("summary", ""),
                "published": entry.get("published", ""),
            })

    logger.info(f"Found {len(videos)} videos in RSS feed")
    return videos


def get_transcript(video_id: str) -> Optional[str]:
    """Fetch transcript for a video."""
    try:
        # New API v1.x: instantiate then fetch
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


def generate_clean_title(
    client: anthropic.Anthropic,
    system_prompt: str,
    original_title: str,
    transcript: Optional[str],
    description: str = "",
) -> Optional[Dict]:
    """Generate a clean title using Claude Haiku."""

    # Build user prompt
    if transcript:
        user_content = f"""Original title: {original_title}

Transcript excerpt (first ~500 words):
{transcript}

Generate the clean title JSON."""
    else:
        user_content = f"""Original title: {original_title}

Description: {description}

Note: No transcript available for this video. Generate the best title you can from the original title and description.

Generate the clean title JSON."""

    try:
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=150,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )

        # Extract JSON from response
        response_text = response.content[0].text.strip()

        # Try to parse as JSON
        try:
            result = json.loads(response_text)
            if "tag" in result and "title" in result:
                return result
        except json.JSONDecodeError:
            # Try to extract JSON from response if it has extra text
            json_match = re.search(r'\{[^}]+\}', response_text)
            if json_match:
                result = json.loads(json_match.group())
                if "tag" in result and "title" in result:
                    return result

        logger.warning(f"Invalid response format: {response_text}")
        return None

    except anthropic.APIError as e:
        logger.error(f"API error: {e}")
        return None


def process_video(
    client: anthropic.Anthropic,
    system_prompt: str,
    video: Dict,
) -> Optional[Dict]:
    """Process a single video and return its title entry."""
    video_id = video["video_id"]
    original_title = video["title"]

    logger.info(f"Processing: {original_title} ({video_id})")

    # Get transcript
    transcript = get_transcript(video_id)

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

    # Fallback if generation failed
    logger.warning(f"Using fallback title for {video_id}")
    return {
        "clean_title": f"[GothamChess] {original_title}",
        "tag": "Misc",
        "original_title": original_title,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    """Main entry point."""
    # Check for API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    # Initialize client
    client = anthropic.Anthropic(api_key=api_key)

    # Load existing titles and prompt
    titles = load_titles()
    system_prompt = load_prompt()

    logger.info(f"Loaded {len(titles)} existing titles")

    # Fetch RSS feed
    videos = fetch_rss_feed()

    # Process new videos
    new_count = 0
    for video in videos:
        video_id = video["video_id"]

        if video_id in titles:
            logger.debug(f"Skipping {video_id} (already processed)")
            continue

        entry = process_video(client, system_prompt, video)
        if entry:
            titles[video_id] = entry
            new_count += 1
            logger.info(f"Generated: {entry['clean_title']}")

    # Save updated titles
    if new_count > 0:
        save_titles(titles)
        logger.info(f"Added {new_count} new titles")
    else:
        logger.info("No new videos to process")

    return new_count


if __name__ == "__main__":
    main()
