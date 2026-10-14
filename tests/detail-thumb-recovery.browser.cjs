// Synthetic media only; no user library or official API access.
const fs=require('fs');
const http=require('http');
const assert=require('assert/strict');
const {chromium}=require('playwright');
const root=require('path').join(__dirname,'../common/app/web/scripts/');
let cacheReads=0;
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.end('<div id="thumbs"></div>');return;}
 if(req.url==='/generated.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>');return;}
 cacheReads++;res.writeHead(200,{'Content-Type':'image/jpeg'});res.end('synthetic invalid cached image');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({...(process.env.GROK_TEST_BROWSER ? {executablePath:process.env.GROK_TEST_BROWSER} : {channel:'msedge'}),headless:true});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const core=fs.readFileSync(root+'library_core.js','utf8');
 await page.addScriptTag({content:core.slice(core.indexOf('  function mediaItemKey('))});
 for(const name of ['detail_media.js','b_detail_media.js','i_detail_media.js','detail_render.js'])await page.addScriptTag({content:fs.readFileSync(root+name,'utf8')});
 await page.evaluate(()=>{
 window.library_state={apiReady:true,bMainView:'all'};
 window.mediaTypeForName=()=> 'image';window.nativeCalls=0;
 window.grokChameleonNative={cardPreview:async()=>{nativeCalls++;return {url:'/generated.svg'};}};
 const item={item_id:'synthetic',type:'image',object_url:'/api/media?path=collection/synthetic.png&v=1234-20'};
 const thumb=detailThumbButtonForItem('b',item,{}, {active:true});
 document.getElementById('thumbs').append(thumb);startDetailThumbCacheLoads([thumb]);
 });
 await page.waitForFunction(()=>document.querySelector('.b_detail_thumb_fill').style.backgroundImage.includes('/generated.svg'));
 assert.equal(await page.evaluate(()=>nativeCalls),1);
 const before=cacheReads;
 await page.evaluate(()=>{const thumb=document.querySelector('.b_detail_thumb');startDetailThumbCacheLoads([thumb]);fastLocalPreviewBindings.get(thumb).load();});
 await page.waitForTimeout(200);
 assert.equal(cacheReads,before);
 console.log('PASS: undecodable cached bytes fall back to a decoded generated thumbnail; successful thumbnail is reused');
 await page.evaluate(()=>{
   for(const thumb of document.querySelectorAll('button')){disposeCardPreviewNode(thumb);thumb.remove();}
   window.nativeCalls=0;
   const item={item_id:'local-imagine',type:'image',object_url:'/api/media?path=collection/local-imagine.png&v=1234-20'};
   const thumb=detailThumbButtonForItem('i',item,{},{});document.getElementById('thumbs').append(thumb);startDetailThumbCacheLoads([thumb]);
 });
 await page.waitForFunction(()=>nativeCalls===1&&document.querySelector('.i_detail_thumb_fill').style.backgroundImage.includes('/generated.svg'));
 console.log('PASS: non-fast local detail path rejects unreadable saved previews and displays a decoded generated image');
 await page.evaluate(()=>{
 for(const thumb of document.querySelectorAll('button')){disposeCardPreviewNode(thumb);thumb.remove();}
 window.fastCachedPreviewUrls=async()=>[];
 window.nativeCalls=0;
 window.grokChameleonNative.cardPreview=async()=>{nativeCalls++;if(nativeCalls===1)throw Error("synthetic transient failure");return {url:"/generated.svg"};};
 const item={item_id:'synthetic-remote',type:'image',object_url:'/api/imagine/remote/media?url=https%3A%2F%2Fexample.test%2Fsynthetic.png'};
 const thumb=detailThumbButtonForItem('i',item,{}, {active:true});document.getElementById('thumbs').append(thumb);startDetailThumbCacheLoads([thumb]);
 });
 await page.waitForFunction(()=>nativeCalls===2&&document.querySelector('.i_detail_thumb_fill').style.backgroundImage.includes('/generated.svg'));
 console.log('PASS: failed remote thumbnail generation automatically retries and displays the recovered image');
 await page.evaluate(()=>{
   for(const thumb of document.querySelectorAll('button')){disposeCardPreviewNode(thumb);thumb.remove();}
   window.nativeCalls=0;
   window.grokChameleonNative.cardPreview=async()=>{nativeCalls++;throw Error('persistent synthetic failure');};
   const item={item_id:'persistent',type:'image',object_url:'/api/imagine/remote/media?url=https%3A%2F%2Fexample.test%2Fpersistent.png'};
   const thumb=detailThumbButtonForItem('i',item,{},{});document.getElementById('thumbs').append(thumb);startDetailThumbCacheLoads([thumb]);
 });
 await page.waitForFunction(()=>nativeCalls===3&&activeDetailCardPreviewTasks===0);
 await page.waitForTimeout(1200);
 assert.equal(await page.evaluate(()=>nativeCalls),3);
 await page.evaluate(()=>{const thumb=document.querySelector('.i_detail_thumb');startDetailThumbCacheLoads([thumb]);});
 await page.waitForFunction(()=>nativeCalls===4);
 await page.evaluate(()=>{const thumb=document.querySelector('.i_detail_thumb');disposeCardPreviewNode(thumb);thumb.remove();});
 await page.waitForTimeout(1200);
 assert.equal(await page.evaluate(()=>nativeCalls),4);
 await page.evaluate(()=>{
   window.nativeCalls=0;
   const item={item_id:'dispose-pending',type:'image',object_url:'/api/imagine/remote/media?url=https%3A%2F%2Fexample.test%2Fdispose.png'};
   const thumb=detailThumbButtonForItem('i',item,{},{});document.getElementById('thumbs').append(thumb);startDetailThumbCacheLoads([thumb]);
 });
 await page.waitForFunction(()=>nativeCalls===1&&activeDetailCardPreviewTasks===0);
 await page.evaluate(()=>{const thumb=document.querySelector('.i_detail_thumb');disposeCardPreviewNode(thumb);thumb.remove();});
 await page.waitForTimeout(1800);
 assert.equal(await page.evaluate(()=>nativeCalls),1);
 console.log('PASS: retries are bounded, re-render can retry, and disposed thumbnails stop retrying');
}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
