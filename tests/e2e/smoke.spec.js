import { expect, test } from '@playwright/test';

/**
 * Prova minima de que o navegador subiu e que a aplicacao responde. Se este
 * arquivo falhar, o problema e de ambiente (navegador ausente, banco fora), e
 * nao dos cenarios.
 */
test('a aplicacao sobe e a pagina inicial carrega', async ({ page }) => {
  const resposta = await page.goto('/');
  expect(resposta.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();
});
