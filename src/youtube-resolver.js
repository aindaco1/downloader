import { cleanSource, MAX_SOURCES } from './core.js';
import { validYoutubeId } from './youtube.js';
import { boundedText } from './network.js';

// A public player client that currently exposes direct tracks alongside SABR.
// Keep its version and request identity together. No player code is downloaded.
const visionos = {
  clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
};
const android = {
  clientName: 'ANDROID', clientVersion: '21.26.364', androidSdkVersion: 30,
  userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
  osName: 'Android', osVersion: '11', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
};
const television = {
  clientName: 'TVHTML5', clientVersion: '5.20260707', deviceMake: 'Samsung', deviceModel: 'UKS9800',
  userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1',
  osName: 'Tizen', osVersion: '2.4.0', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
};
const clients = { visionos: { id: '101', context: visionos }, android: { id: '3', context: android }, television: { id: '7', context: television } };
const origin = 'https://www.youtube.com';
const endpoint = `${origin}/youtubei/v1/player?prettyPrint=false`;

export function youtubePlayerRule(extensionId, name = 'visionos') {
  const client = clients[name].context;
  return {
    id: 2, priority: 2,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Origin', operation: 'set', value: origin },
      { header: 'User-Agent', operation: 'set', value: client.userAgent },
    ] },
    condition: { initiatorDomains: [extensionId], urlFilter: `|${endpoint}|`, resourceTypes: ['xmlhttprequest'], requestMethods: ['post'] },
  };
}

export function youtubeVisitor(html) {
  const match = html.match(/"(?:visitorData|VISITOR_DATA)"\s*:\s*("(?:[^"\\]|\\.){1,8192}")/);
  let value;
  try { value = match && JSON.parse(match[1]); } catch { /* Invalid page data is not a visitor context. */ }
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+/%=-]{10,4096}$/.test(value)) throw new Error('YouTube did not provide a download session. Open the video again and retry.');
  return value;
}

