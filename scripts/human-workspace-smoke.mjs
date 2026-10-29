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
try{
 await page.goto(base+'/prompts');await page.getByRole('heading',{name:'Prompt inventory'}).waitFor();
 assert.equal(await page.locator('tbody tr').count(),50);await page.getByRole('button',{name:'Show next 50'}).click();assert.equal(await page.locator('tbody tr').count(),56);
 await page.getByRole('searchbox',{name:'Search prompts'}).fill('PROMPT_55');assert.equal(await page.locator('tbody tr').count(),1);await page.locator('tbody button').click();
 assert.equal(await page.locator('#detail h2').innerText(),'PROMPT_55');await page.reload();await page.locator('#detail').waitFor();assert.equal(await page.locator('#detail h2').innerText(),'PROMPT_55');
 await page.getByRole('button',{name:'Optimization',exact:true}).click();await page.getByRole('button',{name:'Generate candidate',exact:true}).click();await page.getByRole('textbox',{name:'Edit candidate'}).waitFor();
 await page.getByRole('textbox',{name:'Edit candidate'}).fill('You are a code reviewer 55. Explain the supplied code using evidence.\nBe concise.');await page.getByRole('button',{name:'Save edited proposal'}).click();await page.getByRole('heading',{name:/Proposal saved separately/}).waitFor();
 await page.route('**/api/prompts/refresh',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Simulated analysis failure'})}));await page.getByRole('button',{name:'Run scan',exact:true}).click();await page.getByRole('alert').waitFor();assert.ok(await page.getByRole('heading',{name:'Prompt inventory'}).isVisible());await page.unroute('**/api/prompts/refresh');
 console.log('PASS prompt identity, reload, search, pagination, proposal persistence');
 await page.goto(base+'/drift');await page.locator('#overlay').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Start here'}).waitFor();await page.locator('.assessment button').click();await page.locator('#drawer.open').waitFor();assert.ok(await page.locator('#dbody').getByRole('heading',{name:'What this means'}).isVisible());
 await page.locator('#dbody').getByRole('button',{name:'source',exact:true}).first().click();await page.locator('#dbody pre.code').first().waitFor();
 await page.getByRole('button',{name:'Show on map',exact:true}).click();assert.equal(await page.locator('#drawer.open').count(),0);await page.getByRole('combobox',{name:'Choose architectural deviation'}).selectOption('src/controllers/payments.controller.ts|store:database');
 assert.equal(await page.locator('.comparison-node').count(),6);await page.locator('.comparison-node').filter({hasText:'Controller'}).first().click();assert.equal(await page.locator('.comparison-node[aria-pressed=true]').count(),2);await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Fit comparison',exact:true}).click();await page.screenshot({path:'/tmp/fehm-drift-comparison.png'});
 await page.setViewportSize({width:390,height:844});const sides=await page.locator('.comparison-side').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width})));assert.equal(Math.round(sides[0].x),Math.round(sides[1].x));assert.ok(sides[1].y>sides[0].y);assert.ok(sides.every(s=>s.width<390));await page.screenshot({path:'/tmp/fehm-drift-comparison-mobile.png'});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Inspect finding source and evidence',exact:true}).click();
 await page.locator('#dbody textarea').fill('Reviewed in browser fixture');await page.getByRole('button',{name:'Mark intentional',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('intentional'));assert.ok(readFileSync(join(root,'.fehm/drift-decisions.json'),'utf8').includes('Reviewed in browser fixture'));
 await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('tab',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Inspect commit and diff',exact:true}).first().waitFor();await page.getByRole('button',{name:'Inspect commit and diff',exact:true}).first().click();await page.locator('#tab-history pre.code').first().waitFor();await page.getByRole('searchbox',{name:'Search architecture history'}).fill('no-such-architecture-event');await page.getByRole('button',{name:'Filter history',exact:true}).click();await page.getByText('No architectural finding changes match this history filter.',{exact:true}).waitFor();
 console.log('PASS drift explanation, source, comparison, mobile layout, persisted review, history diff and filters');
 await page.goto(base+'/health');await page.locator('#overlay').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Investigate first',exact:true}).waitFor();
 const finding=page.locator('#overview details.f').first();await finding.locator('summary').first().click();await finding.getByText('Inspect source and supporting evidence',{exact:true}).click();await finding.getByRole('button',{name:'Source',exact:true}).first().click();await finding.locator('pre.code').waitFor();
 await finding.getByRole('button',{name:'Reviewed',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('#overview details.f[open] button')].some(b=>b.textContent==='Reviewed'&&b.disabled));
 page.once('dialog',d=>d.accept());await page.locator('#build').getByRole('button',{name:'Run',exact:true}).click();await page.locator('#build').getByText('✓ passed',{exact:true}).waitFor();await page.locator('#build summary').first().click();assert.ok((await page.locator('#build pre.out').innerText()).includes('123'));
 await page.screenshot({path:'/tmp/fehm-human-health.png'});console.log('PASS health source, review, expanded context retention');
 await page.goto(base+'/git-memory');await page.getByRole('button',{name:'Document boundaries',exact:true}).waitFor();await page.getByRole('button',{name:'Document boundaries',exact:true}).click();await page.getByRole('button',{name:'Raw diff',exact:true}).click();await page.getByRole('heading',{name:'Raw Git diff'}).waitFor();assert.ok((await page.locator('#detail').innerText()).includes('Review service boundaries'));
 await page.route('**/api/git-memory/diff?**',async route=>{await new Promise(r=>setTimeout(r,700));await route.continue();});await page.getByRole('button',{name:'Raw diff',exact:true}).click();await page.getByRole('button',{name:'Introduce service',exact:true}).click();await page.waitForTimeout(1000);assert.equal(await page.getByRole('heading',{name:'Raw Git diff'}).count(),0);await page.unroute('**/api/git-memory/diff?**');await page.getByRole('button',{name:'Raw diff',exact:true}).click();await page.getByRole('heading',{name:'Raw Git diff'}).waitFor();await page.getByRole('button',{name:'Document boundaries',exact:true}).click();
 await page.getByRole('button',{name:/A notes.txt/}).click();await page.getByRole('heading',{name:'notes.txt',exact:true}).waitFor();await page.getByRole('button',{name:'Back to commit',exact:true}).click();
 await page.getByRole('button',{name:'Current graph references',exact:true}).click();await page.getByRole('heading',{name:'Affected code in the current checkout'}).waitFor();
 await page.getByRole('button',{name:'Compare revisions',exact:true}).click();await page.getByRole('button',{name:'Compare changes',exact:true}).click();await page.getByText('1 file differ between the selected revisions.',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/fehm-human-git.png'});console.log('PASS git real diff, file lineage, back navigation, current graph, comparison');
 await page.setViewportSize({width:390,height:844});for(const route of ['/prompts','/health','/drift','/git-memory']){await page.goto(base+route);await page.waitForTimeout(600);assert.ok(await page.locator('h1').first().isVisible());}
 assert.deepEqual(errors,[]);console.log('PASS mobile page render and no JavaScript errors');
}catch(e){console.error(e);process.exitCode=1;await page.screenshot({path:'/tmp/fehm-human-failure.png'});}finally{await browser.close();server.closeAllConnections();server.close();setTimeout(()=>process.exit(process.exitCode||0),100);}
