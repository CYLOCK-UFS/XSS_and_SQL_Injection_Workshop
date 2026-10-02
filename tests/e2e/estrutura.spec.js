import { expect, test } from '@playwright/test';

/**
 * Estrutura das telas da oficina: URLs, barra do laboratorio e o texto que a
 * plateia vai ler.
 *
 * A suite de cenarios (banco.spec.js, cheflab.spec.js) prova o comportamento dos
 * payloads. Aqui o alvo e o outro: que as PAGINAS existem, que abrem em 200 e
 * que trazem o produto que o aluno deveria estar vendo.
 *
 * Cada verificacao aqui tem um por que. Uma pagina que responde 200 e renderiza
 * um <h1> vazio passa em quase qualquer suite e falha na frente de 40 pessoas; o
 * que trava o que importa e o conteudo -- o nome do app, o titulo do
 * comunicado, a tabela com as quatro colunas do UNION.
 */

/**
 * A barra do laboratorio aparece em toda pagina de app e em nenhuma pagina de
 * ferramenta. E o que separa "esta olhando o site" de "esta olhando a
 * ferramenta", e por isso que ela e verificada em pagina de app E de nao-app.
 */
test.describe('estrutura do laboratorio', () => {
  test.beforeEach(async ({ request }) => {
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
    await request.post('/api/mode', { data: { mode: 'vuln' } });
  });

  const PAGINAS_DE_APP = [
    ['/finbank', 'FinBank'],
    ['/finbank/agencias', 'FinBank'],
    ['/finbank/extrato', 'FinBank'],
    ['/finbank/comunicados', 'FinBank'],
    ['/finbank/noticia', 'FinBank'],
    ['/finbank/perfil', 'FinBank'],
    ['/cheflab', 'ChefLab'],
    ['/cheflab/receita', 'ChefLab'],
  ];

  for (const [rota, app] of PAGINAS_DE_APP) {
    test(`${rota} abre com a barra e o nome do app`, async ({ page }) => {
      const resposta = await page.goto(rota);

      expect(resposta.status()).toBe(200);
      await expect(page.locator('.barra')).toHaveCount(1);
      await expect(page.locator('.barra__contexto')).toContainText(app);

      // `data-app` e o que mantem o CSS do laboratorio fora do app: sem ele, a
      // pagina herdaria a paleta de ferramenta.
      await expect(page.locator('body')).toHaveAttribute('data-app', app.toLowerCase());
    });
  }

  test('a barra carrega o nome do app, e nao o nome do cenario', async ({ page }) => {
    await page.goto('/finbank/extrato');
    const barra = page.locator('.barra');

    await expect(barra).toContainText('Oficina SQLi e XSS');
    await expect(barra).toContainText('FinBank');

    // O roteiro com nome de cenario fica no /palco. Se ele aparecer aqui, o
    // aluno le a resposta antes de fazer a pergunta.
    await expect(barra).not.toContainText(/Cenario\s*\d/i);
  });

  test('as paginas de ferramenta nao tem a barra', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.barra')).toHaveCount(0);
    await expect(page.locator('[data-lab-modo] .modo-controle')).toHaveCount(1);

    await page.goto('/palco');
    await expect(page.locator('.barra')).toHaveCount(0);
    await expect(page.locator('#palco-modo-controle .modo-controle')).toHaveCount(1);
  });

  test('o modo pinta o <html>, e nao a paleta do app', async ({ page }) => {
    await page.goto('/finbank');

    await page.request.post('/api/mode', { data: { mode: 'safe' } });
    await page.goto('/finbank');
    const htmlSeguro = await page.locator('html').getAttribute('data-modo');

    await page.request.post('/api/mode', { data: { mode: 'vuln' } });
    await page.goto('/finbank');
    const htmlVuln = await page.locator('html').getAttribute('data-modo');

    expect(htmlSeguro).toBe('safe');
    expect(htmlVuln).toBe('vuln');

    // A cor de fundo do app e a mesma nos dois modos: e o acento do chrome que
    // muda. Se esta assertion quebrar, alguem ligou --lab-acento a uma regra de
    // app e o aluno passa a ler o modo pela cor da pagina.
    const fundo = async () =>
      page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor,
      );

    await page.request.post('/api/mode', { data: { mode: 'safe' } });
    await page.goto('/finbank');
    const fundoSafe = await fundo();

    await page.request.post('/api/mode', { data: { mode: 'vuln' } });
    await page.goto('/finbank');
    const fundoVuln = await fundo();

    expect(fundoSafe).toBe(fundoVuln);
  });
});

