/**
 * HonestLevy - Popup Script
 */

// DOM elements
const enableToggle = document.getElementById('enableToggle');
const titleCount = document.getElementById('titleCount');
const replacedCount = document.getElementById('replacedCount');
const lastUpdated = document.getElementById('lastUpdated');
const refreshBtn = document.getElementById('refreshBtn');
const status = document.getElementById('status');

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';

  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Show status message
 */
function showStatus(message, type = '') {
  status.textContent = message;
  status.className = 'status ' + type;

  if (type) {
    setTimeout(() => {
      status.textContent = '';
      status.className = 'status';
    }, 3000);
  }
}

/**
 * Load and display current state
 */
async function loadState() {
  const result = await chrome.storage.local.get([
    'enabled',
    'titles',
    'titleCount',
    'replacedCount',
    'lastUpdated'
  ]);

  enableToggle.checked = result.enabled !== false;
  titleCount.textContent = result.titleCount || Object.keys(result.titles || {}).length || 0;
  replacedCount.textContent = result.replacedCount || 0;
  lastUpdated.textContent = formatRelativeTime(result.lastUpdated);
}

/**
 * Handle enable toggle change
 */
enableToggle.addEventListener('change', async () => {
  const enabled = enableToggle.checked;
  await chrome.storage.local.set({ enabled });
  showStatus(enabled ? 'Enabled' : 'Disabled', 'success');
});

/**
 * Handle refresh button click
 */
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  showStatus('Refreshing...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'refreshTitles' });

    if (response.success) {
      showStatus('Titles refreshed!', 'success');
      await loadState();
    } else {
      showStatus('Failed to refresh', 'error');
    }
  } catch (error) {
    showStatus('Error: ' + error.message, 'error');
  }

  refreshBtn.disabled = false;
});

/**
 * Listen for storage changes to update UI
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  if (changes.replacedCount) {
    replacedCount.textContent = changes.replacedCount.newValue || 0;
  }
  if (changes.titleCount) {
    titleCount.textContent = changes.titleCount.newValue || 0;
  }
  if (changes.lastUpdated) {
    lastUpdated.textContent = formatRelativeTime(changes.lastUpdated.newValue);
  }
});

// Initialize
loadState();
