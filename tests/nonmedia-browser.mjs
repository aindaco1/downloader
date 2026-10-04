import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(process.env.RESULTS_DIR || 'test-results/nonmedia-check');
const extension=path.resolve(process.env.EXTENSION_DIR || 'extension');
await mkdir(root,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(root,`profile-${Date.now()}`),{channel:'chromium',executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[]; const results=[]; let runtimeErrors=[];
try {
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id=worker.url().split('/')[2];
 const popup=await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
 const pages=[];
 for (const [name,contentType,body] of [
 ['article','text/html','<!doctype html><title>Text-only page</title><main><h1>Article</h1><p>No audio or video.</p></main><script>window.addEventListener("message",e=>{if(e.data?.command==="scan") window.scans=(window.scans||0)+1})</script>'],
 ['empty','text/html','<!doctype html>'],
 ['svg','image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'],
 ['xml','application/xml','<?xml version="1.0"?><root><item>Text</item></root>']]) {
  const url=`https://nonmedia.example/${name}`;
  await context.route(url,r=>r.fulfill({status:200,contentType,body}));
  const page=await context.newPage(); const cdp=await context.newCDPSession(page);
  cdp.on('Runtime.exceptionThrown',({exceptionDetails:e})=>errors.push({page:name,error:e.exception?.description||e.text}));
  await cdp.send('Runtime.enable');
  for (let attempt=0;attempt<3;attempt++) {
   try { await page.goto(url); break; }
   catch(error) {
    if(attempt===2 || !/ERR_ABORTED|interrupted by another navigation/.test(error.message)) throw error;
    await page.waitForLoadState('domcontentloaded');
   }
  }
  await page.waitForTimeout(1000);
  const tabId=await worker.evaluate(url=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url).id),url);
  const scan=await popup.evaluate(tabId=>chrome.runtime.sendMessage({type:'rescan',tabId}),tabId);
  assert.equal(scan.ok,true,scan.error);
  const snapshot=await popup.evaluate(tabId=>chrome.runtime.sendMessage({type:'snapshot',tabId}),tabId);
  assert.equal(snapshot.tab.items.length,0);
  if (name==='article') {
   await page.evaluate(()=>{history.pushState({},'', '?article=2'); document.body.insertAdjacentHTML('beforeend','<p>More text</p>'); window.dispatchEvent(new PopStateEvent('popstate'));});
   await page.waitForTimeout(1000);
   assert.ok(await page.evaluate(()=>window.scans)>1);
  }
  pages.push(page);results.push({test:`${name} non-media page and rescan`,passed:true});
 }
 await popup.close();
 const manager=await context.newPage(); await manager.goto('chrome://extensions');
 await manager.evaluate(id=>new Promise((resolve,reject)=>chrome.developerPrivate.reload(id,{failQuietly:true},()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve())),id);
 await manager.waitForTimeout(600);
 for (const page of pages) {
  await page.evaluate(()=>window.postMessage({channel:'dust-wave-media-v1',items:[]},'*'));
 }
 await manager.waitForTimeout(1000);
 runtimeErrors=await manager.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.getExtensionInfo(id,info=>resolve(info.runtimeErrors.map(e=>({message:e.message,source:e.source}))))),id);
 assert.deepEqual(errors,[]); assert.deepEqual(runtimeErrors,[]);
 results.push({test:'non-media pages after extension reload',passed:true});
 console.log('NON-MEDIA CHECKS PASSED', results.length);
} finally {await writeFile(path.join(root,'results.json'),JSON.stringify({browser:context.browser().version(),results,errors,runtimeErrors},null,2)); await context.close();}
