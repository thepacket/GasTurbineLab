import { test, expect } from '@playwright/test';
import { encodeShare } from '../src/ui/share';
import { defaultInputs } from '../src/engine/defaults';

test('a shared link restores the design', async ({ page }) => {
  const inputs = defaultInputs('turbojet');
  inputs.burner.T4_K = 1235;
  const hash = await encodeShare({ inputs, mode: 'design', note: 'Shared design' });
  await page.goto('/#d=' + hash);
  const w = page.viewportSize()!.width;
  if (w < 760) await page.locator('nav.tabbar').getByRole('button', { name: 'Build' }).click();
  await expect(page.getByRole('button', { name: 'Turbojet' })).toHaveClass(/on/);
  await expect(page.getByLabel('Turbine inlet temperature T4').first()).toHaveValue('1235');
});
