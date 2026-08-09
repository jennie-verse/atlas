import * as Sync from '../../shared/v1/sync.js';

const STORAGE_KEYS = Object.freeze({
  token: 'sync.token.v1',
  cache: 'atlas.cache.v1',
  fontSize: 'atlas.font-size.v1'
});

const CONFIG_BASE = Object.freeze({
  owner: 'jennie-verse',
  repo: 'webapp-data',
  branch: 'main'
});

const FONT_SIZES = Object.freeze([6, 8, 10, 12, 14, 17]);
const DEFAULT_FONT_SIZE = 12;
const RECENT_LIMIT = 20;

const PARSERS = Object.freeze({
  // tide 는 현재 운영 중인 데이터원입니다.
  // 만료된 항목만 tide/archive/<YYYY-MM>.json 배열로 쌓입니다.
  // 레코드 모양: { id, kind: 'clip'|'dump', text, createdAt, archivedAt }
  tide: Object.freeze({
    appUrl: '../tide/',
    async listFiles(config, folderPath) {
      const entries = await Sync.listDir(config, `${folderPath}/archive`);
      return entries.filter((entry) => (
        entry.type === 'file' && /^\d{4}-\d{2}\.json$/.test(entry.name)
      ));
    },
    parse(files) {
      const newestItems = new Map();
      const errors = [];

      for (const file of files) {
        let payload;
        try {
          payload = JSON.parse(file.content);
          if (!Array.isArray(payload)) {
            throw new TypeError('Unexpected tide archive shape');
          }
        } catch {
          errors.push(file.name);
          continue;
        }

        for (const rawItem of payload) {
          if (!rawItem || typeof rawItem !== 'object' || typeof rawItem.id !== 'string' || typeof rawItem.text !== 'string') {
            continue;
          }

          const item = {
            id: rawItem.id,
            text: rawItem.text,
            kind: rawItem.kind === 'dump' ? 'dump' : 'clip',
            createdAt: validIsoString(rawItem.createdAt),
            archivedAt: validIsoString(rawItem.archivedAt)
          };

          // 같은 id 가 여러 달 파일에 남아 있으면 가장 나중에 보관된 것을 씁니다.
          const previous = newestItems.get(item.id);
          if (!previous || dateValue(item.archivedAt) > dateValue(previous.archivedAt)) {
            newestItems.set(item.id, item);
          }
        }
      }

      const items = [];
      for (const item of newestItems.values()) {
        const firstLine = item.text.split(/\r?\n/, 1)[0].trim();
        items.push({
          id: item.id,
          title: firstLine || (item.kind === 'dump' ? 'Untitled note' : 'Untitled clip'),
          snippet: item.text,
          date: item.archivedAt || item.createdAt,
          source: 'tide',
          text: item.text,
          label: item.kind === 'dump' ? 'Dump' : 'Clip',
          pinned: false,
          appUrl: '../tide/'
        });
      }

      return { items, errors };
    }
  }),
  // clip 은 은퇴한 앱입니다. webapp-data 의 clip/ 폴더가 남아 있는 동안에만
  // 과거 기록을 계속 검색할 수 있도록 파서를 유지합니다.
  // clip/ 폴더를 지우면 listDir 이 빈 배열을 돌려주므로 이 파서는 조용히 비활성화됩니다.
  clip: Object.freeze({
    appUrl: '../tide/',
    async listFiles(config, folderPath) {
      const entries = await Sync.listDir(config, folderPath);
      return entries.filter((entry) => (
        entry.type === 'file' && /^data\.[^/]+\.json$/i.test(entry.name)
      ));
    },
    parse(files) {
      const newestItems = new Map();
      const newestTombstones = new Map();
      const errors = [];

      for (const file of files) {
        let payload;
        try {
          payload = JSON.parse(file.content);
          if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items) || !Array.isArray(payload.deleted)) {
            throw new TypeError('Unexpected clip data shape');
          }
        } catch {
          errors.push(file.name);
          continue;
        }

        for (const rawItem of payload.items) {
          if (!rawItem || typeof rawItem !== 'object' || typeof rawItem.id !== 'string' || typeof rawItem.text !== 'string') {
            continue;
          }

          const item = {
            id: rawItem.id,
            text: rawItem.text,
            label: typeof rawItem.label === 'string' ? rawItem.label : '',
            type: typeof rawItem.type === 'string' ? rawItem.type : 'text',
            pinned: rawItem.pinned === true,
            createdAt: validIsoString(rawItem.createdAt),
            usedAt: validIsoString(rawItem.usedAt),
            useCount: Number.isFinite(rawItem.useCount) ? rawItem.useCount : 0,
            updatedAt: validIsoString(rawItem.updatedAt) || validIsoString(rawItem.createdAt)
          };

          const previous = newestItems.get(item.id);
          if (!previous || dateValue(item.updatedAt) > dateValue(previous.updatedAt)) {
            newestItems.set(item.id, item);
          }
        }

        for (const rawTombstone of payload.deleted) {
          if (!rawTombstone || typeof rawTombstone.id !== 'string') continue;
          const at = validIsoString(rawTombstone.at);
          if (!at) continue;
          const previousAt = newestTombstones.get(rawTombstone.id);
          if (!previousAt || dateValue(at) > dateValue(previousAt)) {
            newestTombstones.set(rawTombstone.id, at);
          }
        }
      }

      const items = [];
      for (const item of newestItems.values()) {
        const deletedAt = newestTombstones.get(item.id);
        if (deletedAt && dateValue(deletedAt) > dateValue(item.updatedAt)) continue;

        const firstLine = item.text.split(/\r?\n/, 1)[0].trim();
        items.push({
          id: item.id,
          title: item.label || firstLine || 'Untitled clip',
          snippet: item.text,
          date: item.updatedAt || item.usedAt || item.createdAt,
          source: 'clip',
          text: item.text,
          label: item.label,
          pinned: item.pinned,
          appUrl: '../tide/'
        });
      }

      return { items, errors };
    }
  })
});

