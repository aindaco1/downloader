import { httpUrl, mediaKind, sourceUrl, upsert, safeFilename, readableError } from './core.js';
import { siteContext, withSiteContext } from './site-context.js';
import { createToolbarActivity, pending } from './toolbar.js';

const state = { tabs: {}, jobs: [], settings: { automatic: true, saveAs: false } };
let inspection = false;
let creating;
let saveTimer;
let activeTabId;
const toolbar = createToolbarActivity();
const updateToolbar = detected => toolbar.update({ job: activeJob(), detected, count: state.tabs[activeTabId]?.items.length || 0 });
const showActiveToolbar = () => updateToolbar(Boolean(state.tabs[activeTabId]?.items.length));
const manualScans = new Map();
const loaded = Promise.all([chrome.storage.session.get('state'), chrome.storage.local.get('settings')]).then(async ([saved, settings]) => {
  Object.assign(state, saved.state || {});
  Object.assign(state.settings, settings.settings || {});
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) for (const job of state.jobs) if (['processing', 'ready'].includes(job.status)) { job.status = 'error'; job.error = 'The browser interrupted this download. Start it again from the page.'; }
  activeTabId = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  showActiveToolbar();
  for (const tabId of Object.keys(state.tabs)) void badge(Number(tabId));
});
const persist = () => {
  // Detection is a session cache, never an unbounded browsing history.
  const oldest = Object.keys(state.tabs).sort((a, b) => (state.tabs[a].touched || 0) - (state.tabs[b].touched || 0));
  while (JSON.stringify(state).length > 3000000 && oldest.length) delete state.tabs[oldest.shift()];
  return chrome.storage.session.set({ state });
};
const later = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => void persist(), 350); };
const tabState = id => state.tabs[id] ||= { items: [], pageUrl: '', title: '', frames: {} };
const activeJob = () => state.jobs.find(pending);
const extensionPage = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab?.url?.startsWith('http');

async function engineMessage(payload, create = true) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) {
    if (!create) return null;
    creating ||= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS', 'DOM_PARSER'], justification: 'Inspect and merge selected media using disk-backed files, and save the completed file.' }).finally(() => { creating = null; });
    await creating;
  }
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', ...payload });
  if (!response?.ok) throw new Error(response?.error || 'The media engine did not respond.');
  return response;
}

async function release(id) {
  await engineMessage({ type: 'release', id }, false).catch(() => {});
  if (!activeJob() && !inspection) {
    const status = await engineMessage({ type: 'ping' }, false).catch(() => null);
    if (status && !status.active && !status.retained) await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function requestContext(pageUrl) {
  const safe = httpUrl(pageUrl);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: safe ? [{
    id: 1, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: safe }] },
    condition: { initiatorDomains: [chrome.runtime.id], urlFilter: '|http', resourceTypes: ['xmlhttprequest', 'media', 'other'] },
  }] : [] });
}

