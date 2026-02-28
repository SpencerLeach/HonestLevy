/**
 * HonestLevy - Content Script
 *
 * Detects GothamChess video cards on YouTube and replaces clickbait titles
 * with clean, descriptive titles from the cached mapping.
 */

// GothamChess identifiers
const GOTHAMCHESS_CHANNEL_ID = 'UCQHX6ViZmPsWiYSFAyS0a3Q';
const GOTHAMCHESS_HANDLE = '@GothamChess';
const GOTHAMCHESS_NAMES = ['gothamchess', 'gotham chess', 'levy rozman'];

// State
let titlesCache = {};
let enabled = true;
let replacedThisSession = 0;
let processedVideoIds = new Map();  // container -> videoId (to detect content changes)

/**
 * Check if an element is visible in the viewport
 */
function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
}

/**
 * Check if we're currently on a GothamChess page
 */
function isOnGothamChessPage() {
  const url = window.location.href;
  return url.includes('/@GothamChess') ||
         url.includes('/c/GothamChess') ||
         url.includes('/channel/UCQHX6ViZmPsWiYSFAyS0a3Q');
}

/**
 * Extract video ID from a YouTube URL
 */
function extractVideoId(url) {
  if (!url) return null;

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Check if an element or its context indicates GothamChess
 */
function isGothamChessVideo(container) {
  // If we're on a GothamChess page, all videos are GothamChess videos
  if (isOnGothamChessPage()) {
    return true;
  }

  // Look for channel name in various locations
  const channelSelectors = [
    'ytd-channel-name',
    '#channel-name',
    '.ytd-channel-name',
    'a[href*="/@GothamChess"]',
    'a[href*="/channel/UCQHX6ViZmPsWiYSFAyS0a3Q"]',
    'a[href*="/c/GothamChess"]',
  ];

  for (const selector of channelSelectors) {
    const channelElement = container.querySelector(selector);
    if (channelElement) {
      const text = channelElement.textContent.toLowerCase();
      const href = channelElement.href || channelElement.querySelector('a')?.href || '';

      if (
        GOTHAMCHESS_NAMES.some(name => text.includes(name)) ||
        href.includes(GOTHAMCHESS_HANDLE) ||
        href.includes(GOTHAMCHESS_CHANNEL_ID)
      ) {
        return true;
      }
    }
  }

  // Check links in the container
  const links = container.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.href || '';
    if (
      href.includes(GOTHAMCHESS_HANDLE) ||
      href.includes(GOTHAMCHESS_CHANNEL_ID) ||
      href.includes('/c/GothamChess')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Find the title element within a video card
 */
function findTitleElement(container) {
  const titleSelectors = [
    '#video-title',
    'a#video-title',
    'h3 a#video-title',
    'yt-formatted-string#video-title',
    '.title-and-badge a',
    'span#video-title',
    // New yt-lockup-view-model selectors (2025 YouTube redesign)
    'a.yt-lockup-metadata-view-model-wiz__title',
    'a.yt-lockup-metadata-view-model__title',
    '.yt-lockup-metadata-view-model-wiz__title',
    '.yt-lockup-metadata-view-model__title',
  ];

  for (const selector of titleSelectors) {
    const element = container.querySelector(selector);
    if (element) return element;
  }

  return null;
}

/**
 * Find the video link to extract the video ID
 */
function findVideoLink(container) {
  const linkSelectors = [
    'a#video-title-link',
    'a#video-title',
    'a#thumbnail',
    'a[href*="/watch?v="]',
    'a[href*="/shorts/"]',
  ];

  for (const selector of linkSelectors) {
    const element = container.querySelector(selector);
    if (element?.href) return element.href;
  }

  return null;
}

/**
 * Replace the title of a video card if it's a GothamChess video
 */
function processVideoCard(container) {
  // Find video link and extract ID first
  const videoLink = findVideoLink(container);
  const videoId = extractVideoId(videoLink);
  if (!videoId) return;

  // Skip if this container already has this video processed
  if (processedVideoIds.get(container) === videoId) return;

  // Check if we have a clean title for this video - if so, it's a GothamChess video
  const titleData = titlesCache[videoId];
  if (!titleData) return;  // Not a GothamChess video

  // Find and replace the title element
  const titleElement = findTitleElement(container);
  if (!titleElement) return;

  // Only process visible elements to avoid cached/hidden DOM nodes
  if (!isElementVisible(container)) return;

  // Store original title for potential toggle feature
  const originalTitle = titleElement.textContent;
  if (originalTitle === titleData.clean_title) return;  // Already replaced

  // Replace the title
  titleElement.textContent = titleData.clean_title;
  titleElement.setAttribute('data-honestlevy-original', originalTitle);
  titleElement.setAttribute('data-honestlevy-replaced', 'true');

  // Mark as processed with this video ID
  processedVideoIds.set(container, videoId);
  replacedThisSession++;

  console.log(`[HonestLevy] Replaced (${videoId}): "${originalTitle.substring(0, 30)}..." -> "${titleData.clean_title.substring(0, 30)}..."`);

  // Update count in storage
  chrome.runtime.sendMessage({ type: 'incrementReplacedCount', count: 1 });
}

/**
 * Process the watch page title (when viewing a GothamChess video)
 */
function processWatchPageTitle() {
  // Check if we're on a watch page
  const url = window.location.href;
  const videoId = extractVideoId(url);
  if (!videoId) return;

  // Check if we have a clean title
  const titleData = titlesCache[videoId];
  if (!titleData) return;

  // Find the main video title
  const titleSelectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.title yt-formatted-string',
    'h1 yt-formatted-string.ytd-watch-metadata',
    '#title h1 yt-formatted-string',
  ];

  for (const selector of titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement) {
      // Check if already replaced for THIS video
      const replacedForVideo = titleElement.getAttribute('data-honestlevy-video-id');
      if (replacedForVideo === videoId) return;

      const originalTitle = titleElement.textContent;
      if (originalTitle !== titleData.clean_title) {
        titleElement.textContent = titleData.clean_title;
        titleElement.setAttribute('data-honestlevy-original', originalTitle);
        titleElement.setAttribute('data-honestlevy-video-id', videoId);

        console.log(`[HonestLevy] Watch page: "${originalTitle}" -> "${titleData.clean_title}"`);
        chrome.runtime.sendMessage({ type: 'incrementReplacedCount', count: 1 });
      }
      break;
    }
  }
}

/**
 * Scan the page for video cards and process them
 */
function scanPage() {
  if (!enabled) return;

  // Video card container selectors
  const containerSelectors = [
    'ytd-rich-item-renderer',       // Home page / channel page grid
    'ytd-video-renderer',           // Search results
    'ytd-compact-video-renderer',   // Sidebar / suggested videos (old)
    'yt-lockup-view-model',         // Sidebar / suggested videos (new)
    'ytd-grid-video-renderer',      // Channel page grid (older style)
    'ytd-playlist-video-renderer',  // Playlist items
  ];

  for (const selector of containerSelectors) {
    const containers = document.querySelectorAll(selector);
    containers.forEach(processVideoCard);
  }

  // Also process watch page title
  processWatchPageTitle();
}

/**
 * Set up MutationObserver to detect dynamically loaded content
 */
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    if (!enabled) return;

    let shouldScan = false;

    for (const mutation of mutations) {
      // Trigger on added nodes
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
      // Also trigger on attribute changes to video-related elements
      if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
        shouldScan = true;
        break;
      }
    }

    if (shouldScan) {
      // Debounce scanning
      clearTimeout(window.honestLevyScanTimeout);
      window.honestLevyScanTimeout = setTimeout(scanPage, 100);
    }
  });

  // Observe the main content area
  const targetNode = document.body;
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],  // Watch for link changes (indicates new video)
  });

  return observer;
}

