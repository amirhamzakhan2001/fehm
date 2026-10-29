// Run after npm run build: node --import tsx scripts/human-workspace-smoke.mjs
// Optional FEHM_PLAYWRIGHT_MODULE / FEHM_CHROME point at existing local browser tooling.
const { chromium } = await import(process.env.FEHM_PLAYWRIGHT_MODULE || 'playwright');
import { startServer } from '../dist/server.js';
import { shopFiles } from '../test/fixtures/drift-shop.ts';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'fehm-human-ui-'));
const files={...shopFiles(), '.gitignore':'.fehm/\n', 'prompts.ts':Array.from({length:56},(_,i)=>`const PROMPT_${i} = "You are a code reviewer ${i}. Explain the supplied code using evidence.";`).join('\n')};
const manifest=JSON.parse(files['package.json']);manifest.scripts={test:'node -e "console.log(123)"'};files['package.json']=JSON.stringify(manifest);
for(const [path,text] of Object.entries(files)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);}
const git=(...a)=>execFileSync('git',['-C',root,'-c','user.name=Tester','-c','user.email=test@example.com',...a],{encoding:'utf8'}).trim();
git('init','-q');git('add','.');git('commit','-qm','Introduce service');writeFileSync(join(root,'notes.txt'),'Review service boundaries');git('add','.');git('commit','-qm','Document boundaries');
const server=await startServer(root,0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.FEHM_CHROME ? {executablePath:process.env.FEHM_CHROME} : {}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(base+'/concepts');
 await page.getByText('Ready · local and offline',{exact:true}).waitFor();
 await page.locator('select[name=view]').selectOption('all');
 assert.equal(await page.locator('.card').count(),30);
 const first=await page.locator('.card button').first().innerText();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 assert.notEqual(await page.locator('.card button').first().innerText(),first);
 await page.locator('input[name=q]').fill('Quantum Computing');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.locator('.card button').first().click();
 await page.locator('#detail h2').filter({hasText:'Quantum Computing'}).waitFor();
 assert.ok((await page.locator('#detail').innerText()).includes('reference knowledge'));
 await page.reload();
 await page.locator('#detail h2').filter({hasText:'Quantum Computing'}).waitFor();
 await page.goto(base+'/ontology');
 await page.getByText('Ready · local and offline',{exact:true}).waitFor();
 assert.equal(await page.locator('select[name=view]').inputValue(),'all');
 await page.screenshot({path:'/tmp/fehm-concepts-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'/tmp/fehm-concepts-mobile.png'});
 await page.route('**/api/concepts/report?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Offline test'})}));
 await page.goto(base+'/concepts');
 await page.locator('#status.error').waitFor();
 await page.locator('.card button').first().click();
 await page.locator('#detail h2').waitFor();
 assert.ok((await page.locator('#detail').innerText()).includes('analysis is unavailable'));
 assert.deepEqual(errors,[]);
 console.log('PASS complete catalog pagination, exact selection, reload, legacy route, mobile width, analysis failure fallback');
} finally {await browser.close();server.close();setTimeout(()=>process.exit(process.exitCode||0),500).unref();}
