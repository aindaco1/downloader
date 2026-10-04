import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/content.js'], bundle: true, write: false, format: 'iife', target: 'chrome125' });
const script = outputFiles[0].text;
function environment(runtime) {
  return { chrome: { runtime }, AbortController, clearTimeout, window: { addEventListener() { throw Error('DOM listeners must not start without a valid extension context'); } } };
}

test('content initialization stops cleanly if the extension context disappears', () => {
  for (const failure of ['missing id', 'id getter', 'listener registration']) {
    const runtime = { id: 'test', onMessage: { addListener() { throw Error('Extension context invalidated.'); }, removeListener() { throw Error('Extension context invalidated.'); } } };
    if (failure === 'missing id') delete runtime.id;
    if (failure === 'id getter') Object.defineProperty(runtime, 'id', { get() { throw Error('Extension context invalidated.'); } });
    const context = environment(runtime);
    assert.doesNotThrow(() => vm.runInNewContext(script, context), failure);
    assert.equal(context.__dustWaveContent, undefined, 'failed initialization must not block a later rescan');
  }
});

test('content initialization does not hide unrelated programming errors', () => {
  const context = environment({ id: 'test', onMessage: { addListener() { throw Error('Unexpected failure'); }, removeListener() {} } });
  assert.throws(() => vm.runInNewContext(script, context), /Unexpected failure/);
  assert.equal(context.__dustWaveContent, undefined);
});

function pageEnvironment() {
  const messages = [];
  const hooks = {};
  const runtime = { id: 'test', sendMessage: async value => { messages.push(value); }, onMessage: {
    addListener(listener) { hooks.message = listener; }, removeListener() { hooks.removed = true; },
  } };
  const context = { chrome: { runtime }, URL, AbortController, clearTimeout, setTimeout,
    location: { href: 'https://example.test/article' },
    document: { title: 'Text-only page', readyState: 'complete', querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    window: { addEventListener() {}, postMessage() {} },
    MutationObserver: class { observe() {} disconnect() { hooks.disconnected = true; } },
  };
  vm.runInNewContext(script, context);
  return { context, runtime, hooks, messages };
}

test('content replies stop quietly if the context disappears during ping or rescan', () => {
  for (const type of ['ping', 'rescan']) {
    const { context, hooks, messages } = pageEnvironment();
    assert.doesNotThrow(() => hooks.message({ type }, {}, () => { throw Error('Extension context invalidated.'); }));
    assert.equal(context.__dustWaveContent, undefined);
    assert.equal(hooks.disconnected, true);
    const count = messages.length;
    hooks.message({ type: 'rescan' }, {}, () => { throw Error('Stopped detector must not reply'); });
    assert.equal(messages.length, count);
  }
});

test('content reply guards do not hide unrelated errors', () => {
  const { hooks } = pageEnvironment();
  assert.throws(() => hooks.message({ type: 'ping' }, {}, () => { throw Error('Unexpected reply failure'); }), /Unexpected reply failure/);
});

test('empty-page sends stop after synchronous or asynchronous context invalidation', async () => {
  for (const asynchronous of [false, true]) {
    const { context, runtime, hooks } = pageEnvironment();
    runtime.sendMessage = () => {
      const error = Error('Extension context invalidated.');
      if (asynchronous) return Promise.reject(error);
      throw error;
    };
    assert.doesNotThrow(() => hooks.message({ type: 'rescan' }, {}, () => {}));
    await Promise.resolve();
    assert.equal(context.__dustWaveContent, undefined);
    assert.equal(hooks.disconnected, true);
  }
});