const state = {
  items: [],
  query: '',
  refreshedAt: null,
  lastError: '',
  parseErrors: [],
  refreshing: false,
  fontSize: DEFAULT_FONT_SIZE,
  mainScrollY: 0,
  toastTimer: 0
};

const elements = {
  mainView: document.querySelector('#main-view'),
  settingsView: document.querySelector('#settings-view'),
  openSettings: document.querySelector('#open-settings'),
  emptySettings: document.querySelector('#empty-settings'),
  closeSettings: document.querySelector('#close-settings'),
  searchInput: document.querySelector('#search-input'),
  clearSearch: document.querySelector('#clear-search'),
  connectionBanner: document.querySelector('#connection-banner'),
  resultsHeading: document.querySelector('#results-heading'),
  resultsSummary: document.querySelector('#results-summary'),
  refreshIndicator: document.querySelector('#refresh-indicator'),
  resultsList: document.querySelector('#results-list'),
  emptyState: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-title'),
  emptyMessage: document.querySelector('#empty-message'),
  tokenInput: document.querySelector('#token-input'),
  tokenStatus: document.querySelector('#token-status'),
  saveToken: document.querySelector('#save-token'),
  clearToken: document.querySelector('#clear-token'),
  refreshData: document.querySelector('#refresh-data'),
  refreshDataLabel: document.querySelector('#refresh-data span'),
  lastRefreshed: document.querySelector('#last-refreshed'),
  lastError: document.querySelector('#last-error'),
  fontSizeOptions: document.querySelector('#font-size-options'),
  resetSize: document.querySelector('#reset-size'),
  toast: document.querySelector('#toast')
};

function validIsoString(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function dateValue(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase();
}

function sanitizeCachedItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object' || typeof rawItem.id !== 'string' || typeof rawItem.text !== 'string') {
    return null;
  }

  const source = typeof rawItem.source === 'string' && PARSERS[rawItem.source] ? rawItem.source : 'tide';
  return {
    id: rawItem.id,
    title: typeof rawItem.title === 'string' ? rawItem.title : '',
    snippet: typeof rawItem.snippet === 'string' ? rawItem.snippet : rawItem.text,
    date: validIsoString(rawItem.date),
    source,
    text: rawItem.text,
    label: typeof rawItem.label === 'string' ? rawItem.label : '',
    pinned: rawItem.pinned === true,
    appUrl: PARSERS[source].appUrl
  };
}

function loadCache() {
  const raw = readStorage(STORAGE_KEYS.cache);
  if (!raw) return;

  try {
    const cached = JSON.parse(raw);
    if (!cached || cached.version !== 1 || !Array.isArray(cached.items)) return;
    state.items = cached.items.map(sanitizeCachedItem).filter(Boolean).sort(compareItems);
    state.refreshedAt = validIsoString(cached.refreshedAt);
    state.lastError = typeof cached.lastError === 'string' ? cached.lastError : '';
    state.parseErrors = Array.isArray(cached.parseErrors)
      ? cached.parseErrors.filter((name) => typeof name === 'string')
      : [];
  } catch {
    state.items = [];
  }
}

