import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto('/');
  await expect(page.getByText('Gas Turbine Lab').first()).toBeVisible();
});

test('layout matches the viewport', async ({ page }, info) => {
  const w = page.viewportSize()!.width;
  if (w >= 1180) {
    await expect(page.locator('.main.desktop')).toBeVisible();
    await expect(page.locator('aside.controls')).toBeVisible();
    await expect(page.locator('aside.results')).toBeVisible();
    await expect(page.locator('svg.cross')).toBeVisible();
    await expect(page.locator('canvas.canvas3d')).toBeVisible();
  } else if (w >= 760) {
    await expect(page.locator('.main.tablet')).toBeVisible();
    await expect(page.locator('aside.controls')).toBeVisible();
    await expect(page.locator('nav.tabbar')).toHaveCount(0);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('canvas.canvas3d')).toBeVisible();
  } else {
    await expect(page.locator('.main.phone')).toBeVisible();
    await expect(page.locator('nav.tabbar')).toBeVisible();
    await page.locator('nav.tabbar').getByRole('button', { name: 'Results' }).click();
    await expect(page.getByText('Net thrust').first()).toBeVisible();
    await page.locator('nav.tabbar').getByRole('button', { name: 'Section' }).click();
    await expect(page.locator('svg.cross')).toBeVisible();
  }
  await page.screenshot({ path: `test-results/${info.project.name}.png`, fullPage: false });
});

test('no horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

/** Bring the results into view for the current layout. */
async function showResults(page: import('@playwright/test').Page) {
  const w = page.viewportSize()!.width;
  if (w < 760) await page.locator('nav.tabbar').getByRole('button', { name: 'Results' }).click();
  else if (w < 1180) await page.locator('header').getByRole('button', { name: 'Results' }).click();
}
async function showBuild(page: import('@playwright/test').Page) {
  const w = page.viewportSize()!.width;
  if (w < 760) await page.locator('nav.tabbar').getByRole('button', { name: 'Build' }).click();
}

test('switching architecture updates the station set', async ({ page }) => {
  await showBuild(page);
  await page.getByRole('button', { name: 'Turboprop' }).click();
  await showResults(page);
  await expect(page.getByText('Shaft power delivered')).toBeVisible();
});

test('off-design mode solves in the worker', async ({ page }) => {
  await showBuild(page);
  await page.getByRole('button', { name: 'Off-design' }).click();
  await showResults(page);
  await expect(page.getByText('Off-design operating point')).toBeVisible();
  await expect(page.getByText(/converged/)).toBeVisible();
});

test('PWA manifest and service worker are served', async ({ page, request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBeTruthy();
  const manifest = await m.json();
  expect(manifest.name).toBe('Gas Turbine Lab');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  const registered = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1500)); return (await navigator.serviceWorker.getRegistrations()).length; });
  expect(registered).toBeGreaterThan(0);
});
