import * as Sync from '../../shared/v1/sync.js';

const STORAGE_KEYS = Object.freeze({
  token: 'sync.token.v1',
  cache: 'atlas.cache.v1',
  fontSize: 'atlas.font-size.v1',
  eventMonths: 'atlas.event-months.v1'
});

const CONFIG_BASE = Object.freeze({
  owner: 'jennie-verse',
  repo: 'webapp-data',
  branch: 'main'
});

const FONT_SIZES = Object.freeze([6, 8, 10, 12, 14, 17]);
const DEFAULT_FONT_SIZE = 12;
const RECENT_LIMIT = 20;

/* ── events 파서용 상수와 도우미 ────────────────────────────────────────
   events/ 는 한 단계 평면 폴더입니다. 파일 이름은 <app>.<ctx>.YYYY-MM.json
   한 가지뿐이고, 여기에 맞지 않는 항목(.gitkeep 등)은 전부 무시합니다.
   listDir 한 번으로 이름을 모두 받은 뒤, 최근 N개월치 파일만 내려받습니다.
   ────────────────────────────────────────────────────────────────────── */
const EVENT_FILE_PATTERN = /^([a-z][a-z0-9-]*)\.([a-z0-9-]+)\.(\d{4}-\d{2})\.json$/;
const EVENT_APP_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;
const EVENT_MONTHS_DEFAULT = 3;
const EVENT_MONTHS_STEP = 3;
const EVENT_MONTHS_MAX = 24;

function clampEventMonths(value) {
  const months = Math.round(Number(value));
  if (!Number.isFinite(months)) return EVENT_MONTHS_DEFAULT;
  return Math.min(EVENT_MONTHS_MAX, Math.max(EVENT_MONTHS_DEFAULT, months));
}