async function badge(tabId) {
  // Native badges have a fixed large backplate. The bundled icon carries a
  // compact dot instead; clear any badge retained from an earlier version.
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

function addItems(tabId, items, context) {
  const tab = tabState(tabId);
  tab.touched = Date.now();
  const previousIds = new Set(tab.items.map(item => item.id));
  if (context.video?.videoId) {
    // Metadata can arrive after separate master playlists were observed.
    for (const item of [...tab.items]) if (item.pageUrl === context.pageUrl || item.key === `${context.video.site}:${context.video.videoId}`) {
      upsert(tab.items, withSiteContext(item, context), { ...context, pageUrl: item.pageUrl });
    }
  }
  for (const original of items.slice(0, 60)) {
    const raw = withSiteContext(original, context);
    const before = new Map(tab.items.map(item => [item.id, JSON.stringify(item.sources.map(source => source.url))]));
    upsert(tab.items, raw, context);
    for (const item of tab.items) if (item.inspection && before.has(item.id) && before.get(item.id) !== JSON.stringify(item.sources.map(source => source.url))) item.inspection.at = 0;
  }
  const detected = tab.items.some(item => !previousIds.has(item.id));
  if (detected) tab.detectedAt = Date.now();
  if (tabId === activeTabId) updateToolbar(detected);
  later(); void badge(tabId);
}

function currentItem(tabId, itemId) {
  const item = state.tabs[tabId]?.items.find(item => item.id === itemId);
  if (!item) throw new Error('This item is no longer on the page. Rescan and try again.');
  return item;
}

async function eventFromEngine(event) {
  const job = state.jobs.find(job => job.id === event.id);
  if (!job) return;
  if (['cancelled', 'complete', 'error'].includes(job.status)) { if (event.status === 'ready') await release(job.id); return; }
  if (event.status === 'ready') {
    if (job.cancelRequested) { job.status = 'cancelled'; await release(job.id); await requestContext(null); await persist(); updateToolbar(false); return; }
    job.status = 'saving'; job.bytes = event.bytes; job.progress = null;
    job.saveUrl = event.blobUrl;
    try {
      job.downloadId = await chrome.downloads.download({ url: event.blobUrl, filename: job.filename, saveAs: state.settings.saveAs, conflictAction: 'uniquify' });
      if (job.cancelRequested) { await chrome.downloads.cancel(job.downloadId).catch(() => {}); job.status = 'cancelled'; await release(job.id); }
      await requestContext(null);
    } catch (error) { job.status = 'error'; job.error = readableError(error); await release(job.id); }
  } else {
    job.status = event.status;
    if (Number.isFinite(event.bytes)) job.bytes = event.bytes;
    if (event.progress === null || Number.isFinite(event.progress)) job.progress = event.progress;
    if (event.error) job.error = event.error;
    if (['error', 'cancelled'].includes(job.status)) { await requestContext(null); await release(job.id); }
  }
  await persist();
  updateToolbar(false);
}

async function handle(message, sender) {
  await loaded;
  if (message.type === 'discover') {
    if (sender.id !== chrome.runtime.id || !sender.tab || (!state.settings.automatic && (manualScans.get(sender.tab.id) || 0) < Date.now()) || !httpUrl(sender.url) || !Array.isArray(message.items)) return {};
    const tab = tabState(sender.tab.id);
    const pageUrl = httpUrl(sender.url);
    tab.frames[sender.frameId] = pageUrl;
    if (!sender.frameId) {
      if ((tab.pageUrl && tab.pageUrl !== pageUrl) || (tab.documentId && tab.documentId !== sender.documentId)) tab.items = [];
      tab.documentId = sender.documentId;
      tab.pageUrl = pageUrl;
      tab.title = String(message.title || '').slice(0, 200);
    }
    const frameMetadata = tab.frameMetadata ||= {};
    const identity = siteContext(pageUrl, message.metadata);
    const previous = frameMetadata[sender.frameId];
    const same = Boolean(identity.site && previous?.site === identity.site && previous?.videoId === identity.videoId);
    const player = message.items.find(item => item?.key === `${identity.site}:${identity.videoId}` && item.rank >= 3);
    const metadata = { ...(same ? previous : {}), ...message.metadata };
    // Routine DOM scans may lack player metadata; keep the known poster/title.
    if (same) for (const key of ['thumbnail', 'duration']) if (!metadata[key]) metadata[key] = previous[key];
    if (player) for (const key of ['title', 'thumbnail', 'duration']) if (player[key]) metadata[key] = player[key];
    const video = siteContext(pageUrl, metadata);
    if (video.videoId) {
      if (!video.title && same) video.title = previous.title;
      frameMetadata[sender.frameId] = video;
    }
    const pending = (tab.pendingSources || []).filter(source => source.frameId === sender.frameId);
    tab.pendingSources = (tab.pendingSources || []).filter(source => source.frameId !== sender.frameId);
    addItems(sender.tab.id, [...message.items, ...pending.map(({ frameId, ...source }) => ({ sources: [source], rank: 0 }))], { pageUrl, title: String(message.title || tab.title).slice(0, 200), video });
    return {};
  }
  if (message.type === 'engine-event') {
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('offscreen.html')) await eventFromEngine(message.event);
    return {};
  }
  if (!extensionPage(sender)) throw new Error('Only the extension interface can start a download.');
  switch (message.type) {
    case 'snapshot': {
      const tab = state.tabs[message.tabId] || { items: [] };
      return { tab, jobs: state.jobs, settings: state.settings, inspecting: inspection };
    }
    case 'rescan': {
      for (const [id, expiry] of manualScans) if (expiry < Date.now()) manualScans.delete(id);
      manualScans.set(message.tabId, Date.now() + 3000);
      for (const item of tabState(message.tabId).items) delete item.inspection;
      const reconnectMessage = 'Refresh this page to reconnect the extension, then rescan.';
      // Check the main frame: an embedded player must not mask a stale page script.
      const connected = () => chrome.tabs.sendMessage(message.tabId, { type: 'ping' }, { frameId: 0 }).then(response => response?.ok === true).catch(() => false);
      if (!await connected()) {
        await chrome.scripting.executeScript({ target: { tabId: message.tabId, allFrames: true }, world: 'MAIN', files: ['page.js'] });
        await chrome.scripting.executeScript({ target: { tabId: message.tabId, allFrames: true }, files: ['content.js'] });
        if (!await connected()) throw new Error(reconnectMessage);
      }
      const response = await chrome.tabs.sendMessage(message.tabId, { type: 'rescan' }).catch(() => null);
      if (!response?.ok) throw new Error(reconnectMessage);
      if (message.tabId === activeTabId) showActiveToolbar();
      return {};
    }
    case 'inspect': {
      if (inspection || activeJob()) throw new Error('Finish or cancel the current media task first.');
      const item = currentItem(message.tabId, message.itemId);
      if (item.inspection && Date.now() - item.inspection.at < 300000) return item.inspection;
      inspection = true;
      try {
        await requestContext(item.pageUrl);
        const result = await engineMessage({ type: 'inspect', media: item });
        item.inspection = { choices: result.choices, warnings: result.warnings, at: Date.now() };
        await persist();
        return item.inspection;
      } finally { inspection = false; await requestContext(null); await release('unused'); }
    }
    case 'start': {
      if (inspection || activeJob()) throw new Error('Finish or cancel the current download first.');
      const item = currentItem(message.tabId, message.itemId);
      const choice = item.inspection?.choices.find(choice => choice.id === message.choiceId);
      if (!choice) throw new Error('Inspect the available qualities first.');
      const job = { id: crypto.randomUUID(), filename: safeFilename(message.filename || item.title, choice.extension), title: item.title, status: 'processing', bytes: 0, progress: null, created: Date.now(), itemId: item.id, tabId: message.tabId };
      state.jobs.unshift(job); state.jobs = state.jobs.slice(0, 25);
      await persist();
      updateToolbar(false);
      try {
        await requestContext(item.pageUrl);
        await engineMessage({ type: 'start', job: { ...job, media: item, choice } });
      } catch (error) { job.status = 'error'; job.error = readableError(error); await requestContext(null); }
      await persist();
      updateToolbar(false);
      return { job };
    }
    case 'cancel': {
      const job = state.jobs.find(job => job.id === message.id);
      if (pending(job) && !job.cancelRequested) {
        job.cancelRequested = true;
        updateToolbar(false);
        await persist();
        if (job.downloadId !== undefined) { await chrome.downloads.cancel(job.downloadId).catch(() => {}); job.status = 'cancelled'; await release(job.id); await requestContext(null); }
        else await engineMessage({ type: 'cancel', id: job.id }, false);
        await persist();
        updateToolbar(false);
      }
      return {};
    }
    case 'dismiss': {
      const tab = tabState(message.tabId);
      tab.items = tab.items.filter(item => item.id !== message.itemId); await badge(message.tabId); if (message.tabId === activeTabId) updateToolbar(false); await persist(); return {};
    }
    case 'clear': state.jobs = state.jobs.filter(pending); await persist(); return {};
    case 'show': {
      const job = state.jobs.find(job => job.id === message.id);
      if (job?.downloadId !== undefined) await chrome.downloads.show(job.downloadId);
      return {};
    }
    case 'settings': {
      for (const key of ['automatic', 'saveAs']) if (typeof message.settings?.[key] === 'boolean') state.settings[key] = message.settings[key];
      await chrome.storage.local.set({ settings: state.settings }); await persist(); return {};
    }
    default: throw new Error('Unknown action.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === 'offscreen') return;
  handle(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: readableError(error) }));
  return true;
});

