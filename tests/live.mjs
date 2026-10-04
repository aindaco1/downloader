import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('test-results/live');
await mkdir(root, {recursive:true});
const extension = path.resolve('extension');
const profile=path.join(root, `profile-${Date.now()}`);
await mkdir(path.join(profile,'Default'),{recursive:true});
await mkdir(path.join(root,'downloads'),{recursive:true});
await writeFile(path.join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:path.join(root,'downloads'),prompt_for_download:false}}));
const context = await chromium.launchPersistentContext(profile, { channel:'chromium', headless:true, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`] });
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id=worker.url().split('/')[2];
const cdp=await context.browser().newBrowserCDPSession();
await cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
const results=[];
const urls=[
 ['substack','https://jonreiss.substack.com/p/replay-recap-new-platforms-new-possibilities'],
 ['instagram','https://www.instagram.com/p/DdrejY6HQyr/'],
 ['tiktok','https://www.tiktok.com/shortdrama/episode/7681257837859083272/1'],
 ['youtube','https://www.youtube.com/watch?v=3HcahTc7kIk'],
 ['youtube-shorts','https://www.youtube.com/shorts/J4T7G4MfCqE'],
 ['vimeo','https://player.vimeo.com/video/76979871'],
];
try {
for(const [site,url] of urls) {
 if(process.env.LIVE_SITES && !process.env.LIVE_SITES.split(',').includes(site))continue;
 const page=await context.newPage();
 const result={site,url};
 try {
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000}).catch(e=>{result.navigation=e.message.split('\n')[0]});
  await page.waitForTimeout(5000);
  result.title=await page.title();
  result.text=(await page.locator('body').innerText()).slice(0,5000);
  await writeFile(path.join(root,site+'.html'),await page.content());
  await page.screenshot({path:path.join(root,site+'.png')});
  for(const frame of page.frames()) await frame.locator('video,audio').evaluateAll(elements=>elements.forEach(e=>{e.muted=true;void e.play().catch(()=>{});})).catch(()=>{});
  await page.waitForTimeout(5000);
  const tabId=await worker.evaluate(url=>chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url===url)?.id),page.url());
  const popup=await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
  const snap=await popup.evaluate(tabId=>chrome.runtime.sendMessage({type:'snapshot',tabId}),tabId);
  result.items=snap.tab.items.map(({id,key,title,thumbnail,sources})=>({id,key,title,thumbnail,sources}));
  console.log('LIVE',site,JSON.stringify({title:result.title,text:result.text.slice(0,650),items:result.items.map(i=>({title:i.title,kinds:i.sources.map(s=>s.kind)}))}));
  for(const item of result.items.slice(0,3)) {
   const inspection=await popup.evaluate(data=>chrome.runtime.sendMessage({type:'inspect',...data}),{tabId,itemId:item.id});
   item.inspection=inspection;
   console.log('QUALITY',site,JSON.stringify({ok:inspection.ok,error:inspection.error,choices:inspection.choices?.map(c=>({type:c.type,label:c.label,extension:c.extension})),warnings:inspection.warnings}));
  }
  await page.waitForTimeout(1200);
  result.previewImages=await popup.locator('.thumbnail img').evaluateAll(images=>images.map(image=>({loaded:image.complete&&image.naturalWidth>0,width:image.naturalWidth})));
  await popup.locator('body').screenshot({path:path.join(root,`${site}-popup.png`)});
  if(process.env.DOWNLOADS==='1') {
   const item=result.items.find(i=>i.inspection?.ok);
   const choice=item?.inspection.choices.find(c=>c.type===(site==='substack'?'audio':'video') && (!process.env.LIVE_HEIGHT || c.height===Number(process.env.LIVE_HEIGHT)));
   if(choice){
    console.log('LIVE DOWNLOAD START',site,choice.label);
    const started=await popup.evaluate(data=>chrome.runtime.sendMessage({type:'start',...data}),{tabId,itemId:item.id,choiceId:choice.id,filename:`live-${site}`});
    assert.equal(started.ok,true,started.error);
    let done;
    for(let n=0;n<600;n++){
     await page.waitForTimeout(1000);
     done=await worker.evaluate(id=>chrome.storage.session.get('state').then(({state})=>state.jobs.find(j=>j.id===id)),started.job.id);
     if(n%20===0)console.log('LIVE PROGRESS',site,done.status,done.bytes,done.progress);
     if(['complete','error','cancelled'].includes(done.status))break;
    }
    result.download={status:done.status,error:done.error,bytes:done.bytes};
    if(done.status==='complete'){
     const download=await worker.evaluate(id=>chrome.downloads.search({id}).then(r=>r[0]),done.downloadId);
     assert.ok(download.filename.startsWith(root));
     result.download.filename=path.basename(download.filename);
     result.download.metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height:format=duration,size','-of','json',download.filename],{encoding:'utf8'}));
     execFileSync('ffmpeg',['-v','error','-i',download.filename,'-f','null','-'],{stdio:'pipe'});
     result.download.fullDecode=true;
    }
    console.log('LIVE DOWNLOAD',site,JSON.stringify(result.download));
   }
  }
  await popup.close();
 }catch(e){result.error=e.message;console.log('LIVE ERROR',site,e.message)}
 results.push(result); await writeFile(path.join(root,'results-private.json'),JSON.stringify(results,null,2));
 await page.close();
}
}finally{await context.close()}
