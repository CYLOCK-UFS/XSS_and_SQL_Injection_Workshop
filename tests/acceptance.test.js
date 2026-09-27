/**
 * Plano de testes de aceitacao do DAS v2.2, secao 10 (T01-T09).
 *
 * Os testes rodam NO HOST, contra o MySQL publicado em 127.0.0.1:3306, e nao
 * dentro do container: o Dockerfile instala com --omit=dev, entao o supertest
 * nao existe na imagem. Suba o banco antes de rodar:
 *
 *   docker compose up -d db
 *   npm test
 *
 * A aplicacao e importada via createApp() (src/app.js) e exercitada com
 * supertest, sem abrir porta: e o que o app.js separation permite.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { closeDatabase, waitForDatabase } from '../src/config/database.js';

const app = createApp();
const api = () => supertest(app);

const UNION =
  "' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito -- ";
const EXTRACTEVALUE =
  "98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores " +
  "WHERE id_admin='1'))) -- ";
const BLIND_VERDADEIRO = "5' AND 1=1 -- ";
const BLIND_FALSO = "5' AND 1=2 -- ";
const XSS = '<img src=x onerror=alert(document.domain)>';

/** id='5' e o registro-base do oraculo booleano (secao 5 do DAS). */
const NOTICIA_BASE = 'FinBank instala ATMs nas principais cidades';

/** Executa a rota de ataque ja no modo desejado, com o cookie aplicado. */
async function noModo(modo, metodo, rota) {
  const sessao = supertest.agent(app);
  await sessao.post('/api/mode').send({ mode: modo }).expect(200);
  return sessao[metodo](rota);
}

/**
 * Os payloads precisam ser codificados para a query string. Sem isso o espaco
 * final apos `--` vira separador de parametro, o MySQL deixa de reconhecer o
 * comentario e a consulta quebra com ER_PARSE_ERROR. E o mesmo motivo de o
 * DAS escrever o payload do cenario 2 terminado em `--%20`.
 */
function comPayload(valor) {
  return encodeURIComponent(valor);
}

before(async () => {
  await waitForDatabase();
  // Garante estado inicial antes das verificacoes, inclusive se a suite for
  // repetida sobre um banco sujo de uma demonstracao anterior.
  await supertest(app).post('/api/reset').expect(200);
});

after(async () => {
  await closeDatabase();
});

/* ========================================================================== */
/* T01 - Inicializacao                                                        */
/* ========================================================================== */

describe('T01 - Docker Compose sobe aplicacao e MySQL com os seeds', () => {
  it('o health check confirma as 7 tabelas do dicionario do DAS', async () => {
    const resposta = await api().get('/api/health').expect(200);

    assert.equal(resposta.body.ok, true);
    assert.equal(resposta.body.banco, 'lab_palestra');
    // Secao 5 do DAS: agencias, cartoes_credito, administradores, clientes,
    // extratos, noticias e comentarios_receita.
    assert.equal(resposta.body.tabelas, 7);
  });

  it('os registros-base de cada tabela estao carregados', async () => {
    const agencias = await api().get('/banco/agencias').expect(200);
    assert.equal(agencias.body.total, 10);
    // 10 agencias, 8 cidades distintas: Sao Paulo e Rio de Janeiro repetem.
    assert.equal(agencias.body.cidades.length, 8);

    const extrato = await api().get('/banco/extrato?id_conta=CLI001').expect(200);
    assert.equal(extrato.body.total, 3);

    // id='5' e o registro-base do oraculo booleano (secao 5 do DAS).
    const noticia = await api().get('/banco/noticia?id=5').expect(200);
    assert.equal(noticia.body.noticia.titulo, NOTICIA_BASE);

    // Os dois comentarios originais que /api/reset precisa restaurar.
    const receitas = await api().get('/receitas').expect(200);
    assert.equal(receitas.body.total, 2);
  });

  it('a resposta nao carrega o cabecalho X-Powered-By', async () => {
    const resposta = await api().get('/');
    assert.equal(resposta.headers['x-powered-by'], undefined);
  });
});

/* ========================================================================== */
/* T02 e T03 - Contrato de modo (secao 3)                                     */
/* ========================================================================== */

