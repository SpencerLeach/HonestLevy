/**
 * GothamClean - Background Service Worker
 *
 * Fetches and caches the titles.json mapping from GitHub.
 * Refreshes every 6 hours to pick up new titles.
 */

// Configuration - UPDATE THIS with your actual GitHub repo
const TITLES_JSON_URL = 'https://raw.githubusercontent.com/SpencerLeach/HonestLevy/main/titles.json';
const REFRESH_INTERVAL_HOURS = 6;
const ALARM_NAME = 'refreshTitles';

/**
 * Fetch titles from GitHub and store in chrome.storage.local
 */
async function fetchAndCacheTitles() {
  try {
    console.log('[GothamClean] Fetching titles from GitHub...');

    const response = await fetch(TITLES_JSON_URL, {
      cache: 'no-store'  // Bypass cache to get fresh data
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const titles = await response.json();
    const titleCount = Object.keys(titles).length;

    await chrome.storage.local.set({
      titles: titles,
      lastUpdated: Date.now(),
      titleCount: titleCount
    });

    console.log(`[GothamClean] Cached ${titleCount} titles`);
    return true;

  } catch (error) {
    console.error('[GothamClean] Failed to fetch titles:', error);
    return false;
  }
}

/**
 * Initialize the extension on install
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[GothamClean] Extension installed/updated:', details.reason);

  // Set default settings
  await chrome.storage.local.set({
    enabled: true,
    showIndicator: true,
    replacedCount: 0
  });

  // Fetch titles immediately
  await fetchAndCacheTitles();

  // Set up periodic refresh alarm
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_HOURS * 60
  });
});

/**
 * Handle alarm for periodic refresh
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[GothamClean] Periodic refresh triggered');
    await fetchAndCacheTitles();
  }
});

/**
 * Handle messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getTitles') {
    chrome.storage.local.get(['titles', 'enabled'], (result) => {
      sendResponse({
        titles: result.titles || {},
        enabled: result.enabled !== false  // Default to enabled
      });
    });
    return true;  // Keep channel open for async response
  }

  if (message.type === 'incrementReplacedCount') {
    chrome.storage.local.get(['replacedCount'], (result) => {
      const newCount = (result.replacedCount || 0) + (message.count || 1);
      chrome.storage.local.set({ replacedCount: newCount });
      sendResponse({ count: newCount });
    });
    return true;
  }

  if (message.type === 'refreshTitles') {
    fetchAndCacheTitles().then((success) => {
      sendResponse({ success });
    });
    return true;
  }
});

/**
 * On startup, ensure we have titles cached
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[GothamClean] Browser started');

  const result = await chrome.storage.local.get(['titles', 'lastUpdated']);

  // Refresh if no titles or data is stale (older than refresh interval)
  const staleThreshold = REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
  const isStale = !result.lastUpdated || (Date.now() - result.lastUpdated) > staleThreshold;

  if (!result.titles || isStale) {
    await fetchAndCacheTitles();
  }
});