test.describe('FinBank: as telas do autoatendimento', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/reset');
    await request.post('/api/mode', { data: { mode: 'vuln' } });
  });

  test('a home mostra o titular, o saldo e os atalhos', async ({ page }) => {
    await page.goto('/finbank');

    await expect(page.locator('#conta-nome')).toHaveText('Ana Ribeiro');
    await expect(page.locator('#saldo-valor')).toHaveText('R$ 12.450,00');
    await expect(page.locator('.fb-atalho')).toHaveCount(3);
    await expect(page.locator('.fb-comunicado')).toHaveCount(3);
  });

  test('agencias: a consulta devolve os quatro campos de cada filial', async ({ page }) => {
    await page.goto('/finbank/agencias');

    await expect(page.locator('.fb-agencia')).toHaveCount(10);
    await expect(page.locator('#resumo')).toContainText('10 agencia(s)');

    // As quatro posicoes da assinatura do UNION: nome, endereco, telefone e
    // gerente, nesta ordem. A ordem e o que torna o payload comparavel com o
    // que a consulta de cartoes devolve.
    const primeira = page.locator('.fb-agencia').first();
    await expect(primeira.locator('.fb-agencia__nome')).toHaveText(
      'FinBank Agencia Belo Horizonte',
    );
    await expect(primeira.locator('.fb-agencia__campo')).toHaveCount(3);
    await expect(primeira.locator('.fb-agencia__campo').nth(0)).toContainText(
      'Av. Afonso Pena, 1400 - Centro',
    );
    await expect(primeira.locator('.fb-agencia__campo').nth(1)).toContainText(
      '(31) 3011-8877',
    );
    await expect(primeira.locator('.fb-agencia__campo').nth(2)).toContainText(
      'Joao Pedro Lima',
    );
  });

  test('agencias: filtrar por cidade reduz a lista', async ({ page }) => {
    await page.goto('/finbank/agencias');

    await page.fill('#campo-cidade', 'Rio de Janeiro');
    await page.click('#formulario button[type="submit"]');

    await expect(page.locator('.fb-agencia')).toHaveCount(2);
    await expect(page.locator('#resumo')).toContainText('Rio de Janeiro');
  });

  test('extrato: a conta valida abre com os lancamentos do seed', async ({ page }) => {
    await page.goto('/finbank/extrato');

    await expect(page.locator('#extrato-conta')).toHaveText('CLI001');
    await expect(page.locator('#extrato-titular')).toHaveText('Ana Ribeiro');
    await expect(page.locator('#corpo-tabela tr')).toHaveCount(3);
    await expect(page.locator('#erro-sql')).toBeEmpty();
  });

  /**
   * O payload do roteiro do DAS v2.4: `CONCAT(1, ...)`.
   *
   * O prefixo inteiro faz a mensagem do MySQL comecar com o caractere que o
   * proprio CONCAT acrescentou, e a mensagem aparece inteira na tela. E a
   * variante usada na apresentacao; a classica com `0x7e` tem teste proprio
   * abaixo, porque material de aula antigo ainda a usa.
   */
  const EXTRACTEVALUE =
    "98765' AND EXTRACTVALUE(1, CONCAT(1, (SELECT senha FROM administradores WHERE id_admin='1'))) -- ";

  const EXTRACTEVALUE_CLASSICO =
    "98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- ";

  /**
   * O vazamento do cenario 2 tem de aparecer na tela, e nao em um console: o
   * aluno precisa VER o detalhe do MySQL para acreditar nele.
   */
  test('extrato: no modo vulneravel o detalhe do MySQL aparece na pagina', async ({ page }) => {
    await page.request.post('/api/mode', { data: { mode: 'vuln' } });
    await page.goto('/finbank/extrato');

    await page.fill('#campo-conta', EXTRACTEVALUE);
    await page.click('#formulario button[type="submit"]');

    await expect(page.locator('#painel-erro')).toBeVisible();
    await expect(page.locator('#erro-sql')).toContainText('XPATH syntax error');
    await expect(page.locator('#erro-sql')).toContainText('abcde');

    // O `1` na frente da senha prova que o prefixo veio do CONCAT e nao da
    // tabela: e o caractere que torna a origem da mensagem obvia na tela.
    await expect(page.locator('#erro-sql')).toContainText("'1abcde'");

    // O bloco existe e esta fechado: e o que se ve num produto com um
    // diagnostico escondido, e nao um alerta vermelho gritando na tela.
    await expect(page.locator('#detalhe-tecnico')).not.toHaveAttribute('open', '');
  });

  test('extrato: a variante classica com 0x7e produz o mesmo vazamento', async ({ page }) => {
    await page.request.post('/api/mode', { data: { mode: 'vuln' } });
    await page.goto('/finbank/extrato');

    await page.fill('#campo-conta', EXTRACTEVALUE_CLASSICO);
    await page.click('#formulario button[type="submit"]');

    await expect(page.locator('#erro-sql')).toContainText("'~abcde'");
  });

  /**
   * O mesmo payload no modo seguro nao vira erro: ele viaja como parametro,
   * casa com nenhuma conta e a tela responde "conta sem movimentacao". E esse
   * o ponto -- a diferenca entre os dois modos nao e "erro bonito", e "string
   * que nao vira sintaxe".
   */
  test('extrato: no modo seguro o mesmo payload volta como conta vazia', async ({ page }) => {
    await page.request.post('/api/mode', { data: { mode: 'safe' } });
    await page.goto('/finbank/extrato');

    await page.fill('#campo-conta', EXTRACTEVALUE);
    await page.click('#formulario button[type="submit"]');

    await expect(page.locator('#painel-tabela')).toBeVisible();
    await expect(page.locator('#tabela-vazia')).toBeVisible();
    await expect(page.locator('#corpo-tabela tr')).toHaveCount(0);
    await expect(page.locator('#painel-erro')).toBeHidden();
    await expect(page.locator('#detalhe-tecnico')).toBeHidden();
    await expect(page.locator('body')).not.toContainText('XPATH');
  });

  test('comunicados: o mural lista os 8 avisos do seed', async ({ page }) => {
    await page.goto('/finbank/comunicados');

    await expect(page.locator('.fb-comunicado')).toHaveCount(8);
    await expect(page.locator('.fb-comunicado').first()).toContainText(
      'FinBank adota atendimento digital nas secoes de atendimento',
    );
  });

  test('do mural ao comunicado: o link leva ao cenario 3', async ({ page }) => {
    await page.goto('/finbank/comunicados');
    await page.locator('.fb-comunicado').first().click();

    await expect(page).toHaveURL(/\/finbank\/noticia\?id=8/);
    await expect(page.locator('#artigo-titulo')).toHaveText(
      'FinBank adota atendimento digital nas secoes de atendimento',
    );
  });

  test('comunicado: 404 e 200 sao estados visiveis diferentes', async ({ page }) => {
    await page.goto('/finbank/noticia');
    await expect(page.locator('#artigo')).toBeVisible();
    await expect(page.locator('#nao-encontrado')).toBeHidden();

    await page.fill('#campo-id', '999999');
    await page.click('#formulario button[type="submit"]');

    await expect(page.locator('#artigo')).toBeHidden();
    await expect(page.locator('#nao-encontrado')).toBeVisible();
  });

  test('um caminho inexistente devolve o 404 do app, nao JSON', async ({ page }) => {
    const resposta = await page.goto('/finbank/nao-existe');

    expect(resposta.status()).toBe(404);
    await expect(page.locator('.pagina-erro')).toBeVisible();
    await expect(page.locator('.barra')).toHaveCount(1);
  });
});

