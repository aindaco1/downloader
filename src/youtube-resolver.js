import { cleanSource, MAX_SOURCES } from './core.js';
import { validYoutubeId } from './youtube.js';
import { boundedText } from './network.js';

// A public player client that currently exposes direct tracks alongside SABR.
// Keep its version and request identity together. No player JavaScript is run.
const client = {
  clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
};
const origin = 'https://www.youtube.com';
const endpoint = `${origin}/youtubei/v1/player?prettyPrint=false`;

export function youtubePlayerRule(extensionId) {
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
  for (const format of [...(streaming.adaptiveFormats || []), ...(streaming.formats || [])]) {
    if (format.drmFamilies?.length || format.drmTrackType || !/^(video|audio)\//.test(format.mimeType || '')) continue;
    const source = cleanSource({ url: format.url, kind: 'file', mime: format.mimeType, height: format.height, width: format.width, fps: format.fps, bitrate: format.bitrate, size: format.contentLength, label: format.qualityLabel });
    if (!source) continue;
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback' || !url.searchParams.has('itag') || url.searchParams.get('sabr') === '1' || url.searchParams.has('sq')) continue;
    if (!sources.some(known => known.url === source.url)) sources.push(source);
  }
  if (!sources.length) throw new Error('YouTube did not expose compatible download tracks for this video.');
  // Preserve audio even when a high-resolution video has many video formats.
  const audio = sources.filter(source => source.mime.startsWith('audio/')).sort((a, b) => b.bitrate - a.bitrate).slice(0, 6);
  const video = sources.filter(source => source.mime.startsWith('video/')).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
  return [...video.slice(0, MAX_SOURCES - audio.length), ...audio];
}

export async function resolveYoutube(videoId, signal = AbortSignal.timeout(25000)) {
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
  const visitorData = youtubeVisitor(await read(`${origin}/watch?v=${videoId}`));
  const text = await read(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '101', 'X-YouTube-Client-Version': client.clientVersion, 'X-Goog-Visitor-Id': visitorData },
    body: JSON.stringify({ context: { client: { ...client, visitorData } }, videoId }),
  });
  let player;
  try { player = JSON.parse(text); } catch { throw new Error('YouTube returned an unreadable download response.'); }
  return youtubeResolvedSources(player, videoId);
}
