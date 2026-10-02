import { expect, test } from '@playwright/test';

/**
 * Cenarios 5 a 7 do DAS v2.4 - XSS no perfil, cookie didatico e keylogger.
 *
 * Estes tres cenarios sao o feedback da equipe registrado na secao 21 do DAS, e
 * os tres dependem do NAVEGADOR: nao ha o que provar por requisicao HTTP. O
 * XSS precisa executar, o `document.cookie` precisa devolver uma string
 * diferente em cada modo, e o keylogger precisa registrar tecla em um painel da
 * propria pagina. Um teste de aceitacao veria a marcacao gravada e pararia ai.
 *
 * Por isso este arquivo existe separado de banco.spec.js (que e sobre oraculos
 * de SQLi) e de cheflab.spec.js (que e sobre o sink do mural): aqui o objeto
 * observado e o DOM depois que o script rodou.
 *
 * A prova de que o XSS e ARMAZENADO e a repeticao: o payload e gravado numa
 * visita e executa na seguinte, sem interacao nova. E o mesmo criterio usado
 * em cheflab.spec.js, e vale igual aqui.
 */

/** Sink da descricao do perfil: dispara sozinho, pelo onerror do <img>. */
const PAYLOAD = '<img src=x onerror=alert(document.domain)>';

/**
 * Sink do cookie. Nao usa `alert` de proposito: o valor lido precisa ser
 * conferido por codigo, e um dialogo travaria a leitura do `document.cookie`.
 * O atributo `data-sessao` no <html> e o canal, e ele some no modo seguro.
 */
const PAYLOAD_COOKIE =
  '<img src=x onerror=document.documentElement.setAttribute("data-sessao",document.cookie)>';

/**
 * Sink do keylogger.
 *
 * Registra listeners de `keydown` nos dois campos com `data-lab-input` e
 * escreve em `#lab-eventos`. Nao ha fetch, WebSocket, beacon nem img externa: o
 * DAS (secao 10) exige que a captura fique na propria pagina, e um payload que
 * enviasse a tecla para fora nao demonstraria nada que a plateia pudesse
 * auditar -- e transformaria a oficina em material de exfiltracao real.
 */
const PAYLOAD_KEYLOGGER =
  '<img src=x onerror="document.querySelectorAll(\'[data-lab-input]\').forEach(c=>{c.addEventListener(\'keydown\',e=>{document.querySelector(\'#lab-eventos\').textContent+=\'[lab:\'+c.dataset.labInput+\'] \'+e.key+\'\\n\';});});">';

/** Painel onde o payload de leitura escreve. */
const PAINEL = '#lab-eventos';

/**
 * Coleta os alert() disparados na pagina.
 *
 * O listener precisa estar registrado ANTES de qualquer navegacao, porque o XSS
 * armazenado dispara no load. Quem chega depois do load perde o evento.
 */
function escutarDialogos(page) {
  const disparados = [];
  page.on('dialog', async (dialogo) => {
    disparados.push(dialogo.message());
    await dialogo.dismiss();
  });
  return disparados;
}

/** Coloca o laboratorio no modo pedido e abre a pagina de perfil. */
async function abrir(page, modo, consulta = '') {
  const resposta = await page.request.post('/api/mode', { data: { mode: modo } });
  expect(resposta.ok()).toBeTruthy();

  await page.goto(`/finbank/perfil${consulta}`);
  await page.waitForLoadState('networkidle');
}

/**
 * Grava a descricao e espera o perfil redesenhar.
 *
 * A espera e pelo aviso de sucesso, e nao pelo texto: no modo vulneravel a
 * descricao pode ser um elemento em vez de texto, e um `hasText` passaria a
 * depender de o payload estar ou nao renderizado -- exatamente o que o teste
 * esta tentando provar.
 */
async function salvar(page, texto) {
  await page.fill('#perfil-descricao-forma', texto);
  await page.click('#formulario-perfil button[type="submit"]');

  await expect(page.locator('#aviso-perfil')).toContainText('perfil salvo');
}

