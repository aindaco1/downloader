import {
  Input, UrlSource, HLS_FORMATS, HlsInputFormat, MP4, WEBM, MP3, OGG, WAVE, FLAC, ADTS,
  Output, StreamTarget, Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat,
  Mp3OutputFormat, OggOutputFormat, WavOutputFormat, FlacOutputFormat, Conversion, EncodedPacketSink, Logging, LogLevel,
} from 'mediabunny';
import { dashToHls } from './dash.js';
import { httpUrl, readableError } from './core.js';
import { isYoutubeMedia } from './youtube.js';
import { boundedText } from './network.js';

const formats = [...HLS_FORMATS, MP4, WEBM, MP3, OGG, WAVE, FLAC, ADTS];
const classes = { mp4: Mp4OutputFormat, m4a: Mp4OutputFormat, webm: WebMOutputFormat, mkv: MkvOutputFormat, mp3: Mp3OutputFormat, ogg: OggOutputFormat, wav: WavOutputFormat, flac: FlacOutputFormat };
const forgiving = async promise => { try { return await promise; } catch { return null; } };

// A recovery attempt is diagnostic, not a failed task. Use the library's public
// logger so stream-resume behavior stays intact and unrelated errors stay visible.
Logging.level = LogLevel.Silent;
for (const level of ['error', 'warn', 'info']) Logging.on(level, args => {
  if (level === 'error' && /^(Retrying failed fetch\. Error:|Error while reading response stream\. Attempting to resume\.)$/.test(args[0])) {
    console.debug('Retrying media request:', readableError(args[1]));
  } else console[level](...args);
});

export function mediaRetryDelay(attempt, error) {
  if (attempt >= 2 || error?.name === 'AbortError') return null;
  // A denied or expired URL needs fresh page data, not the same request again.
  if (Number.isFinite(error?.status) && ![408, 429, 500, 502, 503, 504].includes(error.status)) return null;
  return 1;
}

export function createSession(signal, onBytes = () => {}) {
  const inputs = [];
  const virtualFiles = new Map();
  const playlists = new Set();
  async function fetchMedia(resource, options = {}) {
    signal.throwIfAborted();
    const url = resource instanceof Request ? resource.url : String(resource);
    if (virtualFiles.has(url)) return new Response(virtualFiles.get(url), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (!httpUrl(url)) throw new Error('Only HTTP and HTTPS media can be read.');
    // Playlists are small text documents. Some CDNs (including Vimeo) return
    // undecodable compressed responses when asked for a byte range of one.
    if (playlists.has(url) || /\.m3u8$/i.test(new URL(url).pathname)) {
      const headers = new Headers(options.headers ?? (resource instanceof Request ? resource.headers : undefined));
      headers.delete('range');
      options = { ...options, headers };
    }
    const combined = AbortSignal.any([signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(90000)]);
    const response = await fetch(resource, { ...options, signal: combined, credentials: 'include' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`The media server returned HTTP ${response.status}.`), {
        status: response.status,
        code: [401, 403].includes(response.status) && isYoutubeMedia(url) ? 'YOUTUBE_REFUSED' : undefined,
      });
    }
    if (!response.body) return response;
    const body = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { onBytes(chunk.byteLength); controller.enqueue(chunk); } }));
    const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperties(wrapped, { url: { value: response.url }, redirected: { value: response.redirected } });
    return wrapped;
  }
  return {
    inputs,
    fetch: fetchMedia,
    async open(source) {
      let url = source.url;
      if (source.kind === 'hls') playlists.add(url);
      if (source.kind === 'dash') {
        const text = await boundedText(await fetchMedia(url));
        const converted = dashToHls(text, url);
        // Each MPD has its own virtual namespace to avoid collisions.
        const prefix = `https://dust-wave.invalid/dash-${inputs.length}/`;
        for (const [key, value] of converted.files) virtualFiles.set(key.replace('https://dust-wave.invalid/dash/', prefix), value.replaceAll('https://dust-wave.invalid/dash/', prefix));
        url = converted.root.replace('https://dust-wave.invalid/dash/', prefix);
      }
      const input = new Input({ source: new UrlSource(url, { fetchFn: fetchMedia, maxCacheSize: 16 * 1024 * 1024, parallelism: 2, getRetryDelay: mediaRetryDelay }), formats });
      inputs.push(input);
      return input;
    },
    dispose() { for (const input of inputs) input.dispose(); },
  };
}

