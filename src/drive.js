import { httpUrl } from './core.js';

export const driveFileId = value => typeof value === 'string' && /^[\w-]{10,200}$/.test(value) ? value : null;
export function drivePageId(value) {
  const safe = httpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.hostname !== 'drive.google.com') return null;
  return driveFileId(url.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/)?.[1] || (['/open', '/uc'].includes(url.pathname) ? url.searchParams.get('id') : null));
}

export function driveDownloadId(value) {
  const safe = httpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname) || !/^\/(?:u\/\d+\/)?(?:uc|download)$/.test(url.pathname) || url.searchParams.get('export') !== 'download') return null;
  return driveFileId(url.searchParams.get('id'));
}

export function driveExtension(mime, title) {
  const type = String(mime || '').split(';')[0].toLowerCase();
  const extensions = {
    'video/quicktime': ['mov'], 'video/mp4': ['mp4', 'm4v'], 'video/x-m4v': ['m4v'], 'video/webm': ['webm'], 'video/x-matroska': ['mkv'],
    'audio/mpeg': ['mp3'], 'audio/mp4': ['m4a'], 'audio/x-m4a': ['m4a'], 'audio/aac': ['aac'], 'audio/ogg': ['ogg', 'opus'], 'audio/opus': ['opus'],
    'audio/wav': ['wav'], 'audio/x-wav': ['wav'], 'audio/flac': ['flac'], 'audio/x-flac': ['flac'],
  }[type];
  const suffix = String(title || '').split('.').at(-1).toLowerCase();
  return extensions?.includes(suffix) ? suffix : extensions?.[0] || null;
}

export function driveMedia(viewer, pageUrl) {
  const id = drivePageId(pageUrl);
  const item = viewer?.itemJson;
  if (!id || viewer?.config?.id !== id || !Array.isArray(item)) return [];
  const title = String(viewer.config.title || item[1] || '').trim();
  const mime = item[11];
  // Use the viewer's download link, never invent a link for a file whose owner
  // has disabled downloading. Google checks access again when it is fetched.
  const url = httpUrl(item[18]);
  if (!driveExtension(mime, title) || driveDownloadId(url) !== id) return [];
  const download = new URL(url);
  const resourceKey = viewer.config.documentResourceKey || new URL(pageUrl).searchParams.get('resourcekey');
  if (typeof resourceKey === 'string' && /^[\w-]{1,200}$/.test(resourceKey) && !download.searchParams.has('resourcekey')) download.searchParams.set('resourcekey', resourceKey);
  return [{ key: `drive:${id}`, title, thumbnail: httpUrl(item[2]), rank: 3, sources: [{ url: download.href, kind: 'file', mime, label: 'Original file', size: Number(item[25]?.[2]) }] }];
}
