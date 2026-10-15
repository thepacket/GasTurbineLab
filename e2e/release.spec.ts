import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeShare } from '../src/ui/share';
import { defaultInputs } from '../src/engine/defaults';

async function view(page: Page, name: string) {
  const width = page.viewportSize()!.width;
  if (width < 760) {
    if (['Build', 'Results', 'Section'].includes(name)) await page.locator('nav.tabbar').getByRole('button', {name, exact:true}).click();
    else { await page.getByRole('button', {name:'More', exact:true}).click(); await page.getByRole('button', {name, exact:true}).click(); }
  } else if (width < 1180) await page.getByLabel('View').selectOption({label:name});
  else if (['Section', 'Compare'].includes(name)) await page.locator('header').getByRole('button', {name, exact:true}).click();
  else if (name !== 'Results') await page.getByLabel('Analysis tools').selectOption({label:name});
}

test('off-design Gallery summary and report agree with the exported result after reload', async ({page}) => {
  const inputs = defaultInputs('turbojet'); inputs.chemistry = 'frozen'; inputs.HPX_W = 100000;
  const hash = await encodeShare({inputs, mode:'offdesign', od:{altitude_m:0,mach:0,dT_isa:0,throttle:{mode:'T4',value:1200}}});
  await page.goto('/#d=' + hash);
  await expect(page.getByRole('spinbutton', {name:'Power extraction (kW)',exact:true})).toHaveValue('100');
  await view(page, 'Results');
  const csvDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8');
  const fn = Number(csv.split('\n').find(line=>line.startsWith('Fn,'))!.split(',')[1]);
  expect(fn).toBeGreaterThan(0);
  const reportPopup = page.waitForEvent('popup'); await page.getByRole('button',{name:'Report',exact:true}).click();
  const report = await reportPopup;
  await expect(report.getByText('off-design point', {exact:false})).toBeVisible();
  await expect(report.getByRole('cell', {name: `${(fn / 1000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} kN`,exact:true})).toBeVisible();
  await report.close();
  await view(page,'Gallery'); await page.getByLabel('Design name').fill('Off-design saved');
  await page.getByRole('button',{name:'Save current design',exact:true}).click();
  await page.reload(); await expect(page.getByText('Off-design saved',{exact:true})).toBeVisible();
  const jsonDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Export JSON',exact:true}).click();
  const entries = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'));
  expect(entries[0].summary.Fn_kN).toBeCloseTo(fn / 1000, 8);
  expect(entries[0].summary.T4).toBeCloseTo(1200, 3);
  expect(entries[0].mode).toBe('offdesign');
});

test('custom maps survive shared links, worker recreation and Gallery export/import in a clean browser', async ({page, browser}) => {
  const data = JSON.parse(await readFile('src/data/maps.json','utf8')).compressors.AXI5;
  const inputs = defaultInputs('turbojet'); inputs.chemistry = 'frozen'; inputs.mapIds = {comp:'custom:release audit é'};
  const hash = await encodeShare({inputs,mode:'offdesign',maps:[{id:'custom:release audit é',kind:'compressor',data}],od:{altitude_m:0,mach:0,dT_isa:0,throttle:{mode:'T4',value:1500}}});
  await page.goto('/#d=' + hash); await view(page,'Results');
  await expect(page.getByText(/Off-design solver did not converge|Unknown .*map|Could not solve/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole('button',{name:'Export CSV',exact:true})).toBeVisible();
  await view(page,'Gallery'); await page.getByLabel('Design name').fill('Portable map design');
  await page.getByRole('button',{name:'Save current design',exact:true}).click();
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Export JSON',exact:true}).click();
  const file = (await (await download).path())!;
  const saved = JSON.parse(await readFile(file,'utf8')); expect(saved[0].maps[0].data).toEqual(data);
  const clean = await browser.newContext({viewport:{width:1500,height:900}});
  try {
    const other = await clean.newPage(); await other.goto(new URL('/',page.url()).href); await view(other,'Gallery');
    await other.locator('input[type="file"]').setInputFiles(file);
    await expect(other.getByText('Imported 1 designs.')).toBeVisible();
    await other.getByRole('button',{name:'Load',exact:true}).click();
    await expect(other.getByText('Loaded “Portable map design”.')).toBeVisible();
    await view(other,'Maps'); await expect(other.getByLabel('comp map')).toHaveValue('custom:release audit é');
    await other.reload(); await expect(other.getByLabel('comp map')).toHaveValue('custom:release audit é');
    await expect(other.getByRole('button',{name:'Export CSV',exact:true})).toBeVisible();
    await expect(other.getByText(/Unknown .*map|Could not solve/)).toHaveCount(0);
  } finally { await clean.close(); }
});

test('mission and uncertainty results become stale when their controls change', async ({page}) => {
  await page.goto('/'); await view(page,'Mission');
  await page.getByRole('button',{name:'Fly mission',exact:true}).click();
  await expect(page.getByText('Block fuel',{exact:true})).toBeVisible();
  await page.getByRole('spinbutton',{name:'Aircraft mass',exact:true}).fill('64000');
  await expect(page.getByText(/changed since this mission was computed/)).toBeVisible();
  await view(page,'Uncertainty'); await page.getByLabel('Samples',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Run Monte Carlo',exact:true}).click();
  await expect(page.getByText('Failed samples',{exact:true})).toBeVisible();
  await page.getByLabel('Samples',{exact:true}).fill('12');
  await expect(page.getByText(/changed since this Monte Carlo run was computed/)).toBeVisible();
});
