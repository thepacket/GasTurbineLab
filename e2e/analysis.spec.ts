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
    await page.locator('header').getByRole('button', { name, exact: true }).click();
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