test.describe('ChefLab: as telas do portal', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/reset');
    await request.post('/api/mode', { data: { mode: 'vuln' } });
  });

  test('a home lista a receita e leva a pagina dela', async ({ page }) => {
    await page.goto('/cheflab');

    await expect(page.locator('.cl-cartao')).toHaveCount(1);
    await page.locator('.cl-cartao').click();
    await expect(page).toHaveURL(/\/cheflab\/receita/);
  });

  test('a receita mostra os comentarios do seed, com data e hora', async ({ page }) => {
    await page.goto('/cheflab/receita');

    await expect(page.locator('#lista-comentarios li.comentario')).toHaveCount(2);
    await expect(page.locator('#lista-comentarios .comentario__autor strong').first()).toHaveText(
      'Chef Bruno',
    );

    // Regressao de fuso, tambem verificada em cheflab.spec.js: o texto e o
    // DATETIME gravado, com o atributo `datetime` na forma do HTML.
    const primeiro = page.locator('#lista-comentarios time').first();
    await expect(primeiro).toHaveText('11/01/2024, 19:45');
    await expect(primeiro).toHaveAttribute('datetime', '2024-01-11T19:45:00');
  });

  test('a receita tem o formulario de comentario com os dois campos', async ({ page }) => {
    await page.goto('/cheflab/receita');

    await expect(page.locator('#campo-autor')).toBeVisible();
    await expect(page.locator('#campo-texto')).toBeVisible();
    await expect(page.locator('#formulario button[type="submit"]')).toBeEnabled();
  });

  test('o conteudo da receita acompanha os comentarios do seed', async ({ page }) => {
    await page.goto('/cheflab/receita');

    // Os dois comentarios do init.sql falam de massa fresca e de agua do
    // cozimento. A receita precisa falar das duas coisas: e o que impede que a
    // pagina vire um texto generico desconectado do banco.
    await expect(page.locator('.cl-titulo')).toContainText('massa fresca');
    await expect(page.locator('.cl-passos')).toContainText('agua do cozimento');
  });
});

