import { httpUrl, mediaKind } from './core.js';
import { youtubePageId } from './youtube.js';
if (!globalThis.__dustWaveContent) {
globalThis.__dustWaveContent = true;

const CHANNEL = 'dust-wave-media-v1';
let lastPage = '';
let sent = new Set();
let timer;
let active = true;
let observer;
const listeners = new AbortController();
function stop() {
  if (!active) return;
  active = false;
  clearTimeout(timer);
  observer?.disconnect();
  listeners.abort();
  sent.clear();
  try { if (chrome.runtime?.id) chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch { /* The old extension context is already gone. */ }
  delete globalThis.__dustWaveContent;
}
function onSendError(error) {
  if (invalidated(error)) stop();
}
const invalidated = error => /extension context invalidated/i.test(String(error?.message || error));
function withRuntime(action) {
  if (!active) return;
  try {
    if (!chrome.runtime?.id) { stop(); return; }
    return action();
  } catch (error) {
    stop();
    if (!invalidated(error)) throw error;
  }
}
function send(payload) {
  // Invalidated contexts can throw before a Promise is returned.
  withRuntime(() => { void chrome.runtime.sendMessage(payload).catch(onSendError); });
}
function pageInfo() {
  if (lastPage !== location.href) { lastPage = location.href; sent.clear(); }
  const metadata = { videoId: youtubePageId(location.href), title: document.querySelector('meta[property="og:title"]')?.content || document.title,
    thumbnail: document.querySelector('meta[property="og:image"]')?.content || document.querySelector('video[poster]')?.poster };
  return { type: 'discover', pageUrl: location.href, title: document.title, metadata, items: [] };
}
function publish(items) {
  if (!active) return;
  const message = pageInfo();
  for (const item of items.slice(0, 60)) {
    if (!item || !Array.isArray(item.sources)) continue;
    const key = JSON.stringify(item);
    if (key.length > 80000 || sent.has(key)) continue;
    if (sent.size >= 400) sent.clear();
    sent.add(key);
    message.items.push(item);
  }
  if (message.items.length || document.readyState !== 'loading') send(message);
}
function scan() {
  timer = null;
  if (!active) return;
  const items = [];
  for (const element of [...document.querySelectorAll('video,audio')].slice(0, 40)) {
    const sources = [element.currentSrc, element.src, ...[...element.querySelectorAll('source')].map(source => source.src)]
      .map(url => httpUrl(url, location.href)).filter(Boolean).map(url => ({ url, kind: mediaKind(url) || 'file' }));
    if (sources.length) items.push({ key: sources[0].url, title: element.title || document.title, duration: element.duration, thumbnail: element.poster, sources, rank: 1 });
  }
  for (const meta of document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[property="og:audio"]')) {
    const url = httpUrl(meta.content, location.href);
    if (url) items.push({ title: document.title, thumbnail: document.querySelector('meta[property="og:image"]')?.content, sources: [{ url }], rank: 1 });
  }
  publish(items);
  if (active) window.postMessage({ channel: CHANNEL, command: 'scan' }, '*');
}
function schedule() {
  if (active && !timer) timer = setTimeout(scan, 800);
}
function onRuntimeMessage(message, sender, respond) {
  if (!active || !['ping', 'rescan'].includes(message.type)) return;
  withRuntime(() => {
    if (message.type === 'rescan') { sent.clear(); scan(); }
    // The reply is also a Chrome binding and can lose its context on reload.
    if (active) respond({ ok: true });
  });
}
// Reinjection can race an extension reload before messaging is available.
withRuntime(() => chrome.runtime.onMessage.addListener(onRuntimeMessage));
if (active) {
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.channel !== CHANNEL || !Array.isArray(event.data.items)) return;
  publish(event.data.items);
}, { signal: listeners.signal });
document.addEventListener('loadedmetadata', schedule, { capture: true, signal: listeners.signal });
document.addEventListener('play', schedule, { capture: true, signal: listeners.signal });
window.addEventListener('popstate', schedule, { signal: listeners.signal });
document.addEventListener('yt-navigate-finish', schedule, { signal: listeners.signal });
document.addEventListener('DOMContentLoaded', scan, { once: true, signal: listeners.signal });
observer = new MutationObserver(records => {
  if (records.some(record => record.type === 'attributes' || [...record.addedNodes].some(node => node.nodeType === 1))) schedule();
});
observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster', 'content'] });
scan();
}
}
