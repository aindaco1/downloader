const RUNNING = new Set(['processing', 'ready', 'saving']);
export const pending = job => RUNNING.has(job?.status);
export const downloading = job => pending(job) && !job.cancelRequested;

// One lightweight timer, only during a brief detection pulse or an active job.
// Frames are bundled PNGs; idle browsing never keeps the service worker awake.
export function createToolbarActivity(api = chrome.action) {
  let timer;
  let mode = 'idle';
  let frame = 0;
  let pulseUntil = 0;
  let lastPath;
  let lastTitle;
  let currentJob;
  let currentCount = 0;
  const draw = () => {
    const next = downloading(currentJob) ? 'download' : Date.now() < pulseUntil ? 'detected' : 'idle';
    if (next !== mode) { mode = next; frame = 0; }
    const path = mode === 'idle' ? currentCount ? 'icons/available-' : 'icons/' : `icons/${mode === 'download' && currentCount ? 'available-' : ''}${mode}-${frame % 8}-`;
    if (lastPath !== path) {
      lastPath = path;
      void api.setIcon({ path: { 16: `${path}16.png`, 32: `${path}32.png` } }).catch(() => {});
    }
    const percent = currentJob?.progress > 0 ? ` · ${Math.round(currentJob.progress * 100)}%` : '';
    const title = mode === 'download' ? `Downloading ${currentJob.filename}${percent}` : currentCount ? `Dust Wave Downloader · ${currentCount} media item${currentCount === 1 ? '' : 's'} available` : 'Dust Wave Downloader';
    if (title !== lastTitle) { lastTitle = title; void api.setTitle({ title }).catch(() => {}); }
    if (mode === 'idle') { clearInterval(timer); timer = undefined; }
  };
  return {
    update({ job, detected, count = 0 }) {
      currentJob = job;
      currentCount = count;
      if (detected) pulseUntil = Date.now() + 3600;
      // A download consumes the detection pulse. Cancel must stay still while
      // the engine unwinds, including when delayed progress events arrive.
      if (pending(job) || job?.cancelRequested || !count) pulseUntil = 0;
      draw();
      if (mode !== 'idle' && !timer) timer = setInterval(() => { frame++; draw(); }, 225);
    },
    stop() { currentJob = null; pulseUntil = 0; draw(); },
  };
}