function saveCache() {
  return writeStorage(STORAGE_KEYS.cache, JSON.stringify({
    version: 1,
    refreshedAt: state.refreshedAt,
    lastError: state.lastError,
    parseErrors: state.parseErrors,
    items: state.items
  }));
}

function compareItems(a, b) {
  return dateValue(b.date) - dateValue(a.date) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id);
}

function relativeDate(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return 'unknown';

  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startToday - startDate) / 86400000);
  if (days <= 0) return 'today';
  return `${days}d ago`;
}

function formattedRefreshTime(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function makeIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (name === 'open') {
    path.setAttribute('d', 'M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6');
    path.setAttribute('fill', 'none');
  } else {
    path.setAttribute('d', 'm14.2 3 6.8 6.8-3.2 1.1-3.8 3.8.2 4.3-1.4 1.4-4.1-4.1-3.3-3.3 1.4-1.4 4.3.2 3.8-3.8L14.2 3Z');
    path.setAttribute('fill', 'currentColor');
  }
  svg.append(path);
  return svg;
}

function createResultRow(item) {
  const row = document.createElement('article');
  row.className = 'result-row';

  const copyButton = document.createElement('button');
  copyButton.className = 'copy-result';
  copyButton.type = 'button';
  copyButton.setAttribute('aria-label', `Copy ${item.source} item`);
  copyButton.addEventListener('click', () => copyText(item.text));

  const topLine = document.createElement('div');
  topLine.className = 'result-topline';

  const badge = document.createElement('span');
  badge.className = 'source-badge';
  badge.textContent = item.source;
  topLine.append(badge);

  if (item.label) {
    const label = document.createElement('span');
    label.className = 'label-text';
    label.textContent = item.label;
    topLine.append(label);
  }

  const spacer = document.createElement('span');
  spacer.className = 'row-spacer';
  topLine.append(spacer);

  const date = document.createElement('time');
  date.className = 'date-text';
  if (item.date) date.dateTime = item.date;
  date.textContent = relativeDate(item.date);
  topLine.append(date);

  if (item.pinned) {
    const pinned = document.createElement('span');
    pinned.className = 'pinned-text';
    pinned.append(makeIcon('pin'));
    const pinnedLabel = document.createElement('span');
    pinnedLabel.textContent = 'Pinned';
    pinned.append(pinnedLabel);
    topLine.append(pinned);
  }

  const preview = document.createElement('p');
  preview.className = 'result-preview';
  preview.textContent = item.text;
  copyButton.append(topLine, preview);

  const openLink = document.createElement('a');
  openLink.className = 'open-app-link';
  openLink.href = item.appUrl;
  openLink.setAttribute('aria-label', `Open ${item.source}`);
  openLink.append(makeIcon('open'));

  row.append(copyButton, openLink);
  return row;
}

function filteredItems() {
  const query = normalizeSearchText(state.query.trim());
  if (!query) return state.items.slice(0, RECENT_LIMIT);

  return state.items.filter((item) => {
    const haystack = normalizeSearchText(`${item.text}\n${item.label}`);
    return haystack.includes(query);
  });
}

function renderResults() {
  const visibleItems = filteredItems();
  const hasQuery = state.query.trim().length > 0;
  elements.resultsHeading.textContent = hasQuery ? 'Search results' : 'Recent';
  elements.resultsSummary.textContent = hasQuery
    ? `${visibleItems.length} ${visibleItems.length === 1 ? 'match' : 'matches'}`
    : `${visibleItems.length} recent ${visibleItems.length === 1 ? 'item' : 'items'}`;

  elements.resultsList.replaceChildren();
  for (const item of visibleItems) {
    elements.resultsList.append(createResultRow(item));
  }

  const showEmpty = visibleItems.length === 0;
  elements.resultsList.hidden = showEmpty;
  elements.emptyState.hidden = !showEmpty;

  if (!showEmpty) return;

  const token = readStorage(STORAGE_KEYS.token);
  if (hasQuery) {
    elements.emptyTitle.textContent = 'No matches';
    elements.emptyMessage.textContent = 'Try a shorter word or a different label.';
    elements.emptySettings.hidden = true;
  } else if (!token) {
    elements.emptyTitle.textContent = 'Connect Atlas';
    elements.emptyMessage.textContent = 'Add a GitHub token in Settings, then refresh your data.';
    elements.emptySettings.hidden = false;
  } else {
    elements.emptyTitle.textContent = 'No data found';
    elements.emptyMessage.textContent = 'Refresh again or check the last error in Settings.';
    elements.emptySettings.hidden = false;
  }
}

