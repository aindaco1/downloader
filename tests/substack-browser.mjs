import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.env.RESULTS_DIR || 'test-results/substack-regression');
await mkdir(root, { recursive: true });
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(path.join(root, `profile-${Date.now()}`), {
  channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const results = [];
const post = (id, slug) => ({ id, slug, publication_id: 99, title: `Article ${id}`, cover_image: `https://substackcdn.com/image/${id}.jpg`, audio_items: [
  { post_id: id, type: 'tts', audio_url: `https://substack-video.s3.amazonaws.com/video_upload/post/${id}/tts/voice.mp3?signature=keep` },
] });
const current = post(1, 'current-article');
const archive = [current, ...Array.from({ length: 5 }, (_, i) => post(i + 2, `recommended-${i}`))];
const origin = 'https://fixture.substack.com';
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(label);
}
async function previews(popup, count) {
  await waitFor(() => popup.locator('.thumbnail img').evaluateAll((images, count) => images.length === count && images.every(image => image.complete && image.naturalWidth > 0), count), 'loaded previews');
  assert.equal(await popup.locator('.media-card').count(), count);
}
try {
  const poster = await readFile('tests/fixtures/poster.png');
  for (const host of ['substackcdn.com', 'i.ytimg.com']) await context.route(`https://${host}/**`, route => route.fulfill({ contentType: 'image/png', body: poster }));
  await context.route(`${origin}/api/v1/archive*`, route => route.fulfill({ json: archive }));
  const url = `${origin}/p/current-article`;
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>(1) Current article</title><script>fetch('/api/v1/archive?limit=6')</script>` }));
  const page = await context.newPage(); await page.goto(url);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), url);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const api = (type, extra = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId, ...extra });
  let snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 1 && s.tab.items[0].thumbnail ? s : null; }, 'six recommendations scoped to current article');
  assert.equal(snap.tab.items[0].title, 'Article 1 (read aloud)');
  assert.equal(snap.tab.items[0].sources[0].url, current.audio_items[0].audio_url);
  await previews(popup, 1);
  results.push({ test: 'six recommended read-aloud tracks become one correctly titled card with loaded preview', passed: true });
  await page.evaluate(post => { window._preloads = { post }; document.body.append(document.createElement('span')); }, current);
  await waitFor(() => page.evaluate(() => Boolean(window._preloads)), 'preload assigned');
  await api('rescan'); await page.waitForTimeout(1200);
  await page.evaluate(() => { const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/v1/archive?limit=6&repeat=1'); xhr.send(); });
  await page.waitForTimeout(1200);
  snap = await api('snapshot');
  assert.equal(snap.tab.items.length, 1); assert.equal(snap.tab.items[0].sources.length, 1);
  await previews(popup, 1);
  results.push({ test: 'late preload, rescan, fetch and XHR responses retain one card', passed: true });

  // A preview-only YouTube iframe has no getPlayerResponse yet. It must remain
  // separate from the article narration and use the existing public lookup.
  const videoId = 'hTCMkNLMFrU';
  const config = { video_id: videoId, embedded_player_response: JSON.stringify({ previewPlayabilityStatus: { status: 'OK' }, embedPreview: { thumbnailPreviewRenderer: {
    title: { runs: [{ text: 'Embedded podcast' }] }, videoDurationSeconds: '3653',
    playButton: { buttonRenderer: { navigationEndpoint: { watchEndpoint: { videoId } } } },
  } } }) };
  const embed = `https://www.youtube-nocookie.com/embed/${videoId}`;
  await context.route(embed, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>YouTube</title><script>window.ytcfg={get:()=>(${JSON.stringify(config)})}</script>` }));
  await page.evaluate(embed => { const iframe = document.createElement('iframe'); iframe.src = embed; document.body.append(iframe); }, embed);
  snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 2 ? s : null; }, 'separate YouTube preview');
  const video = snap.tab.items.find(item => item.key === `youtube:${videoId}`);
  assert.equal(video.title, 'Embedded podcast'); assert.equal(video.pageUrl, embed); assert.equal(video.unavailable, 'youtube-preview');
  assert.equal(video.sources.length, 0);
  await previews(popup, 2);
  await popup.locator('body').screenshot({ path: path.join(root, 'article-and-video.png') });
  await worker.evaluate(() => {
    globalThis.realFetch = globalThis.fetch; globalThis.lookupCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://www.youtube.com/')) {
        lookupCalls++;
        return new Response(JSON.stringify(lookupCalls === 1 ? { visitorData: 'fixture_visitor_data' } : { playabilityStatus: { status: 'LOGIN_REQUIRED' } }));
      }
      return realFetch(url, options);
    };
  });
  const inspected = await api('inspect', { itemId: video.id });
  assert.equal(inspected.ok, false); assert.match(inspected.error, /account or playback verification/);
  assert.equal(await worker.evaluate(() => lookupCalls), 2);
  assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await worker.evaluate(() => { globalThis.fetch = realFetch; });
  results.push({ test: 'preview-only YouTube embed has its own title, poster, duration and public lookup', passed: true });

  await page.evaluate(post => { document.querySelector('iframe').remove(); history.pushState({}, '', '/p/preload-only'); window._preloads.post = post; document.title = post.title; document.body.append(document.createElement('span')); }, post(7, 'preload-only'));
  snap = await waitFor(async () => { const s = await api('snapshot'); return s.tab.items.length === 1 && s.tab.items[0].title === 'Article 7 (read aloud)' ? s : null; }, 'preload-only article after navigation');
  assert.equal(snap.tab.items[0].thumbnail, 'https://substackcdn.com/image/7.jpg');
  await page.evaluate(() => fetch('/api/v1/archive?limit=6&other-page=1'));
  await page.waitForTimeout(1000); assert.equal((await api('snapshot')).tab.items.length, 1);
  await previews(popup, 1);
  results.push({ test: 'navigation replaces prior article; preload-only discovery works without matching archive response', passed: true });
  assert.deepEqual(errors, []);
  console.log('SUBSTACK REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors }, null, 2));
  await context.close();
}
