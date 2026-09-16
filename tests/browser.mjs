// Optional visual gate: npm install --no-save playwright@1.51.1 && npx playwright install chromium
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1512,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.ARCHI_URL??'http://127.0.0.1:4173');
 await page.getByRole('heading',{name:'Order Service',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/architecture-desktop.png',fullPage:true});
 await page.getByRole('tab',{name:/Deployments/}).click();
 await page.getByRole('button',{name:'Payment Adapter',exact:true}).click();
 await page.getByText('Snapshot differs in image and replicas.').waitFor();
 await page.getByLabel('Deployment context').selectOption('prod-west');
 assert.equal(await page.getByText('Snapshot differs in image and replicas.').count(),0);
 await page.getByRole('button',{name:/Environments/}).click();
 await page.locator('.compare-controls select').first().selectOption('prod-east');
 await page.locator('.compare-controls select').last().selectOption('prod-west');
 assert.equal(await page.locator('tbody .status').filter({hasText:'different'}).count(),2);
 await page.screenshot({path:'artifacts/environment-comparison.png',fullPage:true});
 await page.getByLabel('Search services').fill('inventory');assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByLabel('Search services').fill('does-not-exist');await page.getByText(/No matching services/).waitFor();
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByRole('tab',{name:/System/}).click();assert.equal(await page.locator('.graph-node').count(),3);
 await page.getByRole('button',{name:'Commerce',exact:true}).dblclick();assert.equal(await page.locator('.graph-node').count(),8);
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByRole('button',{name:'Notification Worker',exact:true}).click();await page.getByText(/No commit evidence/).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:/Export snapshot/}).click();assert.equal((await download).suggestedFilename(),'archi-snapshot.json');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'artifacts/architecture-mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 assert.deepEqual(errors,[]);console.log('Browser interactions and desktop/mobile screenshots passed');
}finally{await browser.close();}
