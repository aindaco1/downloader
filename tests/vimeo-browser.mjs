import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('test-results/vimeo-regression'); await mkdir(root, { recursive: true });
const extension = path.resolve(process.env.EXTENSION_DIR || 'extension');
const context = await chromium.launchPersistentContext(path.join(root, `profile-${Date.now()}`), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const results = [];
async function waitFor(check, label) { for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(label); }
async function open(url) {
  const page = await context.newPage(); await page.goto(url);
  const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), url);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const snapshot = () => popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'snapshot', tabId }), tabId);
  return { page, popup, tabId, snapshot };
}
async function preview(popup, count) {
  await waitFor(() => popup.locator('.thumbnail img').evaluateAll((images, count) => images.length === count && images.every(image => image.complete && image.naturalWidth > 0), count), 'loaded Vimeo previews');
  assert.equal(await popup.locator('.media-card').count(), count);
}
try {
  const poster = await readFile('tests/fixtures/poster.png');
  await context.route('https://i.vimeocdn.com/**', route => route.fulfill({ contentType: 'image/png', body: poster }));
  await context.route('https://vod-adaptive-ak.vimeocdn.com/**', route => route.fulfill({ contentType: 'video/mp4', body: '', headers: { 'access-control-allow-origin': '*' } }));
  const url = 'https://vimeo.com/1232424785/fixturehash?fl=ip&fe=ec&share=copy';
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Vimeo</title><meta property="og:image" content=""><meta property="og:title" content=""><h1>Vimeo fixture</h1><script>
    for(let i=0;i<21;i++)fetch('https://vod-adaptive-ak.vimeocdn.com/variant-'+i+'.mp4?signature=retain-'+i);
    setTimeout(()=>{document.querySelector('[property="og:image"]').content='https://i.vimeocdn.com/video/poster.jpg';document.querySelector('[property="og:title"]').content='Urban Enhancement Trust Fund FY2028-2029 Information Session';},1000);
  </script>` }));
  const main = await open(url);
  const snap = await waitFor(async () => { const s = await main.snapshot(); return s.tab.items.length === 1 && s.tab.items[0].sources.length === 21 && s.tab.items[0].thumbnail && s.tab.items[0].title.startsWith('Urban Enhancement') ? s : null; }, '21 sources grouped with late metadata');
  assert.equal(snap.tab.items[0].key, 'vimeo:1232424785');
  assert.ok(snap.tab.items[0].sources.every(source => new URL(source.url).searchParams.get('signature')?.startsWith('retain-')));
  await preview(main.popup, 1);
  await main.popup.locator('body').screenshot({ path: path.join(root, 'one-card.png') });
  results.push({ test: '21 Vimeo sources, late DOM title and preview, signed URLs preserved', passed: true });
  // Supply a long quality label to the existing popup rendering path. This is
  // a layout fixture; the download engine is covered by tests/browser.mjs.
  snap.tab.items[0].inspection = { at: Date.now(), warnings: [], choices: [{ id: '0', type: 'video', extension: 'mp4', audioCodec: 'aac', label: '1920 × 1080 · AVC · source 1' }, { id: '1', type: 'audio', extension: 'm4a', label: 'AAC · original quality' }] };
  await main.popup.addInitScript(snapshot => {
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, ...args) => message.type === 'snapshot' ? Promise.resolve(snapshot) : original.call(chrome.runtime, message, ...args);
  }, snap);
  await main.popup.reload();
  await main.popup.getByLabel('Quality', { exact: true }).waitFor();
  const styles = await main.popup.locator('.controls select').evaluateAll(selects => selects.map(select => ({ paddingRight: getComputedStyle(select).paddingRight, arrowPosition: getComputedStyle(select).backgroundPosition, right: select.getBoundingClientRect().right })));
  assert.ok(styles.every(style => parseFloat(style.paddingRight) >= 32 && style.arrowPosition.includes('11px') && style.right <= 700));
  await main.popup.getByLabel('Media type', { exact: true }).selectOption('audio');
  assert.equal(await main.popup.getByLabel('Quality', { exact: true }).inputValue(), '1');
  await main.popup.getByLabel('Media type', { exact: true }).selectOption('video');
  await main.popup.locator('body').screenshot({ path: path.join(root, 'dropdown-padding.png') });
  results.push({ test: 'padded dropdown arrows, long quality label and selection', passed: true, styles });
  await main.popup.close(); await main.page.close();

  for (const id of ['111111', '222222']) await context.route(`https://player.vimeo.com/video/${id}*`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Vimeo</title><h1>Embedded video ${id}</h1><script>
    fetch('https://vod-adaptive-ak.vimeocdn.com/${id}/observed.mp4');
    setTimeout(()=>{window.playerConfig={video:{id:${id},title:'Embedded film ${id}',thumbnail_url:'https://i.vimeocdn.com/video/${id}.jpg'},request:{files:{progressive:[{url:'https://vod-adaptive-ak.vimeocdn.com/${id}/configured.mp4'}]}}};document.body.append(document.createElement('span'));},600);
  </script>` }));
  await context.route('https://example.com/films', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Two films</title><iframe src="https://player.vimeo.com/video/111111?h=first"></iframe><iframe src="https://player.vimeo.com/video/222222?h=second"></iframe>' }));
  const embedded = await open('https://example.com/films');
  const two = await waitFor(async () => { const s = await embedded.snapshot(); return s.tab.items.length === 2 && s.tab.items.every(item => item.sources.length === 2 && item.thumbnail && item.title.startsWith('Embedded film')) ? s : null; }, 'different embedded videos remain separate').catch(async error => { console.log('EMBED SNAPSHOT', JSON.stringify(await embedded.snapshot())); throw error; });
  assert.deepEqual(two.tab.items.map(item => item.key).sort(), ['vimeo:111111', 'vimeo:222222']);
  await preview(embedded.popup, 2);
  await embedded.popup.locator('body').screenshot({ path: path.join(root, 'two-embeds.png') });
  results.push({ test: 'two embedded Vimeo IDs retain separate cards and current-schema previews', passed: true });
  await embedded.popup.close(); await embedded.page.close();
  await context.route('https://player.vimeo.com/video/333333', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Vimeo</title><script>fetch('https://vod-adaptive-ak.vimeocdn.com/333333/observed.mp4');</script>` }));
  await context.route('https://vimeo.com/333333', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Vimeo</title><meta property="og:title" content="Parent film"><meta property="og:image" content=""><iframe src="https://player.vimeo.com/video/333333"></iframe><script>setTimeout(()=>{document.querySelector('[property="og:image"]').content='https://i.vimeocdn.com/video/333333.jpg';},1000);</script>` }));
  const parent = await open('https://vimeo.com/333333');
  const shared = await waitFor(async () => { const s = await parent.snapshot(); return s.tab.items.length === 1 && s.tab.items[0].thumbnail ? s : null; }, 'parent poster enriches the same video in its iframe');
  assert.equal(shared.tab.items[0].key, 'vimeo:333333');
  assert.equal(shared.tab.items[0].pageUrl, 'https://player.vimeo.com/video/333333');
  await preview(parent.popup, 1);
  results.push({ test: 'late parent-page preview enriches embedded video and retains its request context', passed: true });
  await parent.popup.close(); await parent.page.close();
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('VIMEO REGRESSIONS PASSED', results.length);
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ browser: context.browser().version(), results, errors }, null, 2));
  await context.close();
}
