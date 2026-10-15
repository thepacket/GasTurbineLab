import { test, expect } from '@playwright/test';

test('static 3D stops drawing and redraws when the casing changes', async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1180, 'Desktop keeps the 3D scene beside the plots.');
  await page.addInitScript(() => {
    const state = { draws: 0, lastDraw: 0 };
    Object.assign(window, { renderProbe: state });
    for (const method of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced'] as const) {
      const original = WebGL2RenderingContext.prototype[method];
      (WebGL2RenderingContext.prototype[method] as any) = function (...args: any[]) {
        state.draws++; state.lastDraw = performance.now();
        return (original as any).apply(this, args);
      };
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rotating', exact: true }).click();
  const probe = () => page.evaluate(() => {
    const p = (window as any).renderProbe;
    return { draws: p.draws, quiet: performance.now() - p.lastDraw };
  });
  await expect.poll(async () => (await probe()).draws).toBeGreaterThan(0);
  await expect.poll(async () => (await probe()).quiet).toBeGreaterThan(300);
  const before = (await probe()).draws;
  await page.getByRole('button', { name: 'Cutaway', exact: true }).click();
  await expect.poll(async () => (await probe()).draws).toBeGreaterThan(before);
  await expect.poll(async () => (await probe()).quiet).toBeGreaterThan(300);
  const paused = (await probe()).draws;
  await page.getByRole('button', { name: 'Static', exact: true }).click();
  await expect.poll(async () => (await probe()).draws).toBeGreaterThan(paused);
});
