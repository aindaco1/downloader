export const MAX_ITEMS = 40;
export const MAX_SOURCES = 24;

export function unavailableMessage(reason) {
  if (reason === 'youtube-sabr') return 'YouTube is using a playback format this version cannot download. Refreshing or rescanning will not add support for it.';
  if (reason === 'youtube-cipher') return 'YouTube has not exposed a download link this version can read. Playback may still work normally.';
  return '';
}

export function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 12000 || /[\x00-\x1f]/.test(value)) return null;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function mediaKind(raw, mime = '') {
  const url = httpUrl(raw);
  if (!url) return null;
  const parsed = new URL(url);
  if (playerAsset(url)) return null;
  if (/\.(ts|m4s|cmfv|cmfa)(?:$|\/)/i.test(parsed.pathname)) return null;
  if (/\.m3u8$/i.test(parsed.pathname) || /mpegurl/i.test(mime)) return 'hls';
  if (/\.mpd$/i.test(parsed.pathname) || /dash\+xml/i.test(mime)) return 'dash';
  if (parsed.hostname.endsWith('.googlevideo.com')) {
    if (parsed.searchParams.has('sq') || parsed.searchParams.get('sabr') === '1') return null;
    if (!parsed.searchParams.has('itag')) return null;
    return 'file';
  }
  if (/\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(parsed.pathname)) return 'file';
  if (/^(video|audio)\//i.test(mime) && !/mp2t/i.test(mime)) return 'file';
  return null;
}

function playerAsset(url) {
  const parsed = new URL(url);
  return (/(^|\.)youtube\.com$/.test(parsed.hostname) && parsed.pathname.startsWith('/s/')) ||
    (/(^|\.)(tiktokcdn|tiktokcdn-us)\.com$/.test(parsed.hostname) && parsed.pathname.includes('/tiktok/webapp/'));
}

export function sourceUrl(value) {
  const safe = httpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.hostname.endsWith('.googlevideo.com')) {
    for (const key of ['range', 'rn', 'rbuf']) url.searchParams.delete(key);
  }
  if (/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) {
    for (const key of ['bytestart', 'byteend']) url.searchParams.delete(key);
  }
  return url.href;
}

export function idFor(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export function cleanSource(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = sourceUrl(raw.url);
  if (!url || playerAsset(url)) return null;
  const kind = ['file', 'hls', 'dash'].includes(raw.kind) ? raw.kind : mediaKind(url, raw.mime);
  if (!kind) return null;
  const result = { url, kind };
  for (const key of ['height', 'width', 'bitrate', 'size', 'fps']) {
    if (number(raw[key])) result[key] = number(raw[key]);
  }
  for (const key of ['mime', 'label', 'codec']) if (typeof raw[key] === 'string') result[key] = raw[key].slice(0, 120);
  return result;
}

export function upsert(items, raw, context) {
  if (!raw || !Array.isArray(raw.sources)) return items;
  const sources = raw.sources.slice(0, MAX_SOURCES).map(cleanSource).filter(Boolean);
  const key = typeof raw.key === 'string' ? sourceUrl(raw.key) || raw.key.slice(0, 240) : sources[0]?.url;
  const unavailable = /^youtube:[\w-]{11}$/.test(key || '') && unavailableMessage(raw.unavailable) ? raw.unavailable : null;
  if (!key || (!sources.length && !unavailable && !items.some(item => item.key === key))) return items;
  const matches = items.filter(item => item.key === key || item.sources.some(a => sources.some(b => a.url === b.url)));
  const existing = matches[0];
  // A later site response can establish that separately observed tracks belong
  // together. Collapse those cards while retaining their discovered sources.
  for (const duplicate of matches.slice(1)) {
    for (const source of duplicate.sources) if (!sources.some(known => known.url === source.url)) sources.push(source);
    items.splice(items.indexOf(duplicate), 1);
  }
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
  const item = existing || { id: idFor(key), key, sources: [], title: context.title || 'Media on this page', pageUrl: context.pageUrl, rank: 0 };
  const rank = Math.min(3, Number(raw.rank) || 0);
  if (existing && raw.key && (rank > item.rank || (httpUrl(item.key) && !httpUrl(key)))) item.key = key;
  if (title && rank >= item.rank) { item.title = title; item.rank = rank; }
  if (httpUrl(raw.thumbnail)) item.thumbnail = raw.thumbnail;
  if (number(raw.duration)) item.duration = number(raw.duration);
  for (const source of sources) {
    const known = item.sources.find(candidate => candidate.url === source.url);
    if (known) Object.assign(known, source);
    else if (item.sources.length < MAX_SOURCES) item.sources.push(source);
  }
  if (unavailable) item.unavailable = unavailable;
  // Resolved player requests can arrive later. Keep those available for inspection.
  if (item.sources.length) delete item.unavailable;
  item.pageUrl = context.pageUrl;
  if (!existing && items.length < MAX_ITEMS) items.push(item);
  return items;
}

export function safeFilename(value, extension = '') {
  let name = String(value || 'Media').normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim();
  name = name.replace(/\.(mp4|m4a|webm|mkv|mp3|aac|ogg|opus|wav|flac)$/i, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `Media-${name || 'download'}`;
  return name.slice(0, 140) + (extension ? `.${extension}` : '');
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const time = Math.floor(seconds);
  return time >= 3600 ? `${Math.floor(time / 3600)}:${String(Math.floor(time % 3600 / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}` : `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}

export function sizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const unit = bytes >= 1e9 ? 'GB' : bytes >= 1e6 ? 'MB' : 'KB';
  return `${(bytes / (unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3)).toFixed(1)} ${unit}`;
}

export function readableError(error) {
  if (error?.code === 'YOUTUBE_LOOKUP') return error.message;
  const text = String(error?.message || error || 'Download failed');
  if (/abort|cancel/i.test(text)) return 'Cancelled.';
  if (error?.code === 'YOUTUBE_REFUSED') return 'YouTube refused this stream. The video may play normally while downloading is unsupported by this version.';
  if (/403|401/i.test(text)) return 'The site refused this request. Play the item, rescan, and try again while signed in.';
  if (/failed to fetch|networkerror|load failed|timeout/i.test(text)) return 'The media server could not be reached. Check your connection, play the item again, and rescan.';
  if (/quota|disk|space/i.test(text)) return 'Browser storage is full. Free disk space and try again.';
  if (/DRM|encrypted|decryption/i.test(text)) return 'This protected stream cannot be downloaded.';
  return text.replace(/https?:\/\/\S+/g, '[media URL]').slice(0, 280);
}
