import { test, expect, Page } from '@playwright/test';

async function openView(page: Page, name: string) {
  const w = page.viewportSize()!.width;
  if (w >= 1180 && name === 'Results') return;
  if (w < 760) {
    const direct = page.locator('nav.tabbar').getByRole('button', { name, exact: true });
    if (await direct.count()) await direct.click();
    else { await page.locator('nav.tabbar').getByRole('button', { name: 'More' }).click(); await page.locator('.moremenu').getByRole('button', { name, exact: true }).click(); }
  } else if (w < 1180) {
    await page.getByLabel('View').selectOption({ label: name });
  } else {
    const btn = page.locator('header').getByRole('button', { name, exact: true });
    if (await btn.count()) await btn.click();
    else await page.getByLabel('Analysis tools').selectOption({ label: name });
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto('/');
  await expect(page.getByText('Gas Turbine Lab').first()).toBeVisible();
});


test('result plots render finite coordinates and hover values', async ({ page }, info) => {
  await openView(page, 'Results');
  const diagram = page.getByRole('img', { name: 'Temperature–entropy diagram', exact: true });
  await expect(diagram).toBeVisible();
  const bad = await page.locator('.chart svg').evaluateAll(svgs => svgs.flatMap(svg => Array.from(svg.querySelectorAll('*')).flatMap(el => Array.from(el.attributes).filter(a => ['d', 'cx', 'cy', 'x', 'y', 'x1', 'x2', 'y1', 'y2'].includes(a.name) && /NaN|Infinity/.test(a.value)).map(a => a.value))));
  expect(bad).toEqual([]);
  await diagram.hover();
  await expect(diagram.locator('text')).not.toHaveCount(0);
  await diagram.screenshot({ path: `test-results/plot-ts-${info.project.name}.png` });
});

test('empty sweeps report no data and recover after corrected bounds', async ({ page }) => {
  await openView(page, 'Explore');
  await page.getByLabel('Sweep from', { exact: true }).fill('20000');
  await page.getByLabel('Sweep to', { exact: true }).fill('10000');
  await expect(page.getByText('Sweep bounds must be finite with the upper bound greater than the lower bound.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Net thrust', exact: true })).toHaveCount(0);
  await page.getByLabel('Sweep from', { exact: true }).fill('0');
  await expect(page.getByRole('img', { name: 'Net thrust', exact: true })).toBeVisible();
});

test('transient result retains its controller labels after controls change', async ({ page }, info) => {
  await openView(page, 'Transient');
  const run = page.getByRole('button', { name: 'Run', exact: true });
  await expect(run).toBeEnabled();
  await page.getByLabel('Controller mode', { exact: true }).selectOption('N2');
  await page.getByLabel('Duration', { exact: true }).fill('2');
  await run.click();
  await expect(run).toBeEnabled();
  const plot = page.getByRole('img', { name: 'Controller: N2 demand vs measured', exact: true });
  await expect(plot).toBeVisible();
  await page.getByLabel('Controller mode', { exact: true }).selectOption('Fn');
  await expect(plot).toBeVisible();
  await expect(page.getByRole('img', { name: 'Controller: Fn demand vs measured', exact: true })).toHaveCount(0);
  await expect(page.getByText(/changed since this transient was computed/)).toBeVisible();
  await plot.screenshot({ path: `test-results/plot-controller-${info.project.name}.png` });
});

test('off-design family plots identify every family in speed and surge series', async ({ page }) => {
  await openView(page, 'Explore');
  await page.getByRole('button', { name: 'Off-design sweeps', exact: true }).click();
  await page.getByRole('combobox', { name: /^Family/ }).selectOption('od_alt');
  const speed = page.locator('.chart').filter({ has: page.getByRole('heading', { name: 'Spool speeds', exact: true }) });
  await expect(speed.locator('.legendrow')).toContainText('Altitude 0.00 m');
  await expect(speed.locator('.legendrow')).toContainText('Altitude 15,000.00 m');
  const surge = page.locator('.chart').filter({ has: page.getByRole('heading', { name: 'Compressor surge margins', exact: true }) });
  await expect(surge.locator('.legendrow')).toContainText('Altitude 15,000.00 m');
});