function container(videoCodec, audioCodec) {
  if (!videoCodec) {
    if (audioCodec === 'aac') return 'm4a';
    if (audioCodec === 'mp3') return 'mp3';
    if (['opus', 'vorbis'].includes(audioCodec)) return 'ogg';
    if (audioCodec === 'flac') return 'flac';
    if (audioCodec?.startsWith('pcm-')) return 'wav';
  }
  const candidates = ['vp8', 'vp9'].includes(videoCodec) ? ['webm', 'mp4', 'mkv'] : ['mp4', 'webm', 'mkv'];
  return candidates.find(name => {
    const format = new classes[name]();
    return (!videoCodec || format.getSupportedVideoCodecs().includes(videoCodec)) && (!audioCodec || format.getSupportedAudioCodecs().includes(audioCodec));
  });
}

export async function inspectMedia(media, signal) {
  const session = createSession(signal);
  const tracks = []; const warnings = [];
  try {
    for (const [sourceIndex, source] of media.sources.entries()) {
      signal.throwIfAborted();
      try {
        const input = await session.open(source);
        const isHls = await input.getFormat() instanceof HlsInputFormat;
        const found = await input.getTracks();
        const readableTracks = [];
        for (const track of found.slice(0, 64)) {
          if (await track.isLive()) throw new Error('Live recording is outside this version.');
          if (isHls && track.isVideoTrack() && await track.hasOnlyKeyPackets()) continue;
          const codec = await track.getCodec();
          if (!codec) continue;
          // A manifest may reveal a codec while the actual packets are protected.
          if (!await new EncodedPacketSink(track).getFirstPacket()) continue;
          const video = track.isVideoTrack();
          const [duration, bitrate, height, width, language] = await Promise.all([
            forgiving(track.getDurationFromMetadata()), forgiving(track.getAverageBitrate()),
            video ? forgiving(track.getDisplayHeight()) : null, video ? forgiving(track.getDisplayWidth()) : null,
            forgiving(track.getLanguageCode()),
          ]);
          // HLS BANDWIDTH describes the whole variant, not its audio track.
          readableTracks.push({ track, input, sourceIndex, video, codec, duration, bitrate: !video && isHls ? null : bitrate || source.bitrate, height, width, language });
        }
        tracks.push(...readableTracks);
      } catch (error) { signal.throwIfAborted(); warnings.push(readableError(error)); }
    }
    const choices = [];
    const audios = tracks.filter(track => !track.video).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const ref = track => track ? { sourceIndex: track.sourceIndex, trackId: track.track.id } : null;
    for (const track of tracks) {
      if (!track.video) continue;
      let audio = audios.find(candidate => candidate.input === track.input && track.track.canBePairedWith(candidate.track));
      // Cross-input pairing is allowed only within the same discovered media item.
      if (!audio) audio = audios.find(candidate => candidate.input !== track.input);
      const extension = container(track.codec, audio?.codec);
      if (!extension) continue;
      choices.push({ type: 'video', extension, height: track.height, width: track.width, duration: track.duration, codec: track.codec, audioCodec: audio?.codec || null, bitrate: (track.bitrate || 0) + (audio?.bitrate || 0), video: ref(track), audio: ref(audio), label: `${track.height ? `${track.width} × ${track.height}` : 'Original video'} · ${track.codec.toUpperCase()}${audio ? '' : ' · no audio'}` });
    }
    for (const audio of audios) {
      const extension = container(null, audio.codec);
      if (!extension) continue;
      choices.push({ type: 'audio', extension, codec: audio.codec, duration: audio.duration, bitrate: audio.bitrate, video: null, audio: ref(audio), label: `${audio.codec.toUpperCase()}${audio.bitrate ? ` · ${Math.round(audio.bitrate / 1000)} kbps` : ' · original quality'}${audio.language && audio.language !== 'und' ? ` · ${audio.language}` : ''}` });
    }
    choices.sort((a, b) => (a.type === b.type ? 0 : a.type === 'video' ? -1 : 1) || (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
    choices.forEach((choice, index) => {
      choice.id = String(index);
      const references = [choice.video, choice.audio].filter(Boolean);
      const sourceIndex = references[0]?.sourceIndex;
      const source = media.sources[sourceIndex];
      const matching = tracks.filter(track => track.sourceIndex === sourceIndex);
      if (source?.kind === 'file' && references.every(ref => ref.sourceIndex === sourceIndex) && matching.length === references.length && new URL(source.url).pathname.toLowerCase().endsWith(`.${choice.extension}`)) choice.directUrl = source.url;
    });
    const labels = new Map();
    for (const choice of choices) labels.set(choice.label, (labels.get(choice.label) || 0) + 1);
    const positions = new Map();
    for (const choice of choices) if (labels.get(choice.label) > 1) {
      const index = (positions.get(choice.label) || 0) + 1;
      positions.set(choice.label, index);
      choice.label += ` · source ${index}`;
    }
    if (!choices.length) throw new Error(warnings[0] || 'No downloadable tracks were found. Play the item, choose a quality in its player, and rescan.');
    return { choices, warnings: [...new Set(warnings)].slice(0, 3) };
  } finally { session.dispose(); }
}

export async function writeMedia(media, choice, writable, signal, onProgress) {
  let bytes = 0;
  const session = createSession(signal, count => { bytes += count; onProgress({ bytes }); });
  const opened = new Map(); const conversions = []; let output;
  const abort = () => { session.dispose(); for (const conversion of conversions) void conversion.cancel().catch(() => {}); if (output) void output.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (choice.directUrl && media.sources.some(source => source.url === choice.directUrl && source.kind === 'file')) {
      const response = await session.fetch(choice.directUrl);
      if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('The site returned a sign-in page instead of media. Play the item and try again.');
      const size = Number(response.headers.get('content-length'));
      const progress = new TransformStream({ transform(chunk, controller) { onProgress({ bytes, progress: size > 0 ? Math.min(.99, bytes / size) : null }); controller.enqueue(chunk); } });
      await response.body.pipeThrough(progress).pipeTo(writable, { signal });
      return;
    }
    const selections = [];
    for (const [kind, selected] of [['video', choice.video], ['audio', choice.audio]]) {
      if (!selected) continue;
      const source = media.sources[selected.sourceIndex];
      if (!source) throw new Error('The source changed. Rescan and select the quality again.');
      if (!opened.has(selected.sourceIndex)) opened.set(selected.sourceIndex, await session.open(source));
      const input = opened.get(selected.sourceIndex);
      const track = (await input.getTracks()).find(candidate => candidate.id === selected.trackId);
      if (!track || track.isVideoTrack() !== (kind === 'video') || await track.isLive()) throw new Error('The selected track is no longer available. Rescan and try again.');
      const expected = kind === 'video' ? choice.codec : choice.audioCodec || choice.codec;
      if (await track.getCodec() !== expected) throw new Error('The source codec changed. Rescan and try again.');
      selections.push({ input, track });
    }
    if (!selections.length) throw new Error('Select a media track first.');
    const Format = classes[choice.extension];
    if (!Format) throw new Error('Unsupported output format.');
    output = new Output({ format: new Format(), target: new StreamTarget(writable, { chunked: true, chunkSize: 2 ** 20 }) });
    for (const input of new Set(selections.map(value => value.input))) {
      const selected = selections.filter(value => value.input === input).map(value => value.track);
      const conversion = await Conversion.init({ input, output, composable: true, tracks: 'all', copy: { mode: 'forced' }, showWarnings: false,
        video: track => ({ discard: !selected.includes(track) }), audio: track => ({ discard: !selected.includes(track) }),
      });
      if (conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')) throw new Error('These tracks cannot be combined without re-encoding. Choose another source quality.');
      conversions.push(conversion);
    }
    await output.start();
    const progress = conversions.map(() => 0);
    conversions.forEach((conversion, index) => { conversion.onProgress = value => { progress[index] = value; onProgress({ bytes, progress: Math.min(.99, ...progress) }); }; });
    await Promise.all(conversions.map(conversion => conversion.execute()));
    signal.throwIfAborted();
    await output.finalize();
  } catch (error) {
    if (output) await output.cancel().catch(() => {});
    else await writable.abort().catch(() => {});
    throw error;
  } finally { signal.removeEventListener('abort', abort); session.dispose(); }
}