// 오늘이 속한 달부터 거슬러 올라가며 'YYYY-MM' 키를 만듭니다. 로컬 시각 기준입니다.
function recentMonthKeys(monthCount) {
  const keys = new Set();
  const now = new Date();
  for (let back = 0; back < clampEventMonths(monthCount); back += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    keys.add(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// ref 는 같은 오리진 안의 이웃 앱 폴더만 허용합니다. 데이터 파일이 조작되어도
// javascript: 나 외부 주소가 링크로 들어가지 못하게 막습니다.
function safeAppUrl(value) {
  return typeof value === 'string' && /^\.\.\/[a-z][a-z0-9-]{0,23}\/$/.test(value) ? value : '';
}

function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  // 모르는 스키마 버전은 조용히 건너뜁니다.
  if (rawEvent.v !== 1) return null;
  if (typeof rawEvent.id !== 'string' || !rawEvent.id) return null;

  const at = validIsoString(rawEvent.at);
  if (!at) return null;

  const title = typeof rawEvent.title === 'string' ? rawEvent.title.trim() : '';
  if (!title) return null;

  const detail = typeof rawEvent.detail === 'string' ? rawEvent.detail.trim() : '';
  const app = typeof rawEvent.app === 'string' && EVENT_APP_PATTERN.test(rawEvent.app) ? rawEvent.app : 'app';

  return {
    id: rawEvent.id,
    app,
    at,
    title: title.slice(0, 120),
    detail: detail.slice(0, 400),
    ref: safeAppUrl(rawEvent.ref),
    deleted: rawEvent.deleted === true
  };
}

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
  }),
  // events 는 앱들이 공통 모양으로 남기는 활동 기록입니다. 앱마다 파서를 따로
  // 두지 않기 위한 층이라, 새 앱이 늘어도 이 파서 하나만 유지하면 됩니다.
  // 파일: events/<app>.<ctx>.YYYY-MM.json — 이벤트 객체의 배열
  // 레코드 모양: { v: 1, id, app, kind, at, title, detail?, ref?, deleted? }
  // events/ 폴더가 없으면 listDir 이 빈 배열을 돌려주므로 조용히 비활성화됩니다.
  events: Object.freeze({
    // ref 가 비어 있는 이벤트는 열 곳이 없으므로 링크를 만들지 않습니다.
    appUrl: '',
    async listFiles(config, folderPath) {
      const entries = await Sync.listDir(config, folderPath);
      const months = recentMonthKeys(state.eventMonths);
      return entries.filter((entry) => {
        if (entry.type !== 'file') return false;
        const matched = EVENT_FILE_PATTERN.exec(entry.name);
        return Boolean(matched) && months.has(matched[3]);
      });
    },
    parse(files) {
      const newestEvents = new Map();
      const errors = [];

      for (const file of files) {
        let payload;
        try {
          payload = JSON.parse(file.content);
          if (!Array.isArray(payload)) {
            throw new TypeError('Unexpected events shape');
          }
        } catch {
          errors.push(file.name);
          continue;
        }

        for (const rawEvent of payload) {
          const event = normalizeEvent(rawEvent);
          if (!event) continue;
          // 추가만 하는 파일이라 나중에 적힌 것이 최신입니다. 취소(deleted)도
          // 같은 id 로 뒤에 붙으므로 마지막에 본 것을 그대로 채택합니다.
          const previous = newestEvents.get(event.id);
          if (!previous || dateValue(event.at) >= dateValue(previous.at)) {
            newestEvents.set(event.id, event);
          }
        }
      }

      const items = [];
      for (const event of newestEvents.values()) {
        if (event.deleted) continue;
        const text = event.detail || event.title;
        items.push({
          id: `events:${event.id}`,
          title: event.title,
          snippet: text,
          date: event.at,
          source: 'events',
          badge: event.app,
          text,
          label: event.title,
          pinned: false,
          appUrl: event.ref
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
  eventMonths: EVENT_MONTHS_DEFAULT,
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
  loadOlder: document.querySelector('#load-older'),
  loadOlderLabel: document.querySelector('#load-older-label'),
  eventRange: document.querySelector('#event-range'),
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
    // events 항목은 앱마다 뱃지와 여는 주소가 다릅니다. 캐시에서 되살릴 때도
    // 항목이 들고 있던 값을 쓰되, 모양이 규칙에 맞을 때만 인정합니다.
    badge: typeof rawItem.badge === 'string' && EVENT_APP_PATTERN.test(rawItem.badge) ? rawItem.badge : '',
    text: rawItem.text,
    label: typeof rawItem.label === 'string' ? rawItem.label : '',
    pinned: rawItem.pinned === true,
    appUrl: safeAppUrl(rawItem.appUrl) || PARSERS[source].appUrl
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

  // events 항목은 뱃지에 원래 앱 이름(focus, loom …)을 보여 줍니다.
  const sourceName = item.badge || item.source;

  const copyButton = document.createElement('button');
  copyButton.className = 'copy-result';
  copyButton.type = 'button';
  copyButton.setAttribute('aria-label', `Copy ${sourceName} item`);
  copyButton.addEventListener('click', () => copyText(item.text));

  const topLine = document.createElement('div');
  topLine.className = 'result-topline';

  const badge = document.createElement('span');
  badge.className = 'source-badge';
  badge.textContent = sourceName;
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

  // 여는 주소가 없는 이벤트는 링크 없이 복사만 되게 둡니다.
  if (!item.appUrl) {
    row.append(copyButton);
    return row;
  }

  const openLink = document.createElement('a');
  openLink.className = 'open-app-link';
  openLink.href = item.appUrl;
  openLink.setAttribute('aria-label', `Open ${sourceName}`);
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

  const atMax = state.eventMonths >= EVENT_MONTHS_MAX;
  elements.loadOlder.disabled = atMax || state.refreshing;
  elements.loadOlderLabel.textContent = atMax
    ? 'All events loaded'
    : `Load ${EVENT_MONTHS_STEP} more months`;
  elements.eventRange.textContent = atMax
    ? `Events from the last ${EVENT_MONTHS_MAX} months are searchable.`
    : `Events from the last ${state.eventMonths} months are searchable.`;
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
  elements.loadOlder.addEventListener('click', widenEventRange);

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

// 검색 범위를 3개월씩 넓힙니다. 넓힌 범위는 다음에 앱을 열 때도 유지됩니다.
function widenEventRange() {
  if (state.eventMonths >= EVENT_MONTHS_MAX) return;
  state.eventMonths = clampEventMonths(state.eventMonths + EVENT_MONTHS_STEP);
  writeStorage(STORAGE_KEYS.eventMonths, String(state.eventMonths));
  renderSettings();
  refreshFromGitHub({ manual: true });
}

function initialize() {
  const savedSize = Number(readStorage(STORAGE_KEYS.fontSize));
  applyFontSize(savedSize, false);
  state.eventMonths = clampEventMonths(readStorage(STORAGE_KEYS.eventMonths) ?? EVENT_MONTHS_DEFAULT);
  loadCache();
  bindEvents();
  render();
  registerServiceWorker();

  if (navigator.onLine && readStorage(STORAGE_KEYS.token)) {
    refreshFromGitHub();
  }
}

initialize();
