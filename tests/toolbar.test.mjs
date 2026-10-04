import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolbarActivity } from '../src/toolbar.js';

test('toolbar pulses once, animates a running download, and stops completely when idle', async () => {
  const paths = []; const titles = [];
  const toolbar = createToolbarActivity({ setIcon: async value => paths.push(value.path[16]), setTitle: async value => titles.push(value.title) });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    toolbar.update({ detected: true, count: 1 });
    await wait(3850);
    assert.ok(new Set(paths.filter(path => path.includes('detected-'))).size > 4);
    assert.equal(paths.at(-1), 'icons/available-16.png');
    const idleCount = paths.length; await wait(300); assert.equal(paths.length, idleCount);
    assert.match(titles.at(-1), /1 media item available/);
    toolbar.update({ job: { status: 'processing', filename: 'Clip.mp4', progress: .4 } });
    await wait(500);
    assert.ok(new Set(paths.filter(path => path.includes('download-'))).size >= 3);
    assert.match(titles.at(-1), /Clip.mp4.*40%/);
    toolbar.update({ job: { status: 'cancelled' } });
    assert.equal(paths.at(-1), 'icons/16.png');
    const stoppedCount = paths.length; await wait(300); assert.equal(paths.length, stoppedCount);
  } finally { toolbar.stop(); }
});

test('Cancel stops all frames immediately even with sources, a recent pulse, and late progress', t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const paths = []; const titles = [];
  const toolbar = createToolbarActivity({ setIcon: async value => paths.push(value.path[16]), setTitle: async value => titles.push(value.title) });
  try {
    toolbar.update({ detected: true, count: 1 });
    const job = { status: 'processing', filename: 'Clip.mp4', progress: .1 };
    toolbar.update({ job, count: 1 });
    t.mock.timers.tick(225);
    assert.match(paths.at(-1), /download-/);
    job.cancelRequested = true;
    toolbar.update({ job, count: 1 });
    assert.equal(paths.at(-1), 'icons/available-16.png');
    assert.match(titles.at(-1), /1 media item available/);
    const stopped = paths.length;
    // Cleanup can be slow and a queued progress message can arrive after Cancel.
    t.mock.timers.tick(225);
    job.progress = .2;
    toolbar.update({ job, count: 1 });
    t.mock.timers.tick(4000);
    assert.equal(paths.length, stopped);
    toolbar.update({ count: 1 });
    assert.equal(paths.length, stopped);
    // A subsequent download must still animate normally.
    toolbar.update({ job: { status: 'processing', filename: 'Next.mp4' }, count: 1 });
    assert.match(paths.at(-1), /download-/);
  } finally { toolbar.stop(); }
});

test('a download consumes a detection pulse instead of replaying it after finishing', t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const paths = [];
  const toolbar = createToolbarActivity({ setIcon: async value => paths.push(value.path[16]), setTitle: async () => {} });
  try {
    toolbar.update({ detected: true, count: 1 });
    toolbar.update({ job: { status: 'saving', filename: 'Clip.mp4' }, count: 1 });
    toolbar.update({ count: 1 });
    assert.equal(paths.at(-1), 'icons/available-16.png');
    const stopped = paths.length;
    t.mock.timers.tick(4000);
    assert.equal(paths.length, stopped);
  } finally { toolbar.stop(); }
});
