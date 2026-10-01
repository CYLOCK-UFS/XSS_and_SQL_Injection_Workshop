import { expect, test } from '@playwright/test';

/**
 * Geometria da interface.
 *
 * A suite `estrutura.spec.js` prova que os elementos ESTAO la; esta prova que
 * eles estao no lugar certo. A separacao existe porque o tipo de bug que o
 * primeiro arquivo nao enxerga e o mais chato de apresentar: a barra do
 * laboratorio com `position: relative` em vez de `sticky` responde 200, traz o
 * texto certo, passa em toda verificacao de conteudo -- e some da tela no
 * primeiro scroll, levando junto a unica leitura do modo que existe fora do app.
 *
 * Foi assim que o bug entrou: a suite inteira estava verde com as sete telas do
 * app sem nenhum elemento grudado. Nenhuma das 61 verificacoes olhava para
 * `position`, `scrollWidth` ou largura de viewport.
 *
 * Por que NAO usar `toHaveScreenshot`: a rasterizacao de fonte muda entre
 * maquinas e entre versoes de navegador, e o snapshot vira um falso-negativo
 * permanente -- a suite falha por causa do projeto de quem roda, nao do codigo.
 * Medicao e deterministica e custa um milissegundo.
 */

/** Altura da barra, em px: a mesma constante que lab.css usa no `top:` do app. */
const ALTURA_BARRA = 34;

/**
 * As sete telas de app, que compartilham barra do laboratorio + cabecalho.
 * `/` e `/palco` ficam de fora de proposito: sao ferramentas e nao tem barra.
 */
const PAGINAS_DE_APP = [
  '/finbank',
  '/finbank/agencias',
  '/finbank/extrato',
  '/finbank/comunicados',
  '/finbank/noticia',
  '/cheflab',
  '/cheflab/receita',
];

/** Todas as telas da oficina, para o teste de estouro horizontal. */
const TODAS = [...PAGINAS_DE_APP, '/palco', '/'];

test.beforeEach(async ({ request }) => {
  await request.post('/api/reset');
  await request.post('/api/mode', { data: { mode: 'vuln' } });
});

test.describe('a barra do laboratorio e o cabecalho do app grudam', () => {
  for (const rota of PAGINAS_DE_APP) {
    test(`${rota} mantem os dois cabecalhos grudados`, async ({ page }) => {
      await page.goto(rota);

      await expect(page.locator('.barra')).toHaveCSS('position', 'sticky');
      await expect(page.locator('.fb-topo, .cl-topo')).toHaveCSS(
        'position',
        'sticky',
      );

      // A barra precisa pintar ACIMA do cabecalho do app: os dois sao sticky e
      // se empilhassem na ordem errada, o app cobriria a faixa do modo.
      const z = await page.evaluate(() => {
        const numero = (sel) => {
          const el = document.querySelector(sel);
          return el ? Number(getComputedStyle(el).zIndex) : -1;
        };
        return { barra: numero('.barra'), app: numero('.fb-topo, .cl-topo') };
      });
      expect(z.barra).toBeGreaterThan(z.app);
    });
  }
});

test.describe('rolando, nada some e nada se sobrepoe', () => {
  /**
   * Verificacao comportamental, e nao de estilo: `position: sticky` declarado e
   * barra rolando para fora sao o mesmo defeito, so que um passa e o outro nao.
   * Aqui a barra e medida DEPOIS do scroll, na posicao em que o aluno a ve.
   *
   * A viewport e baixa de proposito. A altura destas telas depende do que esta
   * no banco, e o `reset` do beforeEach limpa tudo: o mesmo teste passou na
   * suite completa e falhou isolado, porque antes dele outros testes ja tinham
   * populado dados. Com 480px de altura qualquer tela rola, com ou sem conteudo,
   * e o teste volta a depender so do CSS.
   */
  test.use({ viewport: { width: 1280, height: 480 } });

  const ALTAS = ['/finbank/extrato', '/cheflab/receita'];

  for (const rota of ALTAS) {
    test(`${rota} mantem a faixa do modo visivel apos o scroll`, async ({
      page,
    }) => {
      await page.goto(rota);

      // Precondicao: a tela precisa ter o que rolar. Comparado com a altura da
      // janela, e nao com um numero fixo, porque a quanto a pagina encolhe
      // depende da viewport -- e o que importa e haver scroll disponivel.
      const folga = await page.evaluate(
        () =>
          document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(
        folga,
        `${rota} ficou curta demais para testar scroll; use outra tela`,
      ).toBeGreaterThan(80);

      // Rola ate o fim: e onde o sticky esta sob maior pressao, e garante que
      // a rolagem aconteceu de verdade mesmo com folga pequena.
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForTimeout(200);

      const r = await page.evaluate(() => {
        const barra = document.querySelector('.barra');
        const app = document.querySelector('.fb-topo, .cl-topo');
        const b = barra.getBoundingClientRect();
        const a = app.getBoundingClientRect();
        return {
          scrollY: Math.round(window.scrollY),
          barraTopo: Math.round(b.top),
          barraBase: Math.round(b.bottom),
          appTopo: Math.round(a.top),
        };
      });

      // A rolagem aconteceu de verdade: sem isto, uma pagina sem scroll
      // "confirmaria" um sticky que nunca foi exercitado.
      expect(r.scrollY).toBeGreaterThan(0);
      // A faixa do modo continua colada no topo da janela...
      expect(r.barraTopo).toBe(0);
      // ...e o cabecalho do app encosta nela, sem faixa vazia no meio.
      expect(r.appTopo).toBe(r.barraBase);
    });
  }
});

test.describe('nenhuma tela estoura a largura da janela', () => {
  /**
   * 360px e a largura do celular mais estreito em uso. O overflow horizontal
   * nao quebra nenhuma verificacao de conteudo: a pagina rola para o lado, o
   * texto continua la, e o efeito no projetor e a tela inteira parecer torta.
   */
  for (const largura of [390, 360]) {
    test.describe(`em ${largura}px`, () => {
      test.use({ viewport: { width: largura, height: 844 } });

      for (const rota of TODAS) {
        test(`${rota} cabe na janela`, async ({ page }) => {
          await page.goto(rota);

          const excesso = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          );
          expect(excesso, `${rota} estourou ${excesso}px`).toBe(0);
        });
      }

      /**
       * A causa medida do estouro: o cluster de acoes da barra media 348px
       * contra 350px uteis, e com o nome da oficina e o nome do app ele pedia
       * 522px. Checar o cluster e o que impede a barra de voltar a estourar
       * depois de alguem acrescentar mais um botao nela.
       */
      test('o cluster de acoes da barra cabe dentro da barra', async ({
        page,
      }) => {
        await page.goto('/finbank');

        const medida = await page.evaluate(() => {
          const interno = document.querySelector('.barra__interno');
          const acoes = document.querySelector('.barra__acoes');
          if (!interno || !acoes) return null;

          const cs = getComputedStyle(interno);
          const uteis =
            interno.getBoundingClientRect().width -
            parseFloat(cs.paddingLeft) -
            parseFloat(cs.paddingRight);

          return {
            acoes: acoes.getBoundingClientRect().width,
            uteis,
          };
        });

        expect(medida).not.toBeNull();
        expect(medida.acoes).toBeLessThanOrEqual(medida.uteis);
      });
    });
  }
});

