import { httpUrl, mediaKind } from './core.js';
import { youtubeThumbnail } from './youtube.js';
import { validVimeoId } from './vimeo.js';

const firstUrl = value => typeof value === 'string' ? value : value?.UrlList?.[0] || value?.urlList?.[0] || value?.url_list?.[0] || value?.url;
function instagramSources(node) {
  const sources = node.video_versions.map(version => ({ url: version.url, width: version.width, height: version.height, kind: 'file' }));
  const manifest = node.video_dash_manifest;
  // Instagram's SegmentBase representations are complete MP4 resources. Taking
  // their BaseURLs also supplies the separate audio omitted by video_versions.
  if (typeof manifest === 'string' && manifest.length < 1000000 && /<SegmentBase\b/.test(manifest) && !/<(?:ContentProtection|SegmentTemplate|SegmentList)\b/.test(manifest)) {
    for (const match of manifest.matchAll(/<BaseURL(?:\s[^>]*)?>([^<]+)<\/BaseURL>/g)) {
      const url = match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
      if (httpUrl(url)) sources.push({ url, kind: 'file' });
    }
  }
  return sources;
}
export function youtubeMedia(player) {
  if (!player?.videoDetails?.videoId) return [];
  const streaming = player.streamingData || {};
  const sources = [];
  for (const format of [...(streaming.formats || []), ...(streaming.adaptiveFormats || [])]) {
    // Ciphered URLs are deliberately left to observed, resolved player requests.
    if (httpUrl(format.url)) sources.push({ url: format.url, kind: 'file', height: format.height, width: format.width, fps: format.fps, bitrate: format.bitrate, mime: format.mimeType, label: format.qualityLabel });
  }
  for (const [key, kind] of [['hlsManifestUrl', 'hls'], ['dashManifestUrl', 'dash']]) {
    if (httpUrl(streaming[key])) sources.push({ url: streaming[key], kind });
  }
  const detail = player.videoDetails;
  return [{ key: `youtube:${detail.videoId}`, title: detail.title, duration: Number(detail.lengthSeconds), thumbnail: detail.thumbnail?.thumbnails?.at(-1)?.url || youtubeThumbnail(detail.videoId), rank: 3, sources }];
}

export function extractJsonMedia(root, context = {}) {
  const output = [];
  const stack = [[root, 0]];
  const seen = new Set();
  let visited = 0;
  while (stack.length && visited++ < 18000 && output.length < 40) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 18) continue;
    seen.add(node);
    if (node.streamingData && node.videoDetails) output.push(...youtubeMedia(node));
    if (Array.isArray(node.video_versions)) {
      output.push({ key: `instagram:${node.pk || node.id || node.code || node.video_versions[0]?.url}`, title: node.caption?.text || node.accessibility_caption || context.title, thumbnail: node.image_versions2?.candidates?.[0]?.url, duration: node.video_duration, rank: 3,
        sources: instagramSources(node) });
    }
    if (node.video && (node.video.playAddr || node.video.play_addr || node.video.bitrateInfo)) {
      const video = node.video;
      const sources = [];
      for (const rate of video.bitrateInfo || video.bit_rate || []) {
        sources.push({ url: firstUrl(rate.PlayAddr || rate.play_addr), kind: 'file', bitrate: rate.Bitrate || rate.bit_rate, width: rate.PlayAddr?.Width, height: rate.PlayAddr?.Height });
      }
      sources.push({ url: firstUrl(video.playAddr || video.play_addr || video.downloadAddr), kind: 'file', height: video.height, width: video.width });
      output.push({ key: `tiktok:${node.id || node.aweme_id || firstUrl(video.playAddr)}`, title: node.desc || context.title, thumbnail: firstUrl(video.cover || video.originCover), duration: video.duration, sources, rank: 3 });
    }
    if (node.request?.files && validVimeoId(node.video?.id)) {
      const files = node.request.files;
      const sources = (files.progressive || []).map(file => ({ url: file.url, kind: 'file', width: file.width, height: file.height, mime: file.mime }));
      for (const [kind, data] of [['hls', files.hls], ['dash', files.dash]]) {
        const cdn = data?.cdns?.[data.default_cdn];
        for (const url of new Set([cdn?.url, cdn?.avc_url])) {
          // Vimeo's playlist.json is its own transport, not an MPD. HLS is
          // offered alongside it; only actual DASH manifests belong here.
          if (httpUrl(url) && (kind !== 'dash' || !new URL(url).pathname.endsWith('.json'))) sources.push({ url, kind });
        }
      }
      output.push({ key: `vimeo:${node.video.id}`, title: node.video.title, thumbnail: node.video.thumbnail_url || node.video.thumbs?.base || Object.values(node.video.thumbs || {})[0], duration: node.video.duration, sources, rank: 3 });
    }
    for (const key of ['contentUrl', 'audio_url', 'audioUrl', 'video_url', 'videoUrl', 'hls_url', 'hlsUrl']) {
      const url = node[key];
      if (httpUrl(url) && mediaKind(url)) output.push({ title: node.name || node.title || context.title, thumbnail: firstUrl(node.thumbnailUrl), sources: [{ url, kind: mediaKind(url) }], rank: 2 });
    }
    if (Array.isArray(node)) for (const child of node.slice(0, 1500)) stack.push([child, depth + 1]);
    else for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push([child, depth + 1]);
  }
  return output;
}
