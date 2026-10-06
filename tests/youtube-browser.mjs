import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';
const { server, base, requests } = await startServer();
const root=path.resolve(process.env.RESULTS_DIR || 'test-results/youtube-regression'); await mkdir(root,{recursive:true});
const extension=path.resolve(process.env.EXTENSION_DIR || 'extension');
const context=await chromium.launchPersistentContext(path.join(root,`profile-${Date.now()}`),{channel:'chromium',executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP r.googlevideo.com 127.0.0.1']});
const errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
const extensionId=worker.url().split('/')[2];
const results=[];
async function waitFor(check,label){for(let i=0;i<100;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error(label)}
try{
const poster=await readFile('tests/fixtures/poster.png');
await context.route('https://i.ytimg.com/**',route=>route.fulfill({status:200,contentType:'image/png',body:poster}));
const playlist='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n';
await context.route('https://manifest.googlevideo.com/**',route=>route.fulfill({status:200,contentType:'application/vnd.apple.mpegurl',body:playlist,headers:{'access-control-allow-origin':'*'}}));
await context.route('https://www.youtube.com/api/manifest/**',route=>route.fulfill({status:200,contentType:'application/vnd.apple.mpegurl',body:playlist}));
for(const [id,pathname] of [['3HcahTc7kIk','/watch?v=3HcahTc7kIk'],['J4T7G4MfCqE','/shorts/J4T7G4MfCqE']]){
const url='https://www.youtube.com'+pathname;
await context.route(url,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>YouTube</title><h1>Controlled YouTube regression fixture</h1><script>
fetch('https://manifest.googlevideo.com/api/manifest/${id}/avc.m3u8');
fetch('https://www.youtube.com/api/manifest/${id}/vp9.m3u8');
setTimeout(()=>{window.ytInitialPlayerResponse={videoDetails:{videoId:'${id}',title:'Late player title ${id}',lengthSeconds:'110'}};document.title='Late player title ${id} - YouTube';const marker=document.createElement('span');marker.textContent='Loaded';document.body.append(marker);},600);
</script>`}));
const page=await context.newPage();await page.goto(url);
const tabId=await worker.evaluate(url=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url)?.id),url);
const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
const snapshot=()=>popup.evaluate(tabId=>chrome.runtime.sendMessage({type:'snapshot',tabId}),tabId);
const snap=await waitFor(async()=>{const s=await snapshot();return s.tab.items.length===1&&s.tab.items[0].sources.length===2&&s.tab.items[0].title===`Late player title ${id}`?s:null},'one YouTube card with both HLS streams and late title').catch(async error=>{throw new Error(`${error.message}: ${JSON.stringify((await snapshot()).tab.items)}`)});
assert.equal(snap.tab.items[0].key,`youtube:${id}`);
assert.equal(snap.tab.items[0].thumbnail,`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
await waitFor(()=>popup.locator('.thumbnail img').evaluateAll(images=>images.length===1&&images[0].complete&&images[0].naturalWidth>0),'preview image');
assert.equal(await popup.locator('.media-card').count(),1);
await popup.locator('body').screenshot({path:path.join(root,`${id}.png`)});
results.push({id,oneCard:true,sources:2,lateTitle:true,previewLoaded:true});
await popup.close();await page.close();
}
for (const mode of ['sabr', 'cipher', 'refused', 'lookup-denied', 'spa']) {
const id='hidw3Hp4tIk';
const url=`https://www.youtube.com/watch?v=${id}&fixture=${mode}`;
const initialUrl=mode==='spa'?'https://www.youtube.com/?fixture=spa':url;
// Offscreen fetches are not intercepted by Playwright routes. Resolve this
// fixture host to the local HTTP server only in the disposable browser.
const source=base.replace('127.0.0.1','r.googlevideo.com')+'/error403.mp4?itag=18&token=private';
const attempts=()=>requests.filter(request=>request.path==='/error403.mp4').length;
const streamingData=mode==='sabr'||mode==='lookup-denied'||mode==='spa' ? {adaptiveFormats:[{itag:137}],serverAbrStreamingUrl:'https://r.googlevideo.com/videoplayback?sabr=1'} : mode==='cipher' ? {formats:[{signatureCipher:'unresolved'}]} : {formats:[{url:source}]};
// Mock only the public lookup in the worker. A refused observed source still
// reaches the real HTTP server through the unmodified offscreen media engine.
await worker.evaluate(mode=>{
  globalThis.lookupCalls=[];
  globalThis.realFetch ||= globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://www.youtube.com/')) {
      lookupCalls.push({credentials:options.credentials,method:options.method||'GET',rules:await chrome.declarativeNetRequest.getSessionRules()});
      if(mode==='lookup-denied')return new Response(null,{status:403});
      return new Response(JSON.stringify(lookupCalls.length===1?{visitorData:'fixture_visitor_data'}:{playabilityStatus:{status:'LOGIN_REQUIRED'}}));
    }
    return realFetch(url,options);
  };
},mode);
await context.route(initialUrl,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><title>Transport fixture - YouTube</title><script>${mode==='spa'?`history.pushState({},'',${JSON.stringify(url)});`:''}window.ytInitialPlayerResponse=${JSON.stringify({videoDetails:{videoId:id,title:'Transport fixture',lengthSeconds:'313'},streamingData})}</script>`}));
const page=await context.newPage();await page.goto(initialUrl);
const tabId=await worker.evaluate(url=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url)?.id),url);
const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
const api=(type,extra={})=>popup.evaluate(message=>chrome.runtime.sendMessage(message),{type,tabId,...extra});
const item=await waitFor(async()=>(await api('snapshot')).tab.items[0],`detect ${mode}`);
await popup.locator('.media-card').waitFor();
assert.equal(item.pageUrl,url,'current SPA location is retained');
await popup.getByRole('button',{name:'Choose quality'}).click();
await waitFor(async()=>new RegExp(mode==='lookup-denied'?'YouTube download lookup failed':'account or playback verification').test(await popup.locator('.card-status.error').innerText().catch(()=>'')),'specific lookup failure');
if(mode==='refused')assert.equal(attempts(),1,'permanent denial is not retried before one public lookup');
const calls=await worker.evaluate(()=>lookupCalls);
assert.equal(calls.length,mode==='lookup-denied'?1:2,'lookup is not retried');
assert.ok(calls.every(call=>call.credentials==='omit'&&call.rules.some(rule=>rule.id===2)));
assert.deepEqual(await worker.evaluate(()=>chrome.declarativeNetRequest.getSessionRules()),[],'temporary rules are removed after failure');
assert.equal(await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}).then(c=>c.length)),0,'failed inspection releases the engine');
assert.equal((await api('snapshot')).tab.items[0].sources.length,item.sources.length,'failed lookup does not replace discovered sources');
assert.doesNotMatch(await popup.locator('.card-status.error').innerText(),/signed in|sign in/i);
await popup.locator('body').screenshot({path:path.join(root,`${mode}.png`)});
await popup.getByRole('button',{name:'Rescan',exact:false}).click();
await waitFor(async()=>await popup.locator('#status').innerText()==='Rescanned.','honest rescan status');
assert.equal(await popup.locator('.card-status.error').count(),0,'rescan clears stale errors');
if(mode==='sabr') {
  await page.evaluate(()=>{window.ytInitialPlayerResponse.streamingData.hlsManifestUrl='https://manifest.googlevideo.com/late.m3u8';window.postMessage({channel:'dust-wave-media-v1',command:'scan'},'*');});
  await waitFor(async()=>(await api('snapshot')).tab.items[0].sources.length===1,'late resolved source is retained');
  assert.equal(await popup.locator('.media-card').count(),1);
  assert.equal((await api('snapshot')).tab.items[0].unavailable,undefined);
}
results.push({test:mode,passed:true,attempts:attempts()});
await popup.close();await page.close();
}
await worker.evaluate(()=>{globalThis.fetch=globalThis.realFetch;});
assert.equal(errors.length,0,JSON.stringify(errors));console.log('YOUTUBE REGRESSIONS PASSED',results.length);
}finally{await writeFile(path.join(root,'results.json'),JSON.stringify({browser:context.browser().version(),results,errors},null,2));await context.close();server.close()}
