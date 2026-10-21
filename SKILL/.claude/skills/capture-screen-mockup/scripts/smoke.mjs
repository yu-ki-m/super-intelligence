import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { capturePage, mockup } from './workflow.mjs';
const out = await mkdtemp(join(tmpdir(), 'screen-mockup-'));
const fixture = await readFile(new URL('../assets/fixture.html',import.meta.url));
const fontCSS=process.env.SCREEN_TEST_FONT_CSS ? await readFile(process.env.SCREEN_TEST_FONT_CSS,'utf8') : '';
const server = createServer((req,res) => {
 if(req.url==='/app.css') {res.setHeader('Content-Type','text/css');res.end(fontCSS+'body{position:relative;font:16px sans-serif;margin:18px;background:#f1f5f9;color:#17263b}header{background:#17263b;color:white;padding:20px}main{margin:32px;background:white;padding:28px}h1{font-size:26px}button,input,select{font-family:inherit;padding:10px}table{width:100%;margin-top:24px;border-collapse:collapse}th,td{text-align:left;padding:16px;border-bottom:1px solid #ddd}#dialog{padding:20px;background:#e0f2fe}');}
 else if(req.url==='/icon.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="teal"/></svg>');}
 else {res.setHeader('Content-Type','text/html');res.end(fixture);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({ ...(process.env.SCREEN_CHROMIUM?{executablePath:process.env.SCREEN_CHROMIUM}:{}), args: process.env.SCREEN_TEST_NO_SANDBOX?['--no-sandbox']:[] });
try {
 const page=await browser.newPage({viewport:{width:1100,height:760}});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.fill('#query','入力中の値');await page.check('#mine');await page.selectOption('#status',{label:'対応中'});
 await page.evaluate(()=>document.querySelector('#dialog').hidden=false);
 await capturePage(page,join(out,'capture'),{label:'fixture'});
 assert.equal(await page.inputValue('#query'),'入力中の値');
 const html=await readFile(join(out,'capture/original.html'),'utf8');
 assert.match(html,/入力中の値/);assert.match(html,/data:image/);assert.doesNotMatch(html,/<script[\s>]/i);
 const preview=await browser.newPage();await preview.setContent(html);
 assert.equal(await preview.inputValue('#query'),'入力中の値');assert.equal(await preview.isChecked('#mine'),true);
 assert.equal(await preview.inputValue('#status'),'対応中');assert.equal(await preview.isVisible('#dialog'),true);
 assert.equal(await preview.locator('header').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(23, 38, 59)');
 await mockup(join(out,'capture/original.html'),new URL('../assets/changes.example.json',import.meta.url),join(out,'proposal'));
 const changed=await readFile(join(out,'proposal/annotated.html'),'utf8');assert.match(changed,/CSV出力/);assert.match(changed,/変更箇所・補足/);
 await preview.setContent(changed);
 const alignment=await preview.evaluate(()=>{const a=document.querySelector('.secondary').getBoundingClientRect();const b=document.querySelector('#screen-mockup-annotations>div').getBoundingClientRect();return Math.abs(a.left-b.left)+Math.abs(a.top-b.top)});assert.ok(alignment<1);
 await mockup(join(out,'capture/original.html'),join(out,'proposal/changes.json'),join(out,'nested/replayed'));
 assert.equal(await readFile(join(out,'proposal/mockup.html'),'utf8'),await readFile(join(out,'nested/replayed/mockup.html'),'utf8'));
 const original=await readFile(join(out,'capture/original.html'),'utf8');assert.equal(original,html);
 const bad=join(out,'bad.json');await writeFile(bad,JSON.stringify({version:1,operations:[{type:'text',selector:'.missing',value:'bad'}]}));
 await assert.rejects(mockup(join(out,'capture/original.html'),bad,join(out,'bad')),/expected 1 matches/);
 console.log('PASS: current DOM, input/checkbox/select/dialog, CSS/image, patch, annotation, immutable original, missing-selector failure.');console.log(out);
} finally {await browser.close();server.close();}
