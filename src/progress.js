// Keep the latest bytes and percentage together, including the final update
// in a network burst. Stop before a terminal event so a timer cannot revive it.
export function createProgressReporter(send, interval = 450) {
  const latest = { bytes: 0, progress: null };
  let timer;
  let stopped = false;
  return {
    update(extra) {
      if (stopped) return;
      Object.assign(latest, extra);
      timer ??= setTimeout(() => { timer = undefined; send({ ...latest }); }, interval);
    },
    stop() { stopped = true; clearTimeout(timer); timer = undefined; },
  };
}
