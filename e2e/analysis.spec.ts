import { test, expect, Page } from '@playwright/test';

async function openView(page: Page, name: string) {
  const w = page.viewportSize()!.width;
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

test('transient view integrates a fuel step in the worker', async ({ page }) => {
  await openView(page, 'Transient');
  await expect(page.getByText('Spool speeds')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Min HPC surge margin/i)).toBeVisible();
});

test('mission view flies the default profile', async ({ page }) => {
  await openView(page, 'Mission');
  await page.getByRole('button', { name: 'Fly mission' }).click();
  await expect(page.getByText('Block fuel')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Mission points')).toBeVisible();
});

test('maps view lists assignments and generates a map', async ({ page }) => {
  await openView(page, 'Maps');
  await expect(page.getByLabel('fan map')).toBeVisible();
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/Generated/)).toBeVisible();
  await expect(page.getByLabel('hpc map').locator('option', { hasText: 'My compressor' })).toHaveCount(1);
});

test('learn view opens a scenario', async ({ page }) => {
  await openView(page, 'Learn');
  await page.getByText('Why bypass ratio raises propulsive efficiency').click();
  await expect(page.getByRole('button', { name: /Open explore/ })).toBeVisible();
});

test('optimise view runs a short optimisation', async ({ page }) => {
  await openView(page, 'Optimise');
  await page.getByLabel('Evaluation budget').fill('30');
  await page.getByRole('button', { name: 'Optimise', exact: true }).click();
  await expect(page.getByText('Apply best design')).toBeVisible({ timeout: 90_000 });
});

test('uncertainty view samples the design', async ({ page }) => {
  await openView(page, 'Uncertainty');
  await page.getByLabel('Samples').fill('60');
  await page.getByRole('button', { name: 'Run Monte Carlo' }).click();
  await expect(page.getByText('Failed samples')).toBeVisible({ timeout: 90_000 });
});

test('gallery saves and lists a design', async ({ page }) => {
  await openView(page, 'Gallery');
  await page.getByLabel('Design name').fill('e2e design');
  await page.getByRole('button', { name: 'Save current design' }).click();
  await expect(page.getByText('e2e design').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare as B' })).toBeVisible();
});

test('language toggle switches the chrome to French', async ({ page }) => {
  await page.getByRole('button', { name: /Language|Langue/ }).click();
  const w = page.viewportSize()!.width;
  if (w < 760) await expect(page.locator('nav.tabbar').getByRole('button', { name: 'Résultats' })).toBeVisible();
  else if (w < 1180) await expect(page.getByLabel('View').locator('option', { hasText: 'Résultats' })).toHaveCount(1);
  else await expect(page.locator('header').getByRole('button', { name: 'Comparer' })).toBeVisible();
});