chrome.webRequest.onHeadersReceived.addListener(details => {
  void loaded.then(async () => {
    if (!state.settings.automatic || details.tabId < 0 || details.method !== 'GET' || details.statusCode >= 400) return;
    const mime = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
    const kind = mediaKind(details.url, mime);
    if (!kind) return;
    const tab = tabState(details.tabId);
    if (!tab.pageUrl) {
      const browserTab = await chrome.tabs.get(details.tabId).catch(() => null);
      if (!browserTab?.url) return;
      tab.pageUrl = browserTab.url; tab.title = browserTab.title || '';
    }
    // A player can request media before its content script reports its URL.
    // Wait for that frame's identity instead of assigning it to the parent page.
    if (details.frameId > 0 && !tab.frames[details.frameId]) {
      const pending = tab.pendingSources ||= [];
      if (pending.length < 60) pending.push({ frameId: details.frameId, url: details.url, kind, mime });
      return;
    }
    const pageUrl = tab.frames[details.frameId] || tab.pageUrl;
    const video = siteContext(pageUrl, tab.frameMetadata?.[details.frameId] || { title: tab.title });
    addItems(details.tabId, [{ key: sourceUrl(details.url), title: tab.title, sources: [{ url: details.url, kind, mime }], rank: 0 }], { pageUrl, title: tab.title, video });
  }).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other'] }, ['responseHeaders']);

chrome.tabs.onRemoved.addListener(tabId => { void loaded.then(() => { delete state.tabs[tabId]; later(); }); });
chrome.tabs.onActivated.addListener(info => { activeTabId = info.tabId; void loaded.then(showActiveToolbar); });
chrome.action.onUserSettingsChanged?.addListener(change => { if (change.isOnToolbar) void loaded.then(showActiveToolbar); });
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId < 0) return;
  void loaded.then(async () => { activeTabId = (await chrome.tabs.query({ active: true, windowId }))[0]?.id; showActiveToolbar(); });
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Sites can emit repeated "loading" updates within the same document.
  // Content-script document IDs distinguish a real reload from those updates.
  if (change.url) void loaded.then(() => {
    if (state.tabs[tabId]?.pageUrl === change.url) return;
    state.tabs[tabId] = { items: [], title: tab.title || '', pageUrl: change.url, frames: {} }; later(); void badge(tabId);
    if (tabId === activeTabId) updateToolbar(false);
  });
});
chrome.downloads.onChanged.addListener(delta => {
  void loaded.then(async () => {
    const job = state.jobs.find(job => job.downloadId === delta.id);
    if (!job) return;
    if (delta.state?.current === 'complete') { job.status = 'complete'; job.progress = 1; await release(job.id); await requestContext(null); }
    if (delta.state?.current === 'interrupted') { job.status = delta.error?.current === 'USER_CANCELED' ? 'cancelled' : 'error'; job.error = delta.error?.current || 'Chrome interrupted this download.'; await release(job.id); await requestContext(null); }
    await persist();
    updateToolbar(false);
  }).catch(() => {});
});
chrome.downloads.onDeterminingFilename.addListener((download, suggest) => {
  void loaded.then(() => {
    const job = state.jobs.find(job => job.saveUrl === download.url);
    if (job) suggest({ filename: job.filename, conflictAction: 'uniquify' });
    else suggest();
  }).catch(() => suggest());
  return true;
});
