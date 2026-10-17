import { expect, test } from '@jupyterlab/galata';

test('adds the Asyntai AI Assistant panel to the right sidebar', async ({
  page
}) => {
  const tab = page.locator('.lm-TabBar-tab[data-id="asyntai-ai-assistant"]');
  await expect(tab).toHaveCount(1);

  await tab.click();
  const panel = page.locator('#asyntai-ai-assistant');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.jp-AsyntaiPanel-title')).toHaveText(
    'Asyntai AI Assistant'
  );
  // Without an API key the panel asks for one.
  await expect(panel.locator('.jp-AsyntaiPanel-key input')).toBeVisible();
});

test('registers the Asyntai commands in the palette', async ({ page }) => {
  await page.keyboard.press('Control+Shift+C');
  await page.locator('.lm-CommandPalette-input').fill('Asyntai');
  await expect(
    page.locator('.lm-CommandPalette-itemLabel', {
      hasText: 'Open Asyntai AI Assistant'
    })
  ).toHaveCount(1);
});
