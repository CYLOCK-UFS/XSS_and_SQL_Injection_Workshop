import { expect, test } from '@playwright/test';

/**
 * Cenario 4 - XSS armazenado, provado no navegador.
 *
 * Este e o teste que faltava no laboratorio. A suite de aceitacao (T07) so
 * faz grep de `innerHTML` no fonte: ela prova que o codigo vulnavel ainda
 * TEXTO o sink, mas nao que o payload CHEGA a executar. Um `innerHTML` que
 * deixasse de interpolar o comentario, ou um cabecalho novo que bloqueasse o
 * `onerror`, passariam por T07 e quebrariam a demonstracao ao vivo sem que
 * nada acusasse.
 *
 * Aqui a prova e de observacao: o `alert(document.domain)` e disparado pelo
 * proprio navegador, e o teste escuta o dialogo. No modo seguro o mesmo
 * payload nao pode disparar, e a marcacao precisa aparecer como texto.
 *
 * Note que `document.domain` devolve o host SEM a porta, entao o valor
 * observado e `127.0.0.1` e nao `127.0.0.1:3000`.
 */

/** Sink do texto do comentario: dispara sozinho, sem interacao. */
const PAYLOAD = '<img src=x onerror=alert(document.domain)>';

/**
 * Sink do nome do autor. Precisa disparar sozinho tambem: um `onmouseover`
 * exigiria um hover e o teste passaria a depender de quando o ponteiro passa
 * sobre o elemento. 36 caracteres, bem dentro do VARCHAR(80).
 */
const PAYLOAD_AUTOR = '<img src=x onerror=alert(1)>';

/** Lista de comentarios, na ordem em que a pagina desenha. */
const COMENTARIOS = '#lista-comentarios li.comentario';

/**
 * Grava o comentario e espera a lista crescer.
 *
 * A espera e por contagem, e nao por texto do autor: no modo vulneravel o
 * autor pode ser um elemento em vez de texto, e um `hasText` passaria a
 * depender de o payload estar ou nao renderizado -- exatamente o que o teste
 * esta tentando provar.
 */
async function publicar(page, { autor, texto }) {
  const antes = await page.locator(COMENTARIOS).count();

  await page.fill('#campo-autor', autor);
  await page.fill('#campo-texto', texto);
  await page.click('#formulario button[type="submit"]');

  await expect
    .poll(() => page.locator(COMENTARIOS).count(), { timeout: 5000 })
    .toBe(antes + 1);
}

/**
 * Coleta os alert() disparados na pagina.
 *
 * O listener precisa estar registrado ANTES de qualquer navegacao, porque o
 * XSS armazenado dispara no load, sem interacao: quem chega depois do load
 * perde o evento.
 */
function escutarDialogos(page) {
  const disparados = [];
  page.on('dialog', async (dialogo) => {
    disparados.push(dialogo.message());
    await dialogo.dismiss();
  });
  return disparados;
}

/** Coloca o laboratorio no modo pedido e abre o ChefLab. */
async function abrir(page, modo) {
  const resposta = await page.request.post('/api/mode', { data: { mode: modo } });
  expect(resposta.ok()).toBeTruthy();

  await page.goto('/receitas/receitas.html');
  await page.waitForLoadState('networkidle');
}

test.describe('Cenario 4 - XSS armazenado no ChefLab', () => {
  test.beforeEach(async ({ request }) => {
    // O E2E grava comentarios de verdade no MySQL compartilhado com a suite
    // de aceitacao, entao cada caso comeca do estado inicial.
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
  });

  test('modo vulneravel: o payload no comentario dispara o alert', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'vuln');
    await publicar(page, { autor: 'Chef Teste', texto: PAYLOAD });

    // O alert vem do onerror do <img src=x>: a imagem quebra e o handler roda.
    await expect.poll(() => disparados.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(disparados[0]).toBe('127.0.0.1');
  });

  test('modo vulneravel: o XSS e armazenado, dispara a cada visita', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'vuln');
    await publicar(page, { autor: 'Chef Teste', texto: PAYLOAD });

    await expect.poll(() => disparados.length, { timeout: 5000 }).toBeGreaterThan(0);
    const aposGravacao = disparados.length;

    // "Armazenado" significa exatamente isto: uma nova visita, sem nenhuma
    // interacao nova, executa o payload de novo.
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect
      .poll(() => disparados.length, { timeout: 5000 })
      .toBeGreaterThan(aposGravacao);
  });

  test('modo seguro: o mesmo payload nao executa e aparece como texto', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'safe');
    await publicar(page, { autor: 'Chef Teste', texto: PAYLOAD });

    const comentario = page.locator(COMENTARIOS).first();
    await expect(comentario).toContainText(PAYLOAD);

    // E o ponto central do cenario: nenhum no <img> foi criado, logo nenhum
    // onerror existe e nada dispara.
    expect(await comentario.locator('img').count()).toBe(0);
    await page.waitForTimeout(750);
    expect(disparados).toEqual([]);
  });

  test('modo seguro: a marcacao nao vira elemento em nenhum dos dois campos', async ({ page }) => {
    await abrir(page, 'safe');
    await publicar(page, { autor: PAYLOAD_AUTOR, texto: PAYLOAD });

    const comentario = page.locator(COMENTARIOS).first();
    await expect(comentario.locator('img, b, i, script, svg')).toHaveCount(0);

    // O payload esta la, como caracteres literais, nos dois campos.
    await expect(comentario.locator('strong')).toHaveText(PAYLOAD_AUTOR);
    await expect(comentario.locator('.comentario__texto')).toHaveText(PAYLOAD);
  });

  /**
   * O segundo sink. O DAS documenta apenas texto_comentario, mas o
   * renderizador vulnavel interpola nome_autor no mesmo innerHTML -- o autor
   * tambem e um ponto de injecao, e nenhum ponto do roteiro aponta para ele.
   *
   * O teste trava o comportamento dos dois lados: no modo vuln o autor DEVE ser
   * injetavel, no modo seguro a mesma marcacao DEVE virar texto. Ele existe
   * para registrar um furo didatico do laboratorio em vez de esconde-lo.
   */
  test('o nome do autor e um segundo sink, nao apenas o texto', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'vuln');
    await publicar(page, { autor: PAYLOAD_AUTOR, texto: 'Comentario innocuo.' });

    await expect.poll(() => disparados.length, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(page.locator(`${COMENTARIOS} strong img`)).toHaveCount(1);
  });

  test('modo seguro: o nome do autor com marcacao e exibido como texto', async ({ page }) => {
    await abrir(page, 'safe');
    await publicar(page, { autor: PAYLOAD_AUTOR, texto: 'Comentario innocuo.' });

    const comentario = page.locator(COMENTARIOS).first();
    await expect(comentario.locator('strong img')).toHaveCount(0);
    await expect(comentario.locator('strong')).toHaveText(PAYLOAD_AUTOR);
  });
});
