import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

export async function startServer() {
  const root = path.resolve('tests/fixtures');
  const requests = [];
  const denied = new Set();
  let base;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname.slice(1);
    const query = url.search;
    requests.push({ path: url.pathname, cookie: Boolean(req.headers.cookie?.includes('fixture_session=yes')), referer: req.headers.referer, range: req.headers.range });
    if (/^error(401|403|404)$/.test(name) || ['transient', 'expired', 'denied-hls', 'network-fail', 'network-recover', 'gzip-hls'].includes(name)) {
      const media = name === 'gzip-hls' ? 'master.m3u8?compressed=1' : name === 'denied-hls' ? 'denied.m3u8' : `${name}.mp4`;
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Fixture ${name}</title><h1>${name}</h1><script type="application/json">${JSON.stringify({ contentUrl: `${base}/${media}`, name: `Fixture ${name}` })}</script>`); return;
    }
    const refused = name.match(/^error(401|403|404)\.mp4$/);
    if (refused || name === 'denied.ts' || denied.has(name)) { res.writeHead(refused ? Number(refused[1]) : 403).end(); return; }
    if (name === 'transient.mp4' && requests.filter(request => request.path === url.pathname).length === 1) { res.writeHead(503).end(); return; }
    if (name === 'network-fail.mp4' || (name === 'network-recover.mp4' && requests.filter(request => request.path === url.pathname).length === 1)) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-encoding': 'gzip' }).end('invalid compressed response'); return;
    }
    if (name === 'denied.m3u8') {
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\ndenied.ts\n#EXT-X-ENDLIST\n'); return;
    }
    if (['direct', 'hls', 'dash', 'split', 'signed', 'slow', 'gallery'].includes(name)) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (name === 'signed') res.setHeader('set-cookie', 'fixture_session=yes; HttpOnly; SameSite=Lax; Path=/');
      const sources = ['direct', 'signed', 'gallery'].includes(name) ? `<video controls preload="metadata" poster="/poster.png"><source src="/${name === 'signed' ? 'signed' : 'combined'}.mp4${query}" type="video/mp4">${name === 'gallery' ? '<source src="/low.mp4" type="video/mp4">' : ''}</video>` : '';
      const fetchPath = { hls: 'master.m3u8', dash: `manifest.mpd${query}`, slow: 'master.m3u8?slow=1' }[name];
      const json = name === 'split' ? `<script type="application/json">${JSON.stringify({ videoDetails: { videoId: 'test', title: 'Separate video and audio' }, streamingData: { adaptiveFormats: [{ url: `${base}/video${url.searchParams.has('faststart') ? '-faststart' : ''}.mp4${query}`, height: 360 }, { url: `${base}/audio.m4a${query}` }] } })}</script>` : '';
      res.end(`<!doctype html><title>${name === 'gallery' ? 'A study in color — Studio session' : `Fixture ${name}`}</title><h1>Local media fixture: ${name}</h1>${sources}${json}${fetchPath ? `<script>fetch('/${fetchPath}')</script>` : ''}`); return;
    }
    if (name.includes('/') || name.includes('..')) { res.writeHead(404).end(); return; }
    if (name === 'signed.mp4' && (!req.headers.cookie?.includes('fixture_session=yes') || req.headers.referer !== `${base}/signed`)) { res.writeHead(403).end(); return; }
    try {
      let bytes = await readFile(path.join(root, ['transient.mp4', 'expired.mp4', 'network-recover.mp4'].includes(name) ? 'combined.mp4' : name));
      if (url.searchParams.has('slow') && name.endsWith('.m3u8')) bytes = Buffer.from(bytes.toString().replace(/^(?!#)(.+\.(?:m3u8|ts))$/gm, '$1?slow=1'));
      if (url.searchParams.has('throttle') && name.endsWith('.mpd')) bytes = Buffer.from(bytes.toString().replaceAll('.m4s"', '.m4s?throttle=1"'));
      if (url.searchParams.has('compressed') && name.endsWith('.m3u8')) {
        bytes = Buffer.from(bytes.toString().replace(/^(?!#)(.+\.m3u8)$/gm, '$1?compressed=1'));
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
        res.setHeader('content-encoding', 'gzip');
        res.end(req.headers.range ? Buffer.from('invalid ranged compressed response') : gzipSync(bytes)); return;
      }
      const type = { '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml', '.ts': 'video/mp2t', '.m4s': 'video/mp4', '.png': 'image/png' }[path.extname(name)] || 'application/octet-stream';
      res.setHeader('content-type', type); res.setHeader('accept-ranges', 'bytes'); res.setHeader('cache-control', 'no-store');
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) { const start = Number(range[1]); const end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1); res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${end}/${bytes.length}`); bytes = bytes.subarray(start, end + 1); }
      if (!url.searchParams.has('unknown')) res.setHeader('content-length', bytes.length);
      if (url.searchParams.has('slow') && name.endsWith('.ts')) await new Promise(resolve => setTimeout(resolve, 2000));
      if (url.searchParams.has('throttle') && /\.(mp4|m4a|m4s)$/.test(name)) {
        for (let offset = 0; offset < bytes.length && !res.destroyed; offset += 32768) {
          res.write(bytes.subarray(offset, offset + 32768));
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        res.end(); return;
      }
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, requests, denied };
}
