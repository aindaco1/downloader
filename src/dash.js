import { parse } from 'mpd-parser';
import { httpUrl } from './core.js';

const quote = value => String(value || '').replace(/["\r\n]/g, '');
export function dashToHls(text, url) {
  if (text.length > 4000000) throw new Error('The manifest is too large.');
  if (/<(?:[\w-]+:)?ContentProtection\b/i.test(text)) throw new Error('DRM-protected DASH is unsupported.');
  if (/<(?:[\w-]+:)?MPD\b[^>]*type\s*=\s*["']dynamic/i.test(text)) throw new Error('Live streams are not supported in this version.');
  const parsed = parse(text, { manifestUri: url });
  const virtualBase = 'https://dust-wave.invalid/dash/';
  const files = new Map();
  const master = ['#EXTM3U', '#EXT-X-VERSION:7'];
  let count = 0;
  const addPlaylist = playlist => {
    if (!playlist.segments?.length || playlist.sidx) throw new Error('This DASH SegmentBase layout is not supported yet.');
    if (playlist.segments.length > 30000) throw new Error('This stream contains too many segments.');
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0', `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(Math.max(...playlist.segments.map(s => s.duration || 1))))}`];
    let lastMap = '';
    for (const segment of playlist.segments) {
      if (segment.key) throw new Error('Protected DASH segments are unsupported.');
      if (segment.discontinuity) lines.push('#EXT-X-DISCONTINUITY');
      if (segment.map) {
        const uri = httpUrl(segment.map.resolvedUri || segment.map.uri, url);
        if (!uri) throw new Error('Invalid initialization segment URL.');
        const range = segment.map.byterange;
        const map = `#EXT-X-MAP:URI="${quote(uri)}"${range ? `,BYTERANGE="${range.length}@${range.offset || 0}"` : ''}`;
        if (map !== lastMap) { lines.push(map); lastMap = map; }
      }
      const uri = httpUrl(segment.resolvedUri || segment.uri, url);
      if (!uri) throw new Error('Invalid segment URL.');
      lines.push(`#EXTINF:${segment.duration || 1},`);
      if (segment.byterange) lines.push(`#EXT-X-BYTERANGE:${segment.byterange.length}@${segment.byterange.offset || 0}`);
      lines.push(uri);
    }
    lines.push('#EXT-X-ENDLIST');
    const address = `${virtualBase}${count++}.m3u8`;
    files.set(address, lines.join('\n') + '\n');
    return address;
  };
  let hasAudio = false;
  for (const group of Object.values(parsed.mediaGroups?.AUDIO || {})) {
    for (const [name, audio] of Object.entries(group)) {
      for (const playlist of audio.playlists || []) {
        hasAudio = true;
        const address = addPlaylist(playlist);
        master.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${quote(name)}",DEFAULT=${audio.default ? 'YES' : 'NO'},AUTOSELECT=YES,URI="${address}"${audio.language ? `,LANGUAGE="${quote(audio.language)}"` : ''}`);
      }
    }
  }
  for (const playlist of parsed.playlists || []) {
    const address = addPlaylist(playlist);
    const attributes = playlist.attributes || {};
    const resolution = attributes.RESOLUTION;
    master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${attributes.BANDWIDTH || 1000000}${attributes.CODECS ? `,CODECS="${quote(attributes.CODECS)}"` : ''}${resolution ? `,RESOLUTION=${resolution.width}x${resolution.height}` : ''}${hasAudio ? ',AUDIO="audio"' : ''}`);
    master.push(address);
  }
  if (!files.size) throw new Error('No usable DASH tracks were found.');
  if (!parsed.playlists?.length) {
    // An audio-only MPD still needs an ordinary HLS variant.
    master.push('#EXT-X-STREAM-INF:BANDWIDTH=192000', [...files.keys()][0]);
  }
  const root = `${virtualBase}master.m3u8`;
  files.set(root, master.join('\n') + '\n');
  return { root, files };
}