/**
 * Handle YouTube SPA navigation
 */
function setupNavigationListener() {
  // YouTube fires this event on SPA navigation
  window.addEventListener('yt-navigate-finish', () => {
    console.log('[HonestLevy] Navigation detected, rescanning...');
    // Clear processed elements on navigation
    processedVideoIds.clear();
    setTimeout(scanPage, 500);
  });

  // Also listen for popstate (back/forward)
  window.addEventListener('popstate', () => {
    processedVideoIds.clear();
    setTimeout(scanPage, 500);
  });

  // Rescan on scroll (debounced) to catch newly visible elements
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(scanPage, 200);
  }, { passive: true });
}

/**
 * Initialize the content script
 */
async function init() {
  console.log('[HonestLevy] Initializing content script...');

  // Get titles and settings from background
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getTitles' });
    titlesCache = response.titles || {};
    enabled = response.enabled !== false;

    console.log(`[HonestLevy] Loaded ${Object.keys(titlesCache).length} titles, enabled: ${enabled}`);
  } catch (error) {
    console.error('[HonestLevy] Failed to load titles:', error);
    return;
  }

  if (!enabled) {
    console.log('[HonestLevy] Extension disabled, not scanning');
    return;
  }

  // Initial scan
  scanPage();

  // Set up observer for dynamic content
  setupObserver();

  // Handle SPA navigation
  setupNavigationListener();
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    console.log(`[HonestLevy] Enabled changed to: ${enabled}`);
    if (enabled) {
      processedVideoIds.clear();
      scanPage();
    }
  }

  if (changes.titles) {
    titlesCache = changes.titles.newValue || {};
    console.log(`[HonestLevy] Titles updated: ${Object.keys(titlesCache).length} titles`);
    processedVideoIds.clear();
    scanPage();
  }
});

// Start the extension
init();