function renderConnectionBanner() {
  elements.connectionBanner.replaceChildren();
  const token = readStorage(STORAGE_KEYS.token);

  if (!navigator.onLine) {
    elements.connectionBanner.textContent = 'Offline — showing cached data';
    elements.connectionBanner.hidden = false;
    return;
  }

  if (!token && state.items.length > 0) {
    elements.connectionBanner.append(document.createTextNode('Token missing — showing cached data.'));
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.textContent = 'Settings';
    settingsButton.addEventListener('click', openSettingsView);
    elements.connectionBanner.append(settingsButton);
    elements.connectionBanner.hidden = false;
    return;
  }

  elements.connectionBanner.hidden = true;
}

function renderSettings() {
  const token = readStorage(STORAGE_KEYS.token);
  elements.tokenStatus.textContent = token
    ? `Saved token ending in ${token.slice(-4)}`
    : 'No token saved.';
  elements.clearToken.disabled = !token;
  elements.lastRefreshed.textContent = formattedRefreshTime(state.refreshedAt);
  elements.lastError.textContent = state.lastError || 'No errors';
  elements.lastError.classList.toggle('has-error', Boolean(state.lastError));

  for (const option of elements.fontSizeOptions.querySelectorAll('button[data-size]')) {
    option.setAttribute('aria-checked', String(Number(option.dataset.size) === state.fontSize));
  }
}