test.describe('Cenario 5 - XSS armazenado no perfil do FinBank (T11 do DAS)', () => {
  test.beforeEach(async ({ request }) => {
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
  });

  test('modo vulneravel: o payload na descricao dispara o alert', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD);

    await expect.poll(() => disparados.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(disparados[0]).toBe('127.0.0.1');
  });

  test('modo vulneravel: o XSS e armazenado, dispara a cada visita', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD);

    await expect.poll(() => disparados.length, { timeout: 5000 }).toBeGreaterThan(0);
    const aposGravacao = disparados.length;

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect
      .poll(() => disparados.length, { timeout: 5000 })
      .toBeGreaterThan(aposGravacao);
  });

  test('modo seguro: o mesmo payload nao executa e aparece como texto', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'safe');
    await salvar(page, PAYLOAD);

    const descricao = page.locator('#perfil-descricao');

    // O texto e o do payload: e `textContent`, entao o navegador mostra os
    // caracteres e nao constroi o elemento.
    await expect(descricao).toHaveText(PAYLOAD);
    expect(await descricao.locator('img, script, svg, iframe').count()).toBe(0);

    await page.waitForTimeout(750);
    expect(disparados).toEqual([]);
  });

  test('a gravacao e igual nos dois modos: o que muda e a saida', async ({ page }) => {
    // O ponto pedagogico do cenario. Se a API devolvesse o texto escapado no
    // modo seguro, o aluno concluiria que a correcao estava "no banco", e a
    // conclusao errada dominaria a discussao.
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD);

    const resposta = await page.request.get('/banco/perfil?id_cliente=CLI001');
    expect(resposta.ok()).toBeTruthy();
    expect((await resposta.json()).perfil.descricao_perfil).toBe(PAYLOAD);
  });

  test('a query string escolhe o cliente do perfil (navegacao contextual)', async ({ page }) => {
    // O botao de retorno do console leva `/finbank/perfil?id_cliente=CLI001`. Se a
    // pagina ignorasse o parametro, o roteiro voltaria sempre para o CLI001 e a
    // navegacao contextual seria decorativa.
    await abrir(page, 'vuln', '?id_cliente=CLI001');

    await expect(page.locator('#perfil-id-cliente')).toHaveValue('CLI001');
  });

  test('a pagina abre com os dois campos de laboratorio e o painel', async ({ page }) => {
    await abrir(page, 'vuln');

    await expect(page.locator('[data-lab-input="senha"]')).toBeVisible();
    await expect(page.locator('[data-lab-input="cartao"]')).toBeVisible();
    await expect(page.locator(PAINEL)).toBeVisible();
    await expect(page.locator(PAINEL)).toBeEmpty();
  });
});

test.describe('Cenario 6 - lab_session legivel no vuln e HttpOnly no safe (T12 do DAS)', () => {
  test.beforeEach(async ({ request }) => {
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
  });

  test('modo vulneravel: document.cookie expoe a sessao sintetica', async ({ page }) => {
    await abrir(page, 'vuln');

    const cookies = await page.evaluate(() => document.cookie);

    expect(cookies).toContain('lab_session=sess-vuln-');

    // lab_mode NAO aparece: ele e HttpOnly nos dois modos. Se aparecesse, o
    // payload da bio poderia ler o modo e escolher o `vuln` sozinho, sem
    // ninguem clicar no botao do console.
    expect(cookies).not.toContain('lab_mode');
  });

  test('modo seguro: document.cookie devolve a string vazia', async ({ page }) => {
    await abrir(page, 'safe');

    const cookies = await page.evaluate(() => document.cookie);

    // Nao e que o cookie tenha desaparecido do navegador: ele continua na aba,
    // visivel em devtools. O que o script deixou de ver foi o atributo.
    expect(cookies).not.toContain('lab_session');
    expect(cookies).toBe('');

    // A prova de que o cookie continua la, sem o script poder le-lo.
    const visivelParaOHttp = await page.context().cookies();
    const sessao = visivelParaOHttp.find((c) => c.name === 'lab_session');

    expect(sessao).toBeTruthy();
    expect(sessao.httpOnly).toBe(true);
    expect(sessao.value).toMatch(/^sess-safe-/);
  });

  test('o valor e sintetico e acompanha a bancada', async ({ page }) => {
    await abrir(page, 'vuln');

    const cookies = await page.evaluate(() => document.cookie);
    const sessao = /lab_session=(sess-vuln-[a-z0-9]+)/.exec(cookies);

    expect(sessao).not.toBeNull();

    // O valor e `sess-vuln-<bancada>`: um identificador de laboratorio, sem
    // token de autenticacao e sem dado pessoal. E o que o DAS exige na secao 9.
    expect(sessao[1]).toMatch(/^sess-vuln-(aluno\d+|LAB_ALUNO_ID)$/);
  });

  test('o payload de leitura do cookie so funciona no modo vulneravel', async ({ page }) => {
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD_COOKIE);

    const lidoNoVuln = await page.evaluate(() =>
      document.documentElement.getAttribute('data-sessao'),
    );

    expect(lidoNoVuln).toContain('lab_session=sess-vuln-');
  });

  test('no modo seguro o mesmo payload recebe uma string vazia', async ({ page }) => {
    const disparados = escutarDialogos(page);

    await abrir(page, 'safe');
    await salvar(page, PAYLOAD_COOKIE);

    const lidoNoSafe = await page.evaluate(() =>
      document.documentElement.getAttribute('data-sessao'),
    );

    // HttpOnly nao chega para o script: em vez de `null`, o payload grava a
    // string vazia -- e nao a sessao.
    expect(lidoNoSafe).toBe('');
    await expect(page.locator('#perfil-descricao')).toHaveText(PAYLOAD_COOKIE);
    expect(disparados).toEqual([]);
  });

  test('trocar de modo pelo console muda o que o script enxerga, sem recarregar', async ({ page }) => {
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD_COOKIE);

    const antes = await page.evaluate(() => document.cookie);
    expect(antes).toContain('lab_session=sess-vuln-');

    await page.request.post('/api/mode', { data: { mode: 'safe' } });
    await page.goto('/finbank/perfil');
    await page.waitForLoadState('networkidle');

    const depois = await page.evaluate(() => document.cookie);
    expect(depois).not.toContain('lab_session');
    expect(depois).toBe('');
  });
});

