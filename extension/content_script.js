/**
 * GothamClean - Content Script
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
let processedElements = new WeakSet();

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
  // Skip if already processed
  if (processedElements.has(container)) return;

  // Check if it's a GothamChess video
  if (!isGothamChessVideo(container)) return;

  // Find video link and extract ID
  const videoLink = findVideoLink(container);
  const videoId = extractVideoId(videoLink);
  if (!videoId) return;

  // Check if we have a clean title for this video
  const titleData = titlesCache[videoId];
  if (!titleData) return;

  // Find and replace the title element
  const titleElement = findTitleElement(container);
  if (!titleElement) return;

  // Store original title for potential toggle feature
  const originalTitle = titleElement.textContent;
  if (originalTitle === titleData.clean_title) return;  // Already replaced

  // Replace the title
  titleElement.textContent = titleData.clean_title;
  titleElement.setAttribute('data-gothamclean-original', originalTitle);
  titleElement.setAttribute('data-gothamclean-replaced', 'true');

  // Mark as processed
  processedElements.add(container);
  replacedThisSession++;

  console.log(`[GothamClean] Replaced: "${originalTitle}" -> "${titleData.clean_title}"`);

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
    if (titleElement && !titleElement.getAttribute('data-gothamclean-replaced')) {
      const originalTitle = titleElement.textContent;
      if (originalTitle !== titleData.clean_title) {
        titleElement.textContent = titleData.clean_title;
        titleElement.setAttribute('data-gothamclean-original', originalTitle);
        titleElement.setAttribute('data-gothamclean-replaced', 'true');

        console.log(`[GothamClean] Watch page: "${originalTitle}" -> "${titleData.clean_title}"`);
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
    'ytd-compact-video-renderer',   // Sidebar / suggested videos
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
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }

    if (shouldScan) {
      // Debounce scanning
      clearTimeout(window.gothamCleanScanTimeout);
      window.gothamCleanScanTimeout = setTimeout(scanPage, 100);
    }
  });

  // Observe the main content area
  const targetNode = document.body;
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
  });

  return observer;
}

/**
 * Handle YouTube SPA navigation
 */
function setupNavigationListener() {
  // YouTube fires this event on SPA navigation
  window.addEventListener('yt-navigate-finish', () => {
    console.log('[GothamClean] Navigation detected, rescanning...');
    // Clear processed elements on navigation
    processedElements = new WeakSet();
    setTimeout(scanPage, 500);
  });

  // Also listen for popstate (back/forward)
  window.addEventListener('popstate', () => {
    processedElements = new WeakSet();
    setTimeout(scanPage, 500);
  });
}

/**
 * Initialize the content script
 */
async function init() {
  console.log('[GothamClean] Initializing content script...');

  // Get titles and settings from background
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getTitles' });
    titlesCache = response.titles || {};
    enabled = response.enabled !== false;

    console.log(`[GothamClean] Loaded ${Object.keys(titlesCache).length} titles, enabled: ${enabled}`);
  } catch (error) {
    console.error('[GothamClean] Failed to load titles:', error);
    return;
  }

  if (!enabled) {
    console.log('[GothamClean] Extension disabled, not scanning');
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
    console.log(`[GothamClean] Enabled changed to: ${enabled}`);
    if (enabled) {
      processedElements = new WeakSet();
      scanPage();
    }
  }

  if (changes.titles) {
    titlesCache = changes.titles.newValue || {};
    console.log(`[GothamClean] Titles updated: ${Object.keys(titlesCache).length} titles`);
    processedElements = new WeakSet();
    scanPage();
  }
});

// Start the extension
init();
