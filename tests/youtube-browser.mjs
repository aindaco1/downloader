import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('test-results/youtube-regression'); await mkdir(root,{recursive:true});
const extension=path.resolve('extension');
const context=await chromium.launchPersistentContext(path.join(root,`profile-${Date.now()}`),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
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
const snap=await waitFor(async()=>{const s=await snapshot();return s.tab.items.length===1&&s.tab.items[0].sources.length===2&&s.tab.items[0].title===`Late player title ${id}`?s:null},'one YouTube card with both HLS streams and late title');
assert.equal(snap.tab.items[0].key,`youtube:${id}`);
assert.equal(snap.tab.items[0].thumbnail,`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
await waitFor(()=>popup.locator('.thumbnail img').evaluateAll(images=>images.length===1&&images[0].complete&&images[0].naturalWidth>0),'preview image');
assert.equal(await popup.locator('.media-card').count(),1);
await popup.locator('body').screenshot({path:path.join(root,`${id}.png`)});
results.push({id,oneCard:true,sources:2,lateTitle:true,previewLoaded:true});
await popup.close();await page.close();
}
assert.equal(errors.length,0,JSON.stringify(errors));console.log('YOUTUBE REGRESSIONS PASSED',results.length);
}finally{await writeFile(path.join(root,'results.json'),JSON.stringify({browser:context.browser().version(),results,errors},null,2));await context.close()}