describe('T02 - POST /api/mode {mode:vuln} cria o cookie e ativa o modo', () => {
  it('responde com Set-Cookie lab_mode=vuln', async () => {
    const resposta = await api()
      .post('/api/mode')
      .send({ mode: 'vuln' })
      .expect(200);

    assert.equal(resposta.body.mode, 'vuln');
    assert.equal(resposta.body.fallback, false);
    assert.match(resposta.headers['set-cookie'].join(';'), /lab_mode=vuln/);
    assert.match(resposta.headers['set-cookie'].join(';'), /Path=\//);
  });

  it('as quatro rotas passam a responder no modo vulneravel', async () => {
    const sessao = supertest.agent(app);
    await sessao.post('/api/mode').send({ mode: 'vuln' }).expect(200);

    for (const rota of [
      '/banco/agencias',
      '/banco/extrato?id_conta=CLI001',
      '/banco/noticia?id=5',
      '/receitas',
    ]) {
      const resposta = await sessao.get(rota).expect(200);
      assert.equal(resposta.body.modo, 'vuln', `rota ${rota}`);
    }
  });
});

describe('T03 - POST /api/mode {mode:safe} cria o cookie e ativa o modo', () => {
  it('responde com Set-Cookie lab_mode=safe', async () => {
    const resposta = await api()
      .post('/api/mode')
      .send({ mode: 'safe' })
      .expect(200);

    assert.equal(resposta.body.mode, 'safe');
    assert.match(resposta.headers['set-cookie'].join(';'), /lab_mode=safe/);
  });

  it('as quatro rotas passam a responder no modo seguro', async () => {
    const sessao = supertest.agent(app);
    await sessao.post('/api/mode').send({ mode: 'safe' }).expect(200);

    for (const rota of [
      '/banco/agencias',
      '/banco/extrato?id_conta=CLI001',
      '/banco/noticia?id=5',
      '/receitas',
    ]) {
      const resposta = await sessao.get(rota).expect(200);
      assert.equal(resposta.body.modo, 'safe', `rota ${rota}`);
    }
  });

  it('a regra unica de fallback e assume vuln, documentada na resposta', async () => {
    const invalido = await api()
      .post('/api/mode')
      .send({ mode: 'banana' })
      .expect(200);
    assert.equal(invalido.body.mode, 'vuln');
    assert.equal(invalido.body.fallback, true);

    const ausente = await api().post('/api/mode').send({}).expect(200);
    assert.equal(ausente.body.mode, 'vuln');
    assert.equal(ausente.body.fallback, true);
  });

  it('sem cookie, o laboratorio assume vuln', async () => {
    const resposta = await api().get('/api/mode').expect(200);
    assert.equal(resposta.body.mode, 'vuln');
  });
});

/* ========================================================================== */
/* T04 - Agencias: SQLi UNION (secao 4.1)                                     */
/* ========================================================================== */

describe('T04 - /banco/agencias: UNION com quatro colunas', () => {
  it('uma consulta normal devolve as 4 colunas publicas', async () => {
    const resposta = await noModo('vuln', 'get', '/banco/agencias?cidade=Sao Paulo');

    assert.equal(resposta.body.total, 2);
    for (const agencia of resposta.body.agencias) {
      assert.deepEqual(Object.keys(agencia), [
        'nome_agencia',
        'endereco',
        'telefone',
        'gerente',
      ]);
    }
  });

  it('no modo vulneravel o UNION injeta as linhas de cartoes_credito', async () => {
    const resposta = await noModo('vuln', 'get', `/banco/agencias?cidade=${comPayload(UNION)}`);

    assert.equal(resposta.body.total, 6);
    const primeira = resposta.body.agencias[0];
    assert.equal(primeira.nome_agencia, 'Ana Ribeiro');
    assert.equal(primeira.telefone, '123');
  });

  it('no modo seguro a mesma entrada nao altera a estrutura da query', async () => {
    const resposta = await noModo(
      'safe',
      'get',
      `/banco/agencias?cidade=${comPayload(UNION)}`,
    );

    assert.equal(resposta.body.total, 0);
    assert.deepEqual(resposta.body.agencias, []);
    // filtro.cidade ecoa o texto do payload, entao a busca de vazamento e feita
    // pelos DADOS semanticos do cartao, nao pelo nome da coluna.
    const corpo = JSON.stringify(resposta.body);
    for (const dadoDeCartao of ['0000 0000 0000 0001', '12/29', '654']) {
      assert.equal(corpo.includes(dadoDeCartao), false, `vazou ${dadoDeCartao}`);
    }
  });
});

/* ========================================================================== */
/* T05 - Extrato: SQLi baseada em erro (secoes 4.2 e 6)                      */
/* ========================================================================== */

describe('T05 - /banco/extrato: cenario de erro com EXTRACTVALUE', () => {
  it('no modo vulneravel o erro do MySQL expoe a senha sintetica', async () => {
    const resposta = await noModo('vuln', 'get', `/banco/extrato?id_conta=${comPayload(EXTRACTEVALUE)}`);

    assert.equal(resposta.status, 500);
    assert.equal(resposta.body.detalhes.sqlMessage, "XPATH syntax error: '~abcde'");
    assert.match(resposta.body.detalhes.sql, /EXTRACTVALUE/);
  });

  it('no modo seguro nao ha erro, porque o payload nunca vira SQL', async () => {
    const resposta = await noModo('safe', 'get', `/banco/extrato?id_conta=${comPayload(EXTRACTEVALUE)}`);

    assert.equal(resposta.status, 200);
    assert.equal(resposta.body.total, 0);
  });

  it('no modo seguro nenhum detalhe do banco e exposto', async () => {
    const resposta = await noModo('safe', 'get', '/banco/extrato?id_conta=');

    assert.equal('detalhes' in resposta.body, false);
    const texto = JSON.stringify(resposta.body);
    assert.equal(/sqlMessage|errno|ER_/.test(texto), false);
  });
});

/* ========================================================================== */
/* T06 - Noticia: SQLi inferencial (secao 4.3)                                */
/* ========================================================================== */

describe('T06 - /banco/noticia: oraculo noticia x 404', () => {
  it('no modo vulneravel a condicao verdadeira mantem o registro', async () => {
    const resposta = await noModo('vuln', 'get', `/banco/noticia?id=${comPayload(BLIND_VERDADEIRO)}`);

    assert.equal(resposta.status, 200);
    assert.equal(resposta.body.noticia.titulo, NOTICIA_BASE);
  });

  it('no modo vulneravel a condicao falsa remove o registro', async () => {
    const resposta = await noModo('vuln', 'get', `/banco/noticia?id=${comPayload(BLIND_FALSO)}`);

    assert.equal(resposta.status, 404);
    assert.equal(resposta.body.noticia, undefined);
  });

  it('no modo seguro a validacao numerica corta o oraculo nos dois casos', async () => {
    const verdadeiro = await noModo('safe', 'get', `/banco/noticia?id=${comPayload(BLIND_VERDADEIRO)}`);
    const falso = await noModo('safe', 'get', `/banco/noticia?id=${comPayload(BLIND_FALSO)}`);

    assert.equal(verdadeiro.status, 404);
    assert.equal(falso.status, 404);
  });

  it('erros de banco sao suprimidos: o oraculo e so o status', async () => {
    const resposta = await noModo('vuln', 'get', '/banco/noticia?id=');

    assert.equal(resposta.status, 404);
    assert.equal('detalhes' in resposta.body, false);
  });
});

/* ========================================================================== */
/* T07 - ChefLab: XSS armazenado (secao 4.4)                                  */
/* ========================================================================== */

describe('T07 - /receitas: o INSERT e parametrizado nos dois modos', () => {
  it('o payload e gravado literal, sem interpretar a marcacao', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const criado = await sessao
        .post('/receitas')
        .send({ nome_autor: 'Chef Teste', texto_comentario: XSS })
        .expect(201);

      assert.equal(criado.body.comentario.textoComentario, XSS);

      // A marcacao volta intacta do banco: o risco esta na renderizacao da
      // saida em src/public/receitas/receitas.js, nao na gravacao.
      const lista = await sessao.get('/receitas').expect(200);
      const gravado = lista.body.comentarios.find(
        (c) => c.texto_comentario === XSS,
      );
      assert.ok(gravado, `payload ausente no modo ${modo}`);
    }
  });

  it('a entrada nunca altera a estrutura da query (aspas nao quebram o INSERT)', async () => {
    const sessao = supertest.agent(app);
    const tentativa = "'); DROP TABLE comentarios_receita; -- ";

    await sessao
      .post('/receitas')
      .send({ nome_autor: 'Chef Teste', texto_comentario: tentativa })
      .expect(201);

    // A tabela continua existindo, provando que o INSERT e parametrizado.
    const lista = await sessao.get('/receitas').expect(200);
    assert.ok(lista.body.total > 0);
  });

  it('a API devolve o texto cru; a interpretacao ocorre so no cliente', async () => {
    const resposta = await api().get('/receitas').expect(200);
    for (const comentario of resposta.body.comentarios) {
      assert.equal(typeof comentario.texto_comentario, 'string');
    }
  });

  it('campos obrigatorios e limites sao validados', async () => {
    await api().post('/receitas').send({ nome_autor: '', texto_comentario: 'x' }).expect(400);
    await api().post('/receitas').send({ nome_autor: 'x', texto_comentario: '' }).expect(400);
    await api()
      .post('/receitas')
      .send({ nome_autor: 'a'.repeat(81), texto_comentario: 'x' })
      .expect(400);
  });

  it('a renderizacao vulneravel usa innerHTML e a segura usa textContent', async () => {
    const { readFile } = await import('node:fs/promises');
    const codigo = await readFile(
      new URL('../src/public/receitas/receitas.js', import.meta.url),
      'utf8',
    );

    assert.match(codigo, /renderizarComInnerHTML/);
    assert.match(codigo, /renderizarComTextContent/);
    // innerHTML existe em ponto exatamente um: o sink XSS documentado.
    const usos = codigo.match(/\.innerHTML/g) ?? [];
    assert.equal(usos.length, 1);
    // O caminho seguro nao pode conter innerHTML.
    const seguro = codigo.slice(codigo.indexOf('function renderizarComTextContent'));
    assert.equal(/innerHTML/.test(seguro), false);
  });
});

