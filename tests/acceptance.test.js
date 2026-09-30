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
import { closeDatabase, pool, waitForDatabase } from '../src/config/database.js';

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

/**
 * Dispara a requisicao e devolve a resposta, sem `await` no meio.
 *
 * O objeto do supertest so comeca a enviar quando alguem chama `then` -- e o
 * `await` do chamador e justamente o que dispara a requisicao. Para provar uma
 * CORRIDA, o reset precisa estar em voo enquanto a proxima requisicao ja
 * parte, e por isso a requisicao e iniciada por `end()` em vez de ser esperada
 * em sequencia.
 */
function disparar(requisicao) {
  return new Promise((resolve, reject) => {
    requisicao.end((erro, resposta) => {
      if (erro) {
        reject(erro);
        return;
      }
      resolve(resposta);
    });
  });
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
/* T01 (continuacao) - O dicionario do DAS, secao 5                           */
/* ========================================================================== */
/*
 * O DAS trata a secao 5 como contrato: "Este dicionario e parte do contrato e
 * deve ser seguido por init.sql, repositories e rotas". Verificar so a
 * quantidade de tabelas nao impede que um rename de coluna, um tipo trocado ou
 * uma coluna nova passem despercebidos. Aqui a comparacao e exata: nome, tipo e
 * ordem de cada coluna, mais a primary key.
 */

/** Dicionario esperado, transcrito da secao 5 do DAS v2.2. */
const DICIONARIO = {
  agencias: {
    pk: 'id_agencia',
    colunas: [
      'id_agencia varchar(20)',
      'nome_agencia varchar(100)',
      'endereco varchar(150)',
      'telefone varchar(30)',
      'gerente varchar(80)',
      'cidade varchar(60)',
    ],
  },
  cartoes_credito: {
    pk: 'id_cartao',
    colunas: [
      'id_cartao varchar(20)',
      'titular varchar(100)',
      'numero_cartao varchar(30)',
      'cvv varchar(10)',
      'validade varchar(15)',
    ],
  },
  administradores: {
    pk: 'id_admin',
    colunas: [
      'id_admin varchar(20)',
      'username varchar(50)',
      'senha_hash varchar(100)',
      'senha varchar(50)',
    ],
  },
  clientes: {
    pk: 'id_cliente',
    colunas: [
      'id_cliente varchar(20)',
      'nome varchar(100)',
      'cpf varchar(20)',
      'numero_telefone varchar(30)',
      'saldo_conta varchar(30)',
    ],
  },
  extratos: {
    pk: 'id_lancamento',
    colunas: [
      'id_lancamento varchar(20)',
      'id_conta varchar(20)',
      'descricao varchar(100)',
      'valor varchar(30)',
      'data_lancamento varchar(20)',
    ],
  },
  noticias: {
    pk: 'id',
    colunas: [
      'id varchar(20)',
      'titulo varchar(150)',
      'conteudo text',
      'data_publicacao varchar(20)',
    ],
  },
  comentarios_receita: {
    pk: 'id_comentario',
    colunas: [
      'id_comentario int',
      'nome_autor varchar(80)',
      'texto_comentario text',
      'data_postagem datetime',
    ],
  },
};

describe('T01 - O dicionario de colunas do DAS coincide com o banco', () => {
  it('cada tabela tem exatamente as colunas e os tipos da secao 5, na ordem', async () => {
    const [tabelas] = await pool.query(
      `SELECT table_name, column_name, column_type, ordinal_position
         FROM information_schema.columns
        WHERE table_schema = ?
        ORDER BY table_name, ordinal_position`,
      ['lab_palestra'],
    );

    const porTabela = new Map();
    for (const linha of tabelas) {
      if (!porTabela.has(linha.TABLE_NAME)) {
        porTabela.set(linha.TABLE_NAME, []);
      }
      porTabela.get(linha.TABLE_NAME).push(
        `${linha.COLUMN_NAME} ${linha.COLUMN_TYPE}`,
      );
    }

    assert.deepEqual(
      [...porTabela.keys()].sort(),
      Object.keys(DICIONARIO).sort(),
      'tabelas do banco divergem do dicionario',
    );

    for (const [tabela, esperado] of Object.entries(DICIONARIO)) {
      assert.deepEqual(porTabela.get(tabela), esperado.colunas, tabela);
    }
  });

  it('a primary key de cada tabela e a coluna do dicionario', async () => {
    const [pks] = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.key_column_usage
        WHERE table_schema = ? AND constraint_name = 'PRIMARY'
        ORDER BY table_name`,
      ['lab_palestra'],
    );

    const porTabela = new Map(pks.map((l) => [l.TABLE_NAME, l.COLUMN_NAME]));
    for (const [tabela, esperado] of Object.entries(DICIONARIO)) {
      assert.equal(porTabela.get(tabela), esperado.pk, `pk de ${tabela}`);
    }
  });

  it('comentarios_receita usa INT, TEXT e DATETIME, nao apenas VARCHAR', async () => {
    // Ponto explicito do DAS: "A tabela comentarios_receita nao e composta
    // apenas por VARCHAR: usa INT, TEXT e DATETIME."
    const [linhas] = await pool.query(
      `SELECT column_name, data_type, extra
         FROM information_schema.columns
        WHERE table_schema = ? AND table_name = 'comentarios_receita'`,
      ['lab_palestra'],
    );

    const porNome = new Map(linhas.map((l) => [l.COLUMN_NAME, l]));

    assert.equal(porNome.get('id_comentario').DATA_TYPE, 'int');
    assert.equal(porNome.get('id_comentario').EXTRA, 'auto_increment');
    assert.equal(porNome.get('texto_comentario').DATA_TYPE, 'text');
    assert.equal(porNome.get('data_postagem').DATA_TYPE, 'datetime');
  });

  it('o dicionario nao diverge dos SELECTs publicos dos repositories', async () => {
    // /banco/agencias precisa devolver 4 colunas (assinatura do UNION) e os
    // nomes precisam existir de fato na tabela.
    const resposta = await noModo('vuln', 'get', '/banco/agencias?cidade=Sao Paulo');
    const colunasPublicas = Object.keys(resposta.body.agencias[0]);

    assert.deepEqual(colunasPublicas, [
      'nome_agencia',
      'endereco',
      'telefone',
      'gerente',
    ]);
    for (const coluna of colunasPublicas) {
      assert.ok(
        DICIONARIO.agencias.colunas.some((c) => c.startsWith(`${coluna} `)),
        `coluna publica ${coluna} fora do dicionario`,
      );
    }
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

  it('a URL nao troca o modo: a query string e reservada ao cenario', async () => {
    // Secao 3 do DAS: "URL das rotas nao contem o modo; query string fica
    // reservada aos parametros do cenario". O modo vem exclusivamente do
    // cookie lab_mode. Estes testes travam a invariante para que ninguem
    // adicione leitura de ?modo= sem quebrar o contrato em silencio.
    const tentativas = 'modo=safe&mode=safe&labMode=safe&lab_mode=safe&vuln=false';

    /** Anexa a query preservando o parametro do cenario que ja existe. */
    const comQuery = (rota) =>
      `${rota}${rota.includes('?') ? '&' : '?'}${tentativas}`;

    const comVuln = supertest.agent(app);
    await comVuln.post('/api/mode').send({ mode: 'vuln' }).expect(200);
    for (const rota of [
      '/banco/agencias?cidade=Sao Paulo',
      '/banco/extrato?id_conta=CLI001',
      '/banco/noticia?id=5',
      '/receitas',
    ]) {
      const resposta = await comVuln.get(comQuery(rota)).expect(200);
      assert.equal(resposta.body.modo, 'vuln', `URL alterou o modo em ${rota}`);
    }

    const comSafe = supertest.agent(app);
    await comSafe.post('/api/mode').send({ mode: 'safe' }).expect(200);
    for (const rota of [
      '/banco/agencias?cidade=Sao Paulo',
      '/banco/extrato?id_conta=CLI001',
      '/banco/noticia?id=5',
      '/receitas',
    ]) {
      const resposta = await comSafe
        .get(`${rota}${rota.includes('?') ? '&' : '?'}modo=vuln&lab_mode=vuln`)
        .expect(200);
      assert.equal(resposta.body.modo, 'safe', `URL alterou o modo em ${rota}`);
    }
  });

  it('a query string nao é lida pelo middleware de modo', async () => {
    // Defence in depth: alem do teste comportamental acima, o proprio
    // middleware nao pode tocar em req.query.
    const { readFile } = await import('node:fs/promises');
    const codigo = await readFile(
      new URL('../src/middleware/mode.js', import.meta.url),
      'utf8',
    );

    assert.equal(/req\.query/.test(codigo), false);
    assert.equal(/req\.params/.test(codigo), false);
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

  it('no modo vulneravel os erros de banco sao suprimidos: o oraculo e so o status', async () => {
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

  it('corpo maior que o limite do servidor volta 413, e nao 500 de banco', async () => {
    /**
     * `express.json({ limit: '16kb' })` em src/app.js e o limite do CORPO, e
     * ele e acionado antes de qualquer validacao de campo: um comentario
     * gigante nem chega ao LIMITE_TEXTO nem ao INSERT, porque o corpo e
     * recusado enquanto ainda esta sendo lido.
     *
     * O que este teste trava e a TRADUCAO do erro. O erro de entrada e medido
     * em bytes, nao em SQL, entao ele nao pode ser respondido como "Erro ao
     * consultar o banco de dados" -- muito menos virando 500 com o bloco
     * `detalhes` no modo vulneravel, que e a unica coisa que aquele bloco
     * deveria conter.
     */
    const gigante = 'a'.repeat(20000);

    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const resposta = await sessao
        .post('/receitas')
        .send({ nome_autor: 'Chef Teste', texto_comentario: gigante });

      assert.equal(resposta.status, 413, `modo ${modo}`);
      assert.equal('detalhes' in resposta.body, false, `modo ${modo} vazou detalhe`);
      assert.match(resposta.body.erro, /16kb/);
    }
  });

  it('JSON malformado volta 400 nos dois modos, tambem sem detalhe', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const resposta = await sessao
        .post('/api/mode')
        .set('Content-Type', 'application/json')
        .send('{"mode":');

      assert.equal(resposta.status, 400, `modo ${modo}`);
      assert.equal('detalhes' in resposta.body, false, `modo ${modo} vazou detalhe`);
      assert.equal(resposta.body.erro, 'Corpo JSON invalido.');
    }
  });

  it('a renderizacao vulneravel usa innerHTML e a segura usa textContent', async () => {
    const { readFile } = await import('node:fs/promises');
    const codigo = await readFile(
      new URL('../src/public/cheflab/receita.js', import.meta.url),
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

/* ========================================================================== */
/* T10 - Robustez do reset e dos parametros de query                          */
/* ========================================================================== */
/*
 * Nao esta no DAS: sao invariantes do proprio laboratorio, sem as quais uma
 * demonstracao ao vivo quebra sem que ninguem tenha feito nada de errado.
 *
 * Este bloco roda depois de T08, que ja deixou o banco no estado inicial.
 */

describe('T10 - o reset e serializado', () => {
  it('dois POST /api/reset simultaneos nao corrompem o banco', async () => {
    // Sem serializacao, dois init.sql concorrentes intercalam DROP TABLE e as
    // consultas em andamento falham com "table doesn't exist". Aqui os dois
    // resets disputam o mesmo estado e ambos precisam devolver 200.
    const [primeiro, segundo] = await Promise.all([
      api().post('/api/reset'),
      api().post('/api/reset'),
    ]);

    assert.equal(primeiro.status, 200);
    assert.equal(segundo.status, 200);
    assert.equal(primeiro.body.ok, true);
    assert.equal(segundo.body.ok, true);

    // Se o estado ficou consistente, as 7 tabelas respondem de novo.
    const health = await api().get('/api/health').expect(200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.tabelas, 7);

    const agencias = await api().get('/banco/agencias').expect(200);
    assert.equal(agencias.body.total, 10);
  });
});

describe('T10 - o reset serializado tambem protege as leituras', () => {
  it('uma leitura que chega no meio do reset nao leva "table doesn\'t exist"', async () => {
    /**
     * Serializar reset contra reset resolve metade do problema. A outra metade e
     * o cruzamento: o init.sql faz `DROP TABLE` antes de `CREATE TABLE`, e uma
     * leitura que entra nessa janela falha com "table doesn't exist" -- no modo
     * vulneravel, como HTTP 500 com o erro do MySQL no corpo, no meio da
     * apresentacao, sem ninguem ter clicado em nada.
     *
     * Por isso a leitura e disparada de proposito, dentro da janela DROP/CREATE,
     * e nao por sorte. Enquanto o DROP ainda nao comecou, information_schema
     * ainda devolve 7 tabelas e qualquer leitura passa trivialmente, sem
     * exercitar a garantia que se quer provar.
     */
    const resetPendente = disparar(api().post('/api/reset'));

    let viuJanela = false;
    for (let tentativa = 0; tentativa < 400 && !viuJanela; tentativa += 1) {
      const health = await api().get('/api/health');
      if (health.body.ok && health.body.tabelas < 7) {
        viuJanela = true;
        break;
      }
      await new Promise((resolver) => setTimeout(resolver, 5));
    }
    assert.equal(
      viuJanela,
      true,
      'o reset terminou antes de abrir a janela DROP/CREATE',
    );

    // Sem a espera em aguardarResetEmAndamento, esta leitura cai entre o DROP e
    // o CREATE e volta 500. Com ela, so volta quando o estado voltou a existir.
    const leitura = await api().get('/banco/agencias?cidade=Sao Paulo');
    assert.equal(leitura.status, 200);
    assert.equal(leitura.body.total, 2);
    assert.equal('detalhes' in leitura.body, false);

    const reset = await resetPendente;
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);
  });
});

describe('T10 - os parametros de query sao lidos como texto', () => {
  /**
   * O Express 5 usa o parser `simple`: um parametro repetido vira array
   * (?cidade=A&cidade=B) e a notacao de colchetes vira a chave literal
   * "cidade[x]", deixando req.query.cidade indefinido.
   *
   * Sem normalizacao o array chega ao repository: no modo vuln a interpolacao
   * vira "WHERE cidade = 'Sao Paulo,Recife'" e no modo safe o placeholder recebe
   * um array. Nos dois casos o resultado e silenciosamente errado e o painel
   * mostra um array no lugar de um filtro de texto.
   */
  const ENTRADAS_NAO_TEXTO = [
    '/banco/agencias?cidade=Sao%20Paulo&cidade=Recife',
    '/banco/agencias?cidade[x]=Sao%20Paulo',
    '/banco/extrato?id_conta=CLI001&id_conta=CLI002',
    '/banco/extrato?id_conta[x]=CLI001',
  ];

  it('nenhuma das formas nao-textuais e ecoada como array ou objeto', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      for (const rota of ENTRADAS_NAO_TEXTO) {
        const resposta = await sessao.get(rota).expect(200);

        const ecoado = rota.startsWith('/banco/agencias')
          ? resposta.body.filtro.cidade
          : resposta.body.conta;

        assert.equal(
          typeof ecoado,
          'string',
          `${rota} ecoou ${typeof ecoado} no modo ${modo}`,
        );
      }
    }
  });

  it('um parametro ausente, repetido ou em colchetes equivale a consulta sem filtro', async () => {
    const semFiltro = await api().get('/banco/agencias').expect(200);
    const comArray = await api().get('/banco/agencias?cidade=A&cidade=B').expect(200);
    const comColchetes = await api().get('/banco/agencias?cidade[x]=A').expect(200);

    assert.equal(semFiltro.body.total, 10);
    assert.equal(comArray.body.total, 10);
    assert.equal(comColchetes.body.total, 10);
    assert.equal(comArray.body.filtro.cidade, '');
    assert.equal(comColchetes.body.filtro.cidade, '');
  });

  /**
   * /banco/noticia nao ecoa o id, entao a forma da entrada nao é observavel
   * pela resposta. O que precisa ser provado aqui e mais fraco: a entrada
   * NAOTextual nao chega ao SQL como texto nao quoting, porque isso estouraria
   * o parser do MySQL e a resposta seria 500 em vez do oraculo 200/404.
   *
   * A prova de que o valor e uma string de fato vem do teste de unidade de
   * buscarNoticia, com executor injetado (tests/unit/bancoRepository.test.js).
   */
  it('em /banco/noticia a entrada nao-textual nao quebra o oraculo 200/404', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      for (const rota of [
        '/banco/noticia?id=5&id=6',
        '/banco/noticia?id[x]=5',
      ]) {
        const resposta = await sessao.get(rota);
        assert.ok(
          resposta.status === 200 || resposta.status === 404,
          `${rota} respondeu ${resposta.status} no modo ${modo}`,
        );
        assert.equal('detalhes' in resposta.body, false);
      }
    }
  });
});

/* ========================================================================== */
/* T11 - Leituras de apoio do autoatendimento (DAS v2.3, secao 4)            */
/* ========================================================================== */
/*
 * As duas rotas que existem para o FinBank parecer um banco: a conta que fica
 * no cabecalho e o mural de comunicados.
 *
 * Nao ha cenario de injecao aqui, e o bloco inteiro existe para travar esse
 * fato. Nao existe versao vulneravel para testar porque nao existe versao
 * vulneravel: as funcoes do repository dessas leituras nao recebem `labMode`, e
 * nao ha caminho que monte texto com o id do cliente ou com o filtro do mural.
 *
 * O teste de unidade correspondente (tests/unit/bancoRepository.test.js) prova o
 * `?` no executor injetado; aqui o que se prova e o contrato HTTP.
 */

describe('T11 - GET /banco/cliente e GET /banco/comunicados', () => {
  it('a conta do cabecalho responde igual nos dois modos', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const resposta = await sessao.get('/banco/cliente/CLI001').expect(200);
      const { cliente } = resposta.body;

      assert.equal(cliente.id_cliente, 'CLI001');
      assert.equal(cliente.nome, 'Ana Ribeiro');
      assert.equal(cliente.cpf, '111.111.111-11');
      assert.equal(cliente.numero_telefone, '(11) 98888-0001');
      assert.equal(cliente.saldo_conta, 'R$ 12.450,00');
      assert.equal('detalhes' in resposta.body, false);
    }
  });

  /**
   * O id vai no caminho, e caminho nao se concatena. Uma aspa no lugar do id
   * tem de dar 404, e nao 500 com detalhe de SQL: o 500 seria justamente a
   * prova de que a entrada chegou ao parser como texto.
   */
  it('id malformado nao vira erro de banco em nenhum dos dois modos', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const ids = ["CLI001' OR '1'='1", 'CLI001\\', '%27', 'CLI999; DROP TABLE clientes'];

      for (const id of ids) {
        const resposta = await sessao.get(`/banco/cliente/${encodeURIComponent(id)}`);
        assert.equal(resposta.status, 404, `id=${id} no modo ${modo}`);
        assert.equal(resposta.body.erro, 'Cliente nao encontrado.');
        assert.equal('detalhes' in resposta.body, false);
      }
    }
  });

  it('o mural devolve o seed inteiro, sem o corpo do comunicado', async () => {
    const resposta = await api().get('/banco/comunicados').expect(200);

    assert.equal(resposta.body.total, 8);
    assert.equal(resposta.body.comunicados.length, 8);

    for (const comunicado of resposta.body.comunicados) {
      // `conteudo` fica de fora de proposito: no mural entram so titulo e data.
      // O texto so aparece na pagina do comunicado, que e o cenario 3.
      assert.deepEqual(Object.keys(comunicado).sort(), [
        'data_publicacao',
        'id',
        'titulo',
      ]);
    }

    // Mais recente primeiro: o init.sql vai de 2024-01-05 a 2024-01-14.
    assert.equal(resposta.body.comunicados[0].id, '8');
    assert.equal(resposta.body.comunicados.at(-1).id, '1');
  });

  /**
   * O mural e a origem dos links de /finbank/noticia. Um id do mural que nao
   * resolve na rota do cenario 3 seria um link quebrado no app -- e o teste
   * acima passaria, porque so olha o JSON.
   */
  it('todo comunicado do mural existe em /banco/noticia', async () => {
    const mural = await api().get('/banco/comunicados').expect(200);

    for (const comunicado of mural.body.comunicados) {
      const noticia = await api().get(`/banco/noticia?id=${comunicado.id}`);
      assert.equal(noticia.status, 200, `id=${comunicado.id}`);
      assert.equal(noticia.body.noticia.titulo, comunicado.titulo);
    }
  });

  it('as duas leituras nao carregam o campo detalhes em nenhum modo', async () => {
    for (const modo of ['vuln', 'safe']) {
      const sessao = supertest.agent(app);
      await sessao.post('/api/mode').send({ mode: modo }).expect(200);

      const cliente = await sessao.get('/banco/cliente/CLI001').expect(200);
      const comunicados = await sessao.get('/banco/comunicados').expect(200);

      assert.equal('detalhes' in cliente.body, false);
      assert.equal('detalhes' in comunicados.body, false);
      // O bloco `modo` pertence aos endpoints de cenario: ele existe para
      // deixar claro que a rota leu o cookie. Estas leituras nao tem cenario,
      // entao nao anunciam modo.
      assert.equal('modo' in cliente.body, false);
    }
  });
});
