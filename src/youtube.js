import { httpUrl } from './core.js';

export const validYoutubeId = value => typeof value === 'string' && /^[\w-]{11}$/.test(value) ? value : null;
export function youtubePageId(value) {
  const safe = httpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.hostname === 'youtu.be') return validYoutubeId(url.pathname.split('/')[1]);
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(url.hostname)) return null;
  return validYoutubeId(url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]);
}
export function isYoutubeMedia(value) {
  const safe = httpUrl(value);
  if (!safe) return false;
  return /(^|\.)(googlevideo\.com|youtube\.com|youtube-nocookie\.com)$/.test(new URL(safe).hostname);
}
export const youtubeThumbnail = id => validYoutubeId(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
export function youtubeContext(pageUrl, metadata = {}) {
  const page = httpUrl(pageUrl);
  if (!page || !/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(new URL(page).hostname)) return {};
  const id = youtubePageId(page) || validYoutubeId(metadata.videoId);
  if (!id) return {};
  const title = String(metadata.title || '').replace(/\s*[-–—]\s*YouTube\s*$/, '').trim().slice(0, 200);
  return { videoId: id, title: title && title !== 'YouTube' ? title : '', thumbnail: httpUrl(metadata.thumbnail) || youtubeThumbnail(id) };
}
export function withYoutubeContext(raw, context) {
  const explicitId = validYoutubeId(raw.key?.startsWith('youtube:') ? raw.key.slice(8) : null);
  const metadata = context.youtube || youtubeContext(context.pageUrl, context);
  const id = explicitId || (raw.sources?.length && raw.sources.every(source => isYoutubeMedia(source.url)) ? metadata.videoId : null);
  if (!id) return raw;
  const same = metadata.videoId === id;
  return { ...raw, key: `youtube:${id}`, thumbnail: httpUrl(raw.thumbnail) || (same && metadata.thumbnail) || youtubeThumbnail(id),
    title: (Number(raw.rank) >= 3 && raw.title && raw.title !== 'YouTube' ? raw.title : (same && metadata.title) || raw.title),
    rank: Math.max(Number(raw.rank) || 0, same && metadata.title ? 2 : 0) };
}
