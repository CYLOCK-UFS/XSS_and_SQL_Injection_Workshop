import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

import { createApp } from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import { LAB_MODE_SAFE, LAB_MODE_VULN } from '../../src/middleware/mode.js';

/**
 * Encaminhamento de erro de rota assincrona (Fase 4d).
 *
 * Este e o item mais silencioso de toda a lista. No Express 4, uma rota
 * `async` que rejeitasse NAO era tratada: a rejeicao virava unhandled
 * rejection, o processo morria ou o cliente ficava pendurado, e o errorHandler
 * -- que existe na propria aplicacao, com todo o trabalho de expor
 * `sqlMessage` no modo vuln -- nunca era chamado. O codigo parecia funcionar e
 * simplesmente nao funcionava.
 *
 * O Express 5 resolveu isso, e a unica forma de saber que a correcao continua
 * no lugar e provocar a rejeicao de verdade: comprobar que a resposta HTTP e a
 * do errorHandler, e nao um 404, um 500 cru ou um socket que nunca fecha.
 *
 * O que este teste impede: alguem mover o `app.use(errorHandler)`, trocar o
 * Express de versao, ou trocar `query()` por `execute()` no cenario 2, e o
 * laboratorio voltar a derrubar conexoes em vez de mostrar o erro do MySQL.
 */

const app = createApp();

/**
 * Executa a rota no modo pedido, pelo mesmo caminho da apresentacao: o cookie
 * `lab_mode` e gravado por `POST /api/mode` e reenviado nas chamadas seguintes.
 *
 * Usar a rota de verdade, e nao um setter interno, e o que torna o teste
 * honesto: ele percorre o mesmo caminho que a plateia percorre, incluindo o
 * middleware que traduz cookie em `req.labMode`. Um atalho que so trocasse o
 * modo por dentro deixaria de testar justamente a parte em que ele se perde.
 */
async function noModo(modo, metodo, caminho) {
  const sessao = supertest.agent(app);
  await sessao.post('/api/mode').send({ mode: modo }).expect(200);
  return sessao[metodo](caminho);
}

/**
 * Normaliza um payload para uso em query string.
 *
 * Sem isso o espaco final apos `--` vira separador de parametro, o MySQL deixa
 * de reconhecer o comentario e a consulta quebra com ER_PARSE_ERROR em vez do
 * XPATH error que o cenario 2 precisa mostrar. E o mesmo motivo de o DAS
 * escrever o payload terminado em `--%20`.
 */
function comPayload(valor) {
  return encodeURIComponent(valor);
}

