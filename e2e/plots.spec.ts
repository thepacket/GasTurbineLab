import { test, expect, Page } from '@playwright/test';

async function openView(page: Page, name: string) {
  const w = page.viewportSize()!.width;
  if (w >= 1180 && name === 'Results') {
    // Keep the real 3D scene mounted, but pause animation while testing charts.
    // Software WebGL on CI otherwise competes with every browser interaction.
    await page.getByRole('button', { name: 'Rotating', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Static', exact: true })).toBeVisible();
    return;
  }
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
  await expect(diagram.locator('.plot-inspection')).toBeVisible();
  await expect(diagram.locator('.plot-inspection')).toContainText('Core');
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

test('station charts share keyboard inspection and zoom can be reset', async ({ page }) => {
  await openView(page, 'Results');
  const pressure = page.getByRole('img', { name: 'Total pressure through the engine', exact: true });
  const temperature = page.getByRole('img', { name: 'Total temperature through the engine', exact: true });
  await pressure.focus();
  await pressure.press('Home');
  await pressure.press('ArrowRight');
  await expect(pressure.locator('.plot-inspection')).toHaveAttribute('data-x', '1');
  await expect(temperature.locator('.plot-inspection')).toHaveAttribute('data-x', '1');
  const path = pressure.locator('path[stroke]').first();
  const original = await path.getAttribute('d');
  await page.getByRole('button', { name: 'Zoom in Total pressure through the engine', exact: true }).click();
  await expect(path).not.toHaveAttribute('d', original!);
  await expect(page.getByRole('button', { name: 'Reset zoom Total temperature through the engine', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset zoom Total pressure through the engine', exact: true }).click();
  await expect(path).toHaveAttribute('d', original!);
});

test('sampling can be cancelled and restarted without showing a late result', async ({ page }) => {
  await openView(page, 'Uncertainty');
  const samples = page.getByLabel('Samples', { exact: true });
  await samples.fill('5000');
  await page.getByRole('button', { name: 'Run Monte Carlo', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Analysis progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run Monte Carlo', exact: true })).toBeEnabled();
  await expect(page.getByRole('progressbar', { name: 'Analysis progress' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Net thrust', exact: true })).toHaveCount(0);
  await samples.fill('20');
  await page.getByRole('button', { name: 'Run Monte Carlo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Net thrust', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Monte Carlo', exact: true })).toBeEnabled();
  await expect(page.locator('.analysis-error')).toHaveCount(0);
});

test('comparison keeps absolute and percentage differences readable in both themes', async ({ page }, info) => {
  await openView(page, 'Compare');
  await page.getByRole('button', { name: 'Pin current design as B', exact: true }).click();
  const table = page.getByRole('region', { name: 'Design comparison' });
  const delta = table.getByRole('row').filter({ hasText: 'Net thrust (kN)' }).locator('td').last();
  await expect(delta.locator('small')).toContainText('0.0 %');
  await expect(delta).toContainText('0.00');
  await expect(table).toBeVisible();
  expect(await table.evaluate(el => el.getBoundingClientRect().width <= el.closest('.pane')!.getBoundingClientRect().width)).toBe(true);
  await table.screenshot({ path: `test-results/refined-compare-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(delta.locator('small')).toContainText('0.0 %');
  await table.screenshot({ path: `test-results/refined-compare-light-${info.project.name}.png` });
});


test('transient map keyboard inspection selects the same time on related charts', async ({ page }) => {
  await openView(page, 'Transient');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const map = page.getByRole('img', { name: 'transient trajectory on compressor map', exact: true });
  await map.focus();
  await map.press('Home');
  await map.press('ArrowRight');
  const selected = await map.locator('.map-selection').getAttribute('data-time');
  expect(selected).not.toBeNull();
  await expect(page.getByRole('img', { name: 'Spool speeds', exact: true }).locator('.plot-inspection')).toHaveAttribute('data-x', selected!);
});
