import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('command line opens with Ctrl+K and runs studio commands', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+k');
  const input = page.getByTestId('command-input');
  await expect(input).toBeVisible();
  await input.fill('help');
  await input.press('Enter');
  await expect(page.getByTestId('command-output')).toContainText('goto <stage>');
  await input.fill('goto map');
  await input.press('Enter');
  await expect(page.getByTestId('command-output')).toContainText('Now on map.');
  await input.fill('list');
  await input.press('Enter');
  await expect(page.getByTestId('command-output')).toContainText('No source files yet');
  await input.fill('pwd');
  await input.press('Enter');
  await expect(page.getByTestId('command-output')).toContainText('No workspace folder is open');
});