test.describe('as ferramentas nao ganham cabecalho de app', () => {
  for (const rota of ['/', '/palco']) {
    test(`${rota} nao tem barra nem cabecalho grudado`, async ({ page }) => {
      await page.goto(rota);

      // Se um dia a barra entrar aqui, o lancador e o console ganham uma
      // camada que eles nao pedem -- e o /palco ainda precisa de tela cheia.
      await expect(page.locator('.barra')).toHaveCount(0);
      await expect(page.locator('.fb-topo, .cl-topo')).toHaveCount(0);
    });
  }
});

test('a altura da barra bate com a constante do cabecalho', async ({
  page,
}) => {
  await page.goto('/finbank');

  const altura = await page.evaluate(
    () => document.querySelector('.barra').getBoundingClientRect().height,
  );

  // Se --lab-barra-altura mudar sem atualizar o `top:` do app, sobra uma faixa
  // vazia (ou o app cobre a barra). O numero esta repetido aqui de proposito.
  expect(Math.round(altura)).toBe(ALTURA_BARRA);
});

/**
 * Pares de blocos que precisam de respiro entre si.
 *
 * As tres measured 0px antes de qualquer margem: as bordas de 1px ficavam
 * vizinhas e a tela lia como um bloco so -- o aviso de ambiente grudado nos
 * cartoes do lancador, o paragrafo de introducao grudado no cartao que abre a
 * receita, o modo de preparo grudado nos comentarios.
 *
 * Nenhuma delas quebrava nada: nenhum elemento se sobrepunha, nenhuma
 * verificacao de conteudo reclamava, o scroll horizontal continuava em zero.
 * Erro de ritmo, nao de posicionamento -- e por isso que a suite precisa
 * perguntar "quanto espaco tem entre estes dois blocos", e nao apenas "eles
 * existem".
 */
const ZONAS_COM_FOLGA = [
  {
    rota: '/',
    acima: '.oficina-aviso',
    abaixo: '.oficina-grade',
    nota: 'o aviso de ambiente vem antes no DOM; o rodape tambem usa esta classe',
  },
  {
    rota: '/cheflab',
    acima: '.cl-legenda',
    abaixo: '.cl-cartao',
    nota: 'o cartao inteiro e o link que abre a receita',
  },
  {
    rota: '/cheflab/receita',
    acima: '.cl-corpo',
    abaixo: '.cl-bloco',
    nota: 'o bloco de comentarios fecha a receita',
  },
];

for (const zona of ZONAS_COM_FOLGA) {
  test(`${zona.rota}: ${zona.abaixo} nao encosta em ${zona.acima}`, async ({
    page,
  }) => {
    await page.goto(zona.rota);

    const folga = await page.evaluate(
      ([acima, abaixo]) => {
        const a = document.querySelector(acima).getBoundingClientRect();
        const b = document.querySelector(abaixo).getBoundingClientRect();
        return Math.round(b.top - a.bottom);
      },
      [zona.acima, zona.abaixo],
    );

    // O piso e --e-4 (16px), e nao o valor usado no CSS (--e-6), para a margem
    // poder ser ajustada depois sem quebrar o teste -- mas nunca voltar a zero.
    expect(folga, `${zona.rota} colou ${zona.abaixo} em ${zona.acima}`).toBeGreaterThanOrEqual(
      16,
    );
  });
}