function render() {
  renderResults();
  renderConnectionBanner();
  renderSettings();
  elements.refreshIndicator.hidden = !state.refreshing;
  elements.refreshData.disabled = state.refreshing;
  elements.refreshDataLabel.textContent = state.refreshing ? 'Refreshing…' : 'Refresh';
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

async function copyText(text) {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch {
    showToast('Copy failed. Touch and hold the text to copy manually.', true);
  }
}

function errorMessage(error) {
  if (error instanceof Sync.SyncError && error.type === 'auth') {
    return 'Token may be expired or lacks permission';
  }
  if (!navigator.onLine || (error instanceof Sync.SyncError && error.type === 'network')) {
    return 'Network request failed. Cached data is still available.';
  }
  return 'Refresh failed. Check the token and repository access.';
}

async function loadFolder(config, folderEntry) {
  const parser = PARSERS[folderEntry.name];
  const jsonEntries = await parser.listFiles(config, folderEntry.path);

  const files = (await Promise.all(jsonEntries.map(async (entry) => {
    const file = await Sync.readFile(config, entry.path);
    if (!file.exists || typeof file.content !== 'string') return null;
    return { name: entry.name, content: file.content };
  }))).filter(Boolean);

  return parser.parse(files);
}

async function refreshFromGitHub({ manual = false } = {}) {
  if (state.refreshing) return;
  const token = readStorage(STORAGE_KEYS.token);

  if (!token) {
    state.lastError = 'Add a token in Settings.';
    render();
    if (manual) showToast(state.lastError, true);
    return;
  }

  if (!navigator.onLine) {
    state.lastError = 'Offline — refresh unavailable.';
    render();
    if (manual) showToast(state.lastError, true);
    return;
  }

  state.refreshing = true;
  render();

  const config = { ...CONFIG_BASE, token };
  try {
    const rootEntries = await Sync.listDir(config, '');
    const supportedFolders = rootEntries.filter((entry) => entry.type === 'dir' && PARSERS[entry.name]);
    const parsedFolders = await Promise.all(supportedFolders.map((entry) => loadFolder(config, entry)));

    const parseErrors = [];
    const items = [];
    for (const parsed of parsedFolders) {
      items.push(...parsed.items);
      parseErrors.push(...parsed.errors);
    }

    state.items = items.sort(compareItems);
    state.refreshedAt = new Date().toISOString();
    state.parseErrors = [...new Set(parseErrors)];
    state.lastError = state.parseErrors.length
      ? `Skipped unreadable files: ${state.parseErrors.join(', ')}`
      : '';
    if (!saveCache() && !state.lastError) {
      state.lastError = 'Data loaded, but the local cache could not be saved.';
    }
    if (manual) {
      showToast(state.parseErrors.length ? 'Refreshed with skipped files' : 'Data refreshed');
    }
  } catch (error) {
    state.lastError = errorMessage(error);
    saveCache();
    if (manual) showToast(state.lastError, true);
  } finally {
    state.refreshing = false;
    render();
  }
}

function openSettingsView() {
  if (!elements.settingsView.hidden) return;
  state.mainScrollY = window.scrollY;
  elements.mainView.hidden = true;
  elements.settingsView.hidden = false;
  renderSettings();
  window.scrollTo(0, 0);
  elements.closeSettings.focus({ preventScroll: true });
}

function closeSettingsView() {
  if (elements.settingsView.hidden) return;
  elements.settingsView.hidden = true;
  elements.mainView.hidden = false;
  window.scrollTo(0, state.mainScrollY);
  elements.openSettings.focus({ preventScroll: true });
}

function saveToken() {
  const token = elements.tokenInput.value.trim();
  if (!token) {
    showToast('Enter a token before saving.', true);
    elements.tokenInput.focus();
    return;
  }

  if (!writeStorage(STORAGE_KEYS.token, token)) {
    showToast('The token could not be saved on this device.', true);
    return;
  }

  elements.tokenInput.value = '';
  state.lastError = '';
  render();
  showToast('Token saved');
}

function clearToken() {
  if (!readStorage(STORAGE_KEYS.token)) return;
  // The token lives under one key on this origin, so Tide and Trace read the same
  // value. Clearing it here signs those apps out of sync too — say so up front.
  if (!window.confirm('Clear the saved token?\n\nTide and Trace share this token, so their sync will stop until a token is saved again. Cached search data will remain.')) return;

  if (!removeStorage(STORAGE_KEYS.token)) {
    showToast('The token could not be cleared.', true);
    return;
  }

  elements.tokenInput.value = '';
  render();
  showToast('Token cleared');
}

function applyFontSize(size, persist = true) {
  const nextSize = FONT_SIZES.includes(Number(size)) ? Number(size) : DEFAULT_FONT_SIZE;
  state.fontSize = nextSize;
  document.documentElement.style.setProperty('--body-size', `${nextSize}px`);
  if (persist) writeStorage(STORAGE_KEYS.fontSize, String(nextSize));
  renderSettings();
}

function bindEvents() {
  elements.openSettings.addEventListener('click', openSettingsView);
  elements.emptySettings.addEventListener('click', openSettingsView);
  elements.closeSettings.addEventListener('click', closeSettingsView);

  elements.searchInput.addEventListener('input', () => {
    state.query = elements.searchInput.value;
    elements.clearSearch.hidden = state.query.length === 0;
    renderResults();
  });

  elements.clearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.query = '';
    elements.clearSearch.hidden = true;
    renderResults();
    elements.searchInput.focus();
  });

  elements.saveToken.addEventListener('click', saveToken);
  elements.clearToken.addEventListener('click', clearToken);
  elements.refreshData.addEventListener('click', () => refreshFromGitHub({ manual: true }));

  elements.fontSizeOptions.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-size]');
    if (!button) return;
    applyFontSize(Number(button.dataset.size));
  });

  elements.fontSizeOptions.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const currentIndex = FONT_SIZES.indexOf(state.fontSize);
    const nextIndex = Math.min(FONT_SIZES.length - 1, Math.max(0, currentIndex + direction));
    applyFontSize(FONT_SIZES[nextIndex]);
    elements.fontSizeOptions.querySelector(`[data-size="${FONT_SIZES[nextIndex]}"]`).focus();
  });

  elements.resetSize.addEventListener('click', () => {
    applyFontSize(DEFAULT_FONT_SIZE);
    showToast('Text size reset');
  });

  window.addEventListener('offline', renderConnectionBanner);
  window.addEventListener('online', () => {
    renderConnectionBanner();
    if (readStorage(STORAGE_KEYS.token)) refreshFromGitHub();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => null);
  });
}

function initialize() {
  const savedSize = Number(readStorage(STORAGE_KEYS.fontSize));
  applyFontSize(savedSize, false);
  loadCache();
  bindEvents();
  render();
  registerServiceWorker();

  if (navigator.onLine && readStorage(STORAGE_KEYS.token)) {
    refreshFromGitHub();
  }
}

initialize();