export function youtubeResolvedSources(player, videoId) {
  if (player?.playabilityStatus?.status !== 'OK') {
    if (player?.playabilityStatus?.status === 'LOGIN_REQUIRED') throw new Error('YouTube requires account or playback verification for this video. The public download fallback cannot access it.');
    throw new Error('YouTube did not make this video available to the download fallback.');
  }
  if (player.videoDetails?.videoId !== videoId) throw new Error('YouTube returned a different video. The download was stopped.');
  if (player.videoDetails?.isLive || player.streamingData?.isLive) throw new Error('Live recording is outside this version.');
  const streaming = player.streamingData || {};
  if (streaming.drmFamilies?.length || streaming.licenseInfos?.length) throw new Error('This protected stream cannot be downloaded.');
  const sources = [];
  const formats = [...(streaming.adaptiveFormats || []), ...(streaming.formats || [])];
  const hasDefaultAudio = formats.some(format => /^audio\//.test(format.mimeType || '') && format.audioTrack?.audioIsDefault === true);
  for (const format of formats) {
    if (format.drmFamilies?.length || format.drmTrackType || !/^(video|audio)\//.test(format.mimeType || '')) continue;
    if (hasDefaultAudio && /^audio\//.test(format.mimeType) && format.audioTrack?.audioIsDefault !== true) continue;
    const source = cleanSource({ url: format.url, kind: 'file', mime: format.mimeType, height: format.height, width: format.width, fps: format.fps, bitrate: format.bitrate, size: format.contentLength, label: format.qualityLabel });
    if (!source) continue;
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback' || !url.searchParams.has('itag') || url.searchParams.get('sabr') === '1' || url.searchParams.has('sq')) continue;
    if (!sources.some(known => known.url === source.url)) sources.push(source);
  }
  if (!sources.length) throw new Error('YouTube did not expose compatible download tracks for this video.');
  // Inspect one compatible source per resolution/frame rate and one default
  // audio track. Prefer AAC for MP4 playback; keep other codecs when needed.
  // Duplicate codecs and auto-dubs can exhaust inspection time on long videos.
  const compatibility = source => /avc1/.test(source.mime) ? 0 : /vp9|vp09/.test(source.mime) ? 1 : 2;
  const unique = (values, key) => {
    const selected = new Map();
    for (const value of values) if (!selected.has(key(value))) selected.set(key(value), value);
    return [...selected.values()];
  };
  const audio = sources.filter(source => source.mime.startsWith('audio/'))
    .sort((a, b) => Number(!a.mime.startsWith('audio/mp4')) - Number(!b.mime.startsWith('audio/mp4')) || b.bitrate - a.bitrate).slice(0, 1);
  const video = unique(sources.filter(source => source.mime.startsWith('video/')).sort((a, b) => b.height - a.height || compatibility(a) - compatibility(b) || b.bitrate - a.bitrate), source => source.height ? `${source.width}x${source.height}:${source.fps || 0}` : source.url);
  return [...video.slice(0, MAX_SOURCES - audio.length), ...audio];
}

// The page may change only the URL's n value. Treat all other returned data as
// untrusted and keep the original signed host, path, parameters and metadata.
export function youtubePreparedSources(sources, urls) {
  if (!Array.isArray(urls) || urls.length !== sources.length) throw new Error('YouTube URL preparation was unavailable.');
  return sources.map((source, index) => {
    const original = new URL(source.url);
    const prepared = new URL(urls[index]);
    const n = prepared.searchParams.get('n');
    if (!original.searchParams.has('n') && n !== null) throw new Error('YouTube changed the media URL unexpectedly.');
    if (original.searchParams.has('n') && (!n || n === original.searchParams.get('n') || !/^[\w-]{1,512}$/.test(n))) throw new Error('YouTube URL preparation failed.');
    prepared.searchParams.delete('n'); original.searchParams.delete('n');
    if (prepared.href !== original.href) throw new Error('YouTube changed the media URL unexpectedly.');
    const url = new URL(source.url);
    if (n) url.searchParams.set('n', n);
    return { ...source, url: url.href };
  });
}

export async function resolveYoutube(videoId, signal = AbortSignal.timeout(25000), prepareClient = async () => {}, prepareUrls) {
  if (!validYoutubeId(videoId)) throw new Error('Invalid YouTube video.');
  async function read(url, options) {
    const response = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`YouTube download lookup failed (HTTP ${response.status}). Try again later.`), { code: 'YOUTUBE_LOOKUP' });
    }
    return boundedText(response, 6000000);
  }
  // Bootstrap an anonymous visitor context, separate from the signed-in page.
  // It stays in this call and is never saved in extension storage or logs.
  const html = await read(`${origin}/watch?v=${videoId}`);
  const visitorData = youtubeVisitor(html);
  const signatureTimestamp = Number(html.match(/"STS"\s*:\s*(\d{1,6})\b/)?.[1]);
  async function request(name) {
    const { id, context: client } = clients[name];
    await prepareClient(name);
    const text = await read(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': id, 'X-YouTube-Client-Version': client.clientVersion, 'X-Goog-Visitor-Id': visitorData },
      body: JSON.stringify({ context: { client: { ...client, visitorData } }, videoId, ...(name === 'television' ? { playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp } } } : {}) }),
    });
    try { return JSON.parse(text); } catch { throw new Error('YouTube returned an unreadable download response.'); }
  }
  let player = await request('visionos');
  // VISIONOS cannot play uploads marked made for kids. Android can expose a
  // combined MP4 for these even when the web player supplies only SABR. Try
  // that public client once, only for a matching unavailable response; account
  // verification, HTTP failures, live and protected responses remain terminal.
  let usedAndroid = false;
  if (player?.playabilityStatus?.status === 'UNPLAYABLE' && player.videoDetails?.videoId === videoId && !player.videoDetails.isLive && !player.streamingData?.isLive && !player.streamingData?.drmFamilies?.length && !player.streamingData?.licenseInfos?.length) {
    player = await request('android'); usedAndroid = true;
  }
  const sources = youtubeResolvedSources(player, videoId);
  // Android may expose only its combined 360p stream. The TV client offers
  // adaptive tracks, whose URLs must first pass through the loaded web player.
  // Keep the working combined source if this optional upgrade is unavailable.
  if (usedAndroid && prepareUrls && signatureTimestamp > 0) {
    try {
      const resolved = youtubeResolvedSources(await request('television'), videoId);
      const height = Math.max(0, ...sources.filter(source => source.mime.startsWith('video/')).map(source => source.height || 0));
      const higher = resolved.filter(source => source.mime.startsWith('audio/') || source.height > height);
      if (higher.some(source => source.mime.startsWith('video/'))) {
        const prepared = youtubePreparedSources(higher, await prepareUrls(higher.map(source => source.url), signatureTimestamp));
        signal.throwIfAborted();
        return [...prepared.slice(0, MAX_SOURCES - sources.length), ...sources];
      }
    } catch { signal.throwIfAborted(); }
  }
  return sources;
}
