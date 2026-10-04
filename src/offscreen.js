import { readableError } from './core.js';
import { createProgressReporter } from './progress.js';

let task = null;
const completed = new Map();
const engine = () => import('./engine.js');
const notify = event => chrome.runtime.sendMessage({ target: 'background', type: 'engine-event', event }).catch(() => {});
const directory = navigator.storage.getDirectory().then(root => root.getDirectoryHandle('dust-wave-temporary', { create: true }));
const initialCleanup = directory.then(async dir => { for await (const [name] of dir.entries()) await dir.removeEntry(name).catch(() => {}); });

async function run(job) {
  const controller = task.controller;
  let blobUrl;
  const reporter = createProgressReporter(progress => void notify({ id: job.id, status: 'processing', ...progress }));
  const heartbeat = setInterval(() => reporter.update({}), 10000);
  try {
    await initialCleanup;
    controller.signal.throwIfAborted();
    const dir = await directory;
    const file = await dir.getFileHandle(job.id, { create: true });
    const writable = await file.createWritable();
    const { writeMedia } = await engine();
    await writeMedia(job.media, job.choice, writable, controller.signal, reporter.update);
    reporter.stop();
    controller.signal.throwIfAborted();
    const result = await file.getFile();
    const mime = { mp4: 'video/mp4', m4a: 'audio/x-m4a', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' }[job.choice.extension];
    blobUrl = URL.createObjectURL(result.slice(0, result.size, mime));
    completed.set(job.id, blobUrl);
    task = null;
    await notify({ id: job.id, status: 'ready', blobUrl, bytes: result.size, progress: 1 });
  } catch (error) {
    reporter.stop();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    completed.delete(job.id);
    await (await directory).removeEntry(job.id).catch(() => {});
    task = null;
    await notify({ id: job.id, status: controller.signal.aborted ? 'cancelled' : 'error', error: readableError(error) });
  } finally { clearInterval(heartbeat); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  (async () => {
    if (message.type === 'ping') return { active: task?.id || null, retained: completed.size };
    if (message.type === 'release') {
      if (completed.has(message.id)) URL.revokeObjectURL(completed.get(message.id));
      completed.delete(message.id);
      await (await directory).removeEntry(message.id).catch(() => {});
      return {};
    }
    if (message.type === 'cancel') {
      if (task?.id === message.id || message.id === 'inspect') task?.controller.abort();
      return {};
    }
    if (task) throw new Error('A media task is already running.');
    if (message.type === 'inspect') {
      const controller = new AbortController();
      task = { id: 'inspect', controller };
      const timeout = setTimeout(() => controller.abort(new Error('Inspection timed out. Play the media and try again.')), 45000);
      try { return await (await engine()).inspectMedia(message.media, controller.signal); }
      finally { clearTimeout(timeout); task = null; }
    }
    if (message.type === 'start') {
      task = { id: message.job.id, controller: new AbortController() };
      void run(message.job);
      return {};
    }
    throw new Error('Unknown media task.');
  })().then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: readableError(error) }));
  return true;
});
