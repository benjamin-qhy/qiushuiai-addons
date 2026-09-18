import { expect } from '../../../../tests/addon-e2e/support/world';
import type { StepDefinition } from '../../../../tests/addon-e2e/support/gherkin-runner';
import type { Page, Locator } from '@playwright/test';

function pane(page: Page): Locator {
  return page.locator('.sample-addon-settings');
}

function fieldByLabel(page: Page, label: string): Locator {
  return pane(page).getByLabel(label, { exact: true });
}

async function apiJson(ctx: any, path: string): Promise<any> {
  const response = await ctx.page.request.get(path);
  expect(response.ok(), `GET ${path} should succeed: ${await response.text().catch(() => '')}`).toBeTruthy();
  return await response.json();
}

async function keychainHas(ctx: any, name: string): Promise<boolean> {
  const data = await apiJson(ctx, '/agent/keychain');
  return (data.entries || []).some((entry: any) => entry.name === name);
}

export const steps: StepDefinition[] = [
  {
    pattern: /^I should see the "Enabled" toggle$/,
    async handler(ctx) {
      const input = fieldByLabel(ctx.page, 'Enabled');
      await expect(input).toBeVisible({ timeout: 5000 });
      await expect(input).toHaveAttribute('type', 'checkbox');
    },
  },
  {
    pattern: /^I should see the "Greeting" field$/,
    async handler(ctx) {
      const input = fieldByLabel(ctx.page, 'Greeting');
      await expect(input).toBeVisible({ timeout: 5000 });
    },
  },
  {
    pattern: /^I should see the "API key" secret field$/,
    async handler(ctx) {
      const input = fieldByLabel(ctx.page, 'API key');
      await expect(input).toBeVisible({ timeout: 5000 });
      await expect(input).toHaveAttribute('type', 'password');
    },
  },
  {
    pattern: /^I set "Greeting" to "([^"]*)"$/,
    async handler(ctx, value) {
      ctx.state.settingsPaneLabel = 'Sample Addon';
      const input = fieldByLabel(ctx.page, 'Greeting');
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill(value);
      await input.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await input.blur();
      await expect(pane(ctx.page).getByRole('status')).toHaveText('Saved', { timeout: 5000 });
      await expect.poll(async () => {
        const data = await apiJson(ctx, '/agent/addons/api/sample-addon/config');
        return data?.config?.greeting ?? data?.greeting;
      }).toBe(value);
    },
  },
  {
    pattern: /^the "Greeting" field should contain "([^"]*)"$/,
    async handler(ctx, value) {
      const input = fieldByLabel(ctx.page, 'Greeting');
      const data = await apiJson(ctx, '/agent/addons/api/sample-addon/config');
      expect(data?.config?.greeting ?? data?.greeting).toBe(value);
      await expect(input).toHaveValue(value, { timeout: 5000 });
    },
  },
  {
    pattern: /^I save API key "([^"]*)"$/,
    async handler(ctx, value) {
      ctx.state.settingsPaneLabel = 'Sample Addon';
      const input = fieldByLabel(ctx.page, 'API key');
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill(value);
      await input.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await pane(ctx.page).getByRole('button', { name: /^Save$/ }).click();
      const message = pane(ctx.page).getByText('Secret saved to keychain', { exact: false });
      await expect(message).toBeVisible({ timeout: 5000 });
      await expect(input).toHaveValue('');
      expect(await keychainHas(ctx, 'sample-addon/api-key')).toBeTruthy();
    },
  },
  {
    pattern: /^the keychain indicator should show the key is present$/,
    async handler(ctx) {
      const indicator = pane(ctx.page).getByTitle('Key in keychain');
      await expect(indicator).toBeVisible({ timeout: 5000 });
      expect(await keychainHas(ctx, 'sample-addon/api-key')).toBeTruthy();
    },
  },
];