test.describe('console do instrutor', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/reset');
    await request.post('/api/mode', { data: { mode: 'vuln' } });
  });

  test('o console traz os sete cenarios com roteiro e payloads', async ({ page }) => {
    await page.goto('/palco');

    // Os quatro primeiros sao os cenarios originais do DAS v2.2; os tres
    //Ultimos sao o perfil, o cookie e o keylogger, do DAS v2.4. A ordem e a
    // ordem da apresentacao, e por isso que a contagem e verificada: um
    // cenario acrescentado no fim sem passar pelo roteiro some da lista sem
    // quebrar teste nenhum.
    await expect(page.locator('#seletor-cenario option')).toHaveCount(7);
    await expect(page.locator('#lista-passos .passo')).toHaveCount(5);
    await expect(page.locator('#lista-payloads .payload-linha')).toHaveCount(3);

    // A ordem e a ordem da apresentacao. Verificar so a contagem deixaria
    // passar um cenario novo inserido no fim da lista, fora do roteiro.
    const ids = await page
      .locator('#seletor-cenario option')
      .evaluateAll((opcoes) => opcoes.map((o) => o.value));

    expect(ids).toEqual(['uniao', 'erro', 'oraculo', 'xss', 'perfil', 'cookie', 'leitura']);
  });

  test('trocar de cenario troca roteiro, payloads e rota do inspetor', async ({ page }) => {
    await page.goto('/palco');
    await page.selectOption('#seletor-cenario', 'xss');

    await expect(page.locator('#descricao-cenario')).toContainText('XSS armazenado');
    await expect(page.locator('#lista-payloads')).toContainText('onerror');
    await expect(page.locator('#seletor-rota')).toHaveValue('/banco/comunicados');

    await page.selectOption('#seletor-cenario', 'erro');
    await expect(page.locator('#seletor-rota')).toHaveValue('/banco/extrato');
    await expect(page.locator('#campo-parametro')).toHaveValue('id_conta');
  });

  /**
   * O console troca de modo SEM recarregar. Quem conduz pode alternar vuln e
   * safe no meio da demonstracao; se a pagina recarregasse, o roteiro selecionado
   * voltaria para o primeiro cenario e a apresentacao perderia o fio.
   */
  test('trocar de modo no console nao recarrega a pagina', async ({ page }) => {
    await page.goto('/palco');
    await page.selectOption('#seletor-cenario', 'oraculo');

    await page.evaluate(() => {
      window.__semRecarregar = true;
    });

    await page.locator('#palco-modo-controle .modo-opcao[data-modo="safe"]').click();

    await expect(page.locator('html')).toHaveAttribute('data-modo', 'safe');
    await expect(page.locator('#seletor-cenario')).toHaveValue('oraculo');
    expect(await page.evaluate(() => window.__semRecarregar)).toBe(true);
  });

  test('o inspetor mostra status e corpo da rota sondada', async ({ page }) => {
    await page.goto('/palco');

    await page.selectOption('#seletor-cenario', 'oraculo');
    await page.fill('#campo-valor', "' OR 1=1 -- ");
    await page.click('#botao-sondar');

    await expect(page.locator('#sonda-status')).toContainText('HTTP 200');
    await expect(page.locator('#sonda-json')).toContainText('titulo');
  });

  test('o inspetor distingue 200 de 404, que e o oraculo do cenario 3', async ({ page }) => {
    await page.goto('/palco');
    await page.selectOption('#seletor-cenario', 'oraculo');

    await page.fill('#campo-valor', "' AND 1=2 -- ");
    await page.click('#botao-sondar');
    await expect(page.locator('#sonda-status')).toContainText('HTTP 404');

    await page.fill('#campo-valor', "' OR 1=1 -- ");
    await page.click('#botao-sondar');
    await expect(page.locator('#sonda-status')).toContainText('HTTP 200');
  });

  /**
   * T15 do DAS v2.4: clicar em "modo seguro" no console mostra o que mudou.
   *
   * O painel e visibilidade pura, e o teste cobre os dois lados: escondido no
   * vuln e aparecendo no safe. Um painel que aparecesse no vuln ensinaria que
   * as protecoes existem desligadas, o que e falso.
   */
  test('o painel de mitigacoes so aparece no modo seguro', async ({ page }) => {
    await page.goto('/palco');

    await expect(page.locator('#painel-mitigacoes')).toBeHidden();

    await page.locator('#palco-modo-controle .modo-opcao[data-modo="safe"]').click();
    await expect(page.locator('#painel-mitigacoes')).toBeVisible();

    // Os quatro correlatos do DAS: prepared statement, erro generico, saida de
    // texto e HttpOnly. Cada um precisa apontar um arquivo do repositorio --
    // a promessa de mitigacao so vale se o codigo que a implementa existe.
    await expect(page.locator('#lista-mitigacoes .mitigacao')).toHaveCount(4);
    await expect(page.locator('#lista-mitigacoes')).toContainText('Prepared statement');
    await expect(page.locator('#lista-mitigacoes')).toContainText('Erro generico');
    await expect(page.locator('#lista-mitigacoes')).toContainText('innerHTML');
    await expect(page.locator('#lista-mitigacoes')).toContainText('HttpOnly');
    await expect(page.locator('#lista-mitigacoes')).toContainText('src/middleware/mode.js');

    await page.locator('#palco-modo-controle .modo-opcao[data-modo="vuln"]').click();
    await expect(page.locator('#painel-mitigacoes')).toBeHidden();
  });

  /**
   * T16 do DAS v2.4: o botao de retorno leva a pagina exata do topico.
   *
   * E a URL ABSOLUTA que o teste verifica. Na implantacao por portas, a mesma
   * rota corresponde a uma bancada diferente em cada porta, e a URL absoluta e
   * o que torna o erro de mesa visivel antes do clique.
   */
  test('o botao de retorno aponta para a pagina exata de cada cenario', async ({ page }) => {
    await page.goto('/palco');
    const origem = new URL(page.url()).origin;

    const esperado = {
      uniao: '/finbank/agencias',
      erro: '/finbank/extrato?id_conta=98765',
      oraculo: '/finbank/noticia?id=5',
      xss: '/cheflab/receita',
      perfil: '/finbank/perfil?id_cliente=CLI001',
    };

    for (const [id, caminho] of Object.entries(esperado)) {
      await page.selectOption('#seletor-cenario', id);
      await expect(page.locator('#alvo-ativo')).toHaveAttribute('href', `${origem}${caminho}`);
    }
  });

  test('o botao de retorno leva a uma pagina que abre com o estado esperado', async ({ page }) => {
    await page.goto('/palco');
    await page.selectOption('#seletor-cenario', 'erro');

    // Nao basta a URL estar certa: ela precisa abrir a tela que o roteiro
    // promete. Aqui o `id_conta` da URL e lido pela pagina, e e por isso que
    // extrato.html o consulta.
    await page.locator('#alvo-ativo').click();

    await expect(page).toHaveURL(`${new URL(page.url()).origin}/finbank/extrato?id_conta=98765`);
    await expect(page.locator('#extrato-conta')).toHaveText('98765');
    await expect(page.locator('#resumo')).toContainText('98765');
  });

  test('o console mostra qual bancada esta em controle', async ({ page }) => {
    await page.goto('/palco');

    // O par aluno + origem e o que impede um reset na mesa errada: as treze
    // bancadas respondem nas mesmas rotas.
    await expect(page.locator('#palco-contexto')).toContainText('aluno');
    await expect(page.locator('#palco-contexto')).toContainText(new URL(page.url()).origin);
  });
});