test.describe('Cenario 7 - keylogger didatico (T13 do DAS)', () => {
  test.beforeEach(async ({ request }) => {
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
  });

  test('modo vulneravel: as teclas dos campos de laboratorio viram painel', async ({ page }) => {
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD_KEYLOGGER);

    await page.locator('[data-lab-input="senha"]').pressSequentially('abc');
    await page.locator('[data-lab-input="cartao"]').pressSequentially('42');

    const painel = page.locator(PAINEL);

    // O rotulo `[lab:senha]` vem de `c.dataset.labInput`: e a prova de que o
    // listener leu o campo CERTO, e nao apenas qualquer input da pagina.
    await expect(painel).toContainText('[lab:senha] a');
    await expect(painel).toContainText('[lab:senha] b');
    await expect(painel).toContainText('[lab:senha] c');
    await expect(painel).toContainText('[lab:cartao] 4');
    await expect(painel).toContainText('[lab:cartao] 2');
  });

  test('o payload nao observa campos fora dos dois de laboratorio', async ({ page }) => {
    // O escopo do `querySelectorAll('[data-lab-input]')` e o que torna o
    // cenario DIDATICO. Um keylogger real observa tudo, e este nao: ele le os
    // dois campos ficticios e nada mais.
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD_KEYLOGGER);

    await page.locator('#perfil-id-cliente').pressSequentially('ZZZ');
    await page.locator('[data-lab-input="senha"]').pressSequentially('a');

    const painel = page.locator(PAINEL);

    await expect(painel).toContainText('[lab:senha] a');
    await expect(painel).not.toContainText('Z');
  });

  test('modo seguro: nenhum listener e registrado e o painel fica vazio', async ({ page }) => {
    await abrir(page, 'safe');
    await salvar(page, PAYLOAD_KEYLOGGER);

    await page.locator('[data-lab-input="senha"]').pressSequentially('abc');
    await page.locator('[data-lab-input="cartao"]').pressSequentially('42');

    // O texto do payload aparece na bio como caracteres, e o painel nao muda.
    await expect(page.locator('#perfil-descricao')).toHaveText(PAYLOAD_KEYLOGGER);
    await expect(page.locator(PAINEL)).toBeEmpty();
  });

  test('a captura fica na pagina: nenhuma requisicao sai do laboratorio', async ({ page }) => {
    await abrir(page, 'vuln');
    await salvar(page, PAYLOAD_KEYLOGGER);

    // Qualquer coisa que nao seja a propria pagina do laboratorio seria
    // exfiltracao, e o DAS (secao 10) proibe. O registro de rede e a prova
    // observavel disso -- e e verificavel por anyone, sem ler o payload.
    const externas = [];
    page.on('request', (requisicao) => {
      const url = new URL(requisicao.url());
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        externas.push(requisicao.url());
      }
    });

    await page.locator('[data-lab-input="senha"]').pressSequentially('segredo');
    await expect(page.locator(PAINEL)).toContainText('[lab:senha] s');

    expect(externas).toEqual([]);
  });
});