import { httpUrl } from './core.js';

export const validVimeoId = value => /^\d{1,15}$/.test(String(value || '')) ? String(value) : null;
export function vimeoPageId(value) {
  const safe = httpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!/(^|\.)vimeo\.com$/.test(url.hostname)) return null;
  return validVimeoId(url.pathname.match(/^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|showcase\/\d+\/video\/)?(\d+)(?:\/|$)/)?.[1]);
}
export function isVimeoMedia(value) {
  const safe = httpUrl(value);
  return Boolean(safe && /(^|\.)vimeocdn\.com$/.test(new URL(safe).hostname));
}
export function vimeoContext(pageUrl, metadata = {}) {
  const videoId = vimeoPageId(pageUrl);
  if (!videoId) return {};
  const title = String(metadata.title || '').replace(/\s*(?:\| Videos & Movies on Vimeo|on Vimeo|[-–—] Vimeo)\s*$/i, '').trim().slice(0, 200);
  return { videoId, title: title === 'Vimeo' ? '' : title, thumbnail: httpUrl(metadata.thumbnail), duration: metadata.duration };
}
export function withVimeoContext(raw, context) {
  const explicitId = raw.key?.startsWith('vimeo:') ? validVimeoId(raw.key.slice(6)) : null;
  const metadata = context.vimeo || vimeoContext(context.pageUrl, context);
  const id = explicitId || (raw.sources?.length && raw.sources.every(source => isVimeoMedia(source.url)) ? metadata.videoId : null);
  if (!id) return raw;
  const same = id === metadata.videoId;
  return { ...raw, key: `vimeo:${id}`, thumbnail: httpUrl(raw.thumbnail) || (same ? metadata.thumbnail : null), duration: raw.duration || (same ? metadata.duration : null),
    title: Number(raw.rank) >= 3 && raw.title ? raw.title : (same && metadata.title) || raw.title,
    rank: Math.max(Number(raw.rank) || 0, same && metadata.title ? 2 : 0) };
}
