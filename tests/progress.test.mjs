import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressReporter } from '../src/progress.js';

test('progress delivers the latest percentage after a burst, then stops before completion/cancellation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const reporter = createProgressReporter(value => events.push(value));
  reporter.update({ bytes: 100 });
  reporter.update({ progress: .2 });
  t.mock.timers.tick(450);
  assert.deepEqual(events, [{ bytes: 100, progress: .2 }]);
  // No further bytes arrive after the percentage changes. It must still arrive.
  reporter.update({ bytes: 200 });
  t.mock.timers.tick(100);
  reporter.update({ progress: .4 });
  t.mock.timers.tick(350);
  assert.deepEqual(events[1], { bytes: 200, progress: .4 });
  reporter.update({ progress: .9 });
  reporter.stop();
  reporter.update({ progress: 1 });
  t.mock.timers.tick(20000);
  assert.equal(events.length, 2);
});