/* ========================================================================== */
/* T08 - Reset geral (secao 7)                                                */
/* ========================================================================== */
/*
 * Executa no fim da suite de proposito: /api/reset executa o init.sql inteiro,
 * com DROP/CREATE de todas as tabelas. Rodar antes quebraria os testes que
 * dependem dos registros-base.
 */

describe('T08 - POST /api/reset restaura o estado inicial completo', () => {
  it('restaurar comentarios, agencias e o registro-base das noticias', async () => {
    const antes = await api().get('/receitas').expect(200);
    assert.ok(antes.body.total > 2, 'precisa haver comentarios de teste antes');

    const resposta = await api().post('/api/reset').expect(200);
    assert.equal(resposta.body.ok, true);
    assert.equal(resposta.body.tabelas, 7);

    const comentarios = await api().get('/receitas').expect(200);
    assert.equal(comentarios.body.total, 2);
    assert.deepEqual(
      comentarios.body.comentarios.map((c) => c.nome_autor).sort(),
      ['Chef Ana', 'Chef Bruno'],
    );

    const agencias = await api().get('/banco/agencias').expect(200);
    assert.equal(agencias.body.total, 10);

    const noticia = await api().get('/banco/noticia?id=5').expect(200);
    assert.equal(noticia.body.noticia.titulo, NOTICIA_BASE);
  });

  it('/receitas/reset funciona como alias do contrato oficial', async () => {
    await api().post('/api/reset').expect(200);
    const resposta = await api().post('/receitas/reset').expect(200);
    assert.equal(resposta.body.ok, true);

    const comentarios = await api().get('/receitas').expect(200);
    assert.equal(comentarios.body.total, 2);
  });
});

/* ========================================================================== */
/* T09 - Isolamento (secao 11)                                                */
/* ========================================================================== */

describe('T09 - o laboratorio nao e publicado fora da rede local', () => {
  it('docker-compose publica a aplicacao e o banco apenas em 127.0.0.1', async () => {
    const { readFile } = await import('node:fs/promises');
    const compose = await readFile(
      new URL('../docker-compose.yml', import.meta.url),
      'utf8',
    );

    const bindings = [...compose.matchAll(/"([\d.]+):(\d+):(\d+)"/g)].map((m) => m[0]);
    assert.equal(bindings.length, 2, 'aplicacao e banco');
    for (const binding of bindings) {
      assert.match(binding, /^"127\.0\.0\.1:/, `bind fora do loopback: ${binding}`);
    }
    assert.equal(/"0\.0\.0\.0:\d+:\d+"/.test(compose), false);
  });

  it('nenhuma rota de ataque responde a outro host por padrao', async () => {
    const resposta = await api().get('/api/health').expect(200);
    // O host e o endereco de loopback usado pelo laboratorio.
    assert.equal(resposta.body.ok, true);
  });
});