describe('erro de rota assincrona chega ao errorHandler', () => {
  /**
   * O cenario 2 do DAS: `EXTRACTVALUE` com sintaxe XPath invalida estoura o
   * MySQL. No modo vuln o erro sobe cru e o errorHandler monta o corpo com
   * `sqlMessage`, que e a evidencia mostrada na tela.
   */
  it('modo vuln: a rejeicao vira 500 com o detalhe do MySQL', async () => {
    const resposta = await noModo(
      LAB_MODE_VULN,
      'get',
      `/banco/extrato?id_conta=${comPayload(
        `98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- `,
      )}`,
    );

    assert.equal(resposta.status, 500);
    assert.equal(resposta.body.erro, 'Erro ao consultar o banco de dados.');

    // O detalhe do banco e o que o laboratorio ensina a ler: o erro de XPATH
    // quebrado aparece na resposta e mostra que a consulta chegou ao servidor
    // de banco com sintaxe invalida.
    assert.ok(resposta.body.detalhes, 'o corpo deveria trazer o bloco detalhes');
    assert.equal(typeof resposta.body.detalhes.sqlMessage, 'string');
    assert.match(resposta.body.detalhes.sqlMessage, /XPATH syntax error/);
    assert.ok(resposta.body.detalhes.sql.includes('EXTRACTVALUE'));
  });

  /**
   * O MESMO payload do caso anterior, agora no modo seguro.
   *
   * O resultado e 200 com lista vazia, e nao 500. Isso e mais forte do que
   * "erro generico": o prepared statement nao apenas esconde o erro, ele
   * IMPEDE que o erro exista. O payload deixa de ser sintaxe e vira uma string
   * comparada contra `id_conta` -- nenhuma linha corresponde, a consulta volta
   * vazia e o cenario 2 simplesmente nao existe mais.
   *
   * Uma mitigacao que devolvesse 500 com mensagem generica estaria provando
   * menos: significaria que a entrada ainda distorce a consulta, e que a
   * seguranca vem de nao mostrar a resposta, nao de nao executar o ataque.
   */
  it('modo seguro: o payload deixa de ser sintaxe e a consulta volta vazia', async () => {
    const resposta = await noModo(
      LAB_MODE_SAFE,
      'get',
      `/banco/extrato?id_conta=${comPayload(
        `98765' AND EXTRACTVALUE(1, CONCAT(0x7e, 1)) -- `,
      )}`,
    );

    assert.equal(resposta.status, 200);
    assert.deepEqual(resposta.body.lancamentos, []);
    assert.equal(resposta.body.total, 0);
    assert.equal(resposta.body.modo, LAB_MODE_SAFE);
  });



  /**
   * A rejeicao de uma rota que NAO deixa o erro escapar.
   *
   * `/banco/noticia` engole a falha de proposito, para que o oraculo do cenario
   * 3 seja so 200 ou 404. Olhando apenas o status, um try/catch que deixasse o
   * erro passar nao seria detectado -- aqui a confirmacao e que o oraculo
   * continua exato e que nenhum `detalhes` escapa.
   */
  it('modo vuln: /banco/noticia suprime o erro e mantem o oraculo 404', async () => {
    const resposta = await noModo(
      LAB_MODE_VULN,
      'get',
      `/banco/noticia?id=${comPayload(`'`)}`,
    );

    assert.equal(resposta.status, 404);
    assert.equal(resposta.body.erro, 'Noticia nao encontrada.');
    assert.equal(resposta.body.detalhes, undefined);
    assert.equal(resposta.body.modo, LAB_MODE_VULN);
  });

  it('modo seguro: entrada nao numerica nem chega a consultar o banco', async () => {
    const resposta = await noModo(
      LAB_MODE_SAFE,
      'get',
      `/banco/noticia?id=${comPayload(`1' OR 1=1 -- `)}`,
    );

    // 404 e nao 500: no modo seguro o payload e barrado pela validacao, e o
    // oraculo responde igual para entrada invalida e para id inexistente.
    assert.equal(resposta.status, 404);
    assert.equal(resposta.body.erro, 'Noticia nao encontrada.');
  });

  /**
   * A sanidade do contrario.
   *
   * Se o encaminhamento fosse arrastado demais, uma consulta que funciona
   * cairia no errorHandler e viraria 500. Este teste impede que a correcao do
   * problema acima crie o proximo.
   */
  it('uma requisicao normal nao e tratada como erro', async () => {
    const resposta = await noModo(LAB_MODE_SAFE, 'get', '/banco/noticia?id=1');

    assert.equal(resposta.status, 200);
    assert.ok(resposta.body.noticia);
    assert.equal(resposta.body.detalhes, undefined);
  });
  /**
   * E o coracao deste arquivo: o que o errorHandler responde quando o erro
   * acontece DE VERDADE no modo seguro.
   *
   * Aqui a falha e forcada derrubando o pool, porque no caminho seguro quase
   * nada quebra: a entrada deixa de virar sintaxe. Sem este caso, a alegacao
   * "o modo seguro nao vaza detalhe" ficaria apoiada em um cenario que nunca
   * produz erro -- e um teste que nunca produz erro nao testa nada.
   *
   * Fica no FIM do arquivo de proposito: derrubar o pool estraga a conexao
   * para os casos seguintes.
   */
  it('modo seguro: um erro real vira 500 generico, sem nenhum detalhe', async () => {
    await pool.end();

    const resposta = await noModo(
      LAB_MODE_SAFE,
      'get',
      `/banco/extrato?id_conta=${comPayload('1')}`,
    );

    assert.equal(resposta.status, 500);
    assert.equal(resposta.body.erro, 'Erro interno no servidor.');

    // Nenhuma chave pode aparecer: nem `detalhes`, nem `sql`, nem `sqlMessage`.
    // Um vazamento aqui seria o laboratorio entregando o proprio exercicio.
    assert.equal(resposta.body.detalhes, undefined);
    assert.equal(resposta.body.sql, undefined);
    assert.equal(resposta.body.sqlMessage, undefined);

    const corpo = JSON.stringify(resposta.body);
    assert.equal(corpo.includes('pool'), false);
    assert.equal(corpo.includes('ECONNREFUSED'), false);
  });

  /**
   * O contraponto do caso anterior, e o que fecha a assimetria entre os modos.
   *
   * A supressao de erro de /banco/noticia existe para o ORACULO do cenario 3, e
   * o oraculo e uma propriedade do modo VULNERAVEL: e la que a entrada pode
   * virar sintaxe e transformar um erro de parser em resposta. No modo seguro a
   * entrada nem chega ao SQL -- o id passa por validacao de formato antes da
   * consulta --, entao uma falha ali e infraestrutura: pool esgotado, MySQL fora
   * do ar, bug de verdade.
   *
   * Devolver 404 nesse caso e a pior resposta possivel, porque 404 e
   * exatamente o sinal que o ataque le como "a condicao injetada e falsa". Um
   * MySQL caido durante a apresentacao viraria "o oraculo parou de responder",
   * e ninguem saberia que o problema era o banco.
   *
   * O pool ja foi encerrado pelo caso anterior, que fica antes de proposito.
   */
  it('modo seguro: queda de banco em /banco/noticia vira 500, e nao um 404 mentiroso', async () => {
    const resposta = await noModo(LAB_MODE_SAFE, 'get', '/banco/noticia?id=1');

    assert.equal(resposta.status, 500);
    assert.equal(resposta.body.erro, 'Erro interno no servidor.');
    assert.equal(resposta.body.detalhes, undefined);

    const corpo = JSON.stringify(resposta.body);
    assert.equal(corpo.includes('pool'), false);
    assert.equal(corpo.includes('closed'), false);
  });
});
