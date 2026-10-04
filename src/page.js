import { extractJsonMedia, youtubeMedia } from './adapters.js';
import { youtubePageId } from './youtube.js';
if (!window.__dustWavePage) {
window.__dustWavePage = true;
const CHANNEL = 'dust-wave-media-v1';
const host = location.hostname;
const targeted = /(^|\.)(instagram\.com|tiktok\.com|vimeo\.com|substack\.com|youtube\.com)$/.test(host);
const knownScripts = new WeakSet();
const publish = items => { if (items.length) window.postMessage({ channel: CHANNEL, items }, '*'); };
const process = data => publish(extractJsonMedia(data, { title: document.title }));
function parse(text) {
  if (typeof text !== 'string' || text.length > 3000000) return false;
  try { process(JSON.parse(text.replace(/^for\s*\(;;\);\s*/, ''))); return true; } catch { return false; }
}
function scan() {
  try {
    if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) {
      const player = document.getElementById('movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      const currentId = youtubePageId(location.href);
      if (!currentId || player?.videoDetails?.videoId === currentId) publish(youtubeMedia(player));
    }
    if (host.endsWith('vimeo.com') && window.playerConfig) process(window.playerConfig);
    for (const script of [...document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"],#__NEXT_DATA__,#__UNIVERSAL_DATA_FOR_REHYDRATION__,#SIGI_STATE')].slice(0, targeted ? 200 : 50)) {
      if (knownScripts.has(script)) continue;
      // Streaming HTML can expose a script element before its JSON is complete.
      if (parse(script.textContent)) knownScripts.add(script);
    }
  } catch { /* Player state can disappear during navigation. */ }
}
window.addEventListener('message', event => { if (event.source === window && event.data?.channel === CHANNEL && event.data.command === 'scan') scan(); });
document.addEventListener('DOMContentLoaded', scan, { once: true });
if (targeted) {
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    promise.then(response => {
      if (/graphql|\/api\/|\/config(?:\?|$)/.test(response.url) && /json/.test(response.headers.get('content-type') || '') && Number(response.headers.get('content-length') || 0) < 3000000) {
        const clone = response.clone();
        (async () => {
          const reader = clone.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder(); let text = ''; let bytes = 0;
          try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 3000000) { await reader.cancel(); return; } text += decoder.decode(value, { stream: true }); } parse(text + decoder.decode()); }
          catch { /* A cancelled page request needs no recovery here. */ }
        })();
      }
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (!/graphql|\/api\/|\/config(?:\?|$)/.test(this.responseURL)) return;
        if (this.responseType === 'json') process(this.response);
        else if (!this.responseType || this.responseType === 'text') parse(this.responseText);
      } catch { /* Unsupported response type. */ }
    }, { once: true });
    return originalOpen.apply(this, args);
  };
}
}
