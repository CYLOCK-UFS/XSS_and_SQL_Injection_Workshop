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

/**
 * O inventario de URLs publicas.
 *
 * Esta lista existe porque o mapa de rotas e o mapa de arquivos andaram juntos
 * durante o redesenho, e uma entrada errada nao aparece em nenhum outro teste:
 * o servidor devolve 404 com o 404 do app, que e uma pagina valida. Aqui cada
 * URL da oficina e conferida uma vez, num arquivo so.
 *
 * Os aliases legados tambem entram: eles sao o contrato com material ja
 * publicado, entao quebram junto com o resto se um dia sumirem.
 */
const PAGINAS = [
  ['/', 200],
  ['/finbank', 200],
  ['/finbank/agencias', 200],
  ['/finbank/extrato', 200],
  ['/finbank/comunicados', 200],
  ['/finbank/noticia', 200],
  ['/finbank/perfil', 200],
  ['/cheflab', 200],
  ['/cheflab/receita', 200],
  ['/palco', 200],
  ['/banco/agencias.html', 200],
  ['/banco/extrato.html', 200],
  ['/banco/noticia.html', 200],
  ['/receitas/receitas.html', 200],
  ['/finbank/inexistente', 404],
  ['/cheflab/inexistente', 404],
];

for (const [rota, status] of PAGINAS) {
  test(`${rota} responde ${status}`, async ({ page }) => {
    const resposta = await page.goto(rota);
    expect(resposta.status()).toBe(status);
    await expect(page.locator('body')).toBeVisible();
  });
}
