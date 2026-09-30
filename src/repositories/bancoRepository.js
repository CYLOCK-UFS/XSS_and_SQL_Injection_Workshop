import { aguardarResetEmAndamento, pool } from '../config/database.js';
import { LAB_MODE_VULN } from '../middleware/mode.js';

/**
 * FinBank - cenarios de SQL Injection (DAS v2.2, secao 4).
 *
 * Cada funcao recebe { labMode } e devolve DUAS implementacoes:
 *   * modo vuln -> concatenacao de texto (query() / protocolo de texto);
 *   * modo safe -> prepared statement (execute()) com placeholder.
 *
 * Os nomes das tabelas e colunas seguem o dicionario da secao 5 do DAS.
 */

/** 4 colunas = oraculo do cenario UNION. */
const AGENCIAS_COLUNAS = 'nome_agencia, endereco, telefone, gerente';
const AGENCIAS_SQL = `SELECT ${AGENCIAS_COLUNAS} FROM agencias`;

/**
 * O executor de SQL entra por parametro, com o pool como padrao.
 *
 * Em producao ninguem passa nada: todas as rotas chamam `listarAgencias(cidade,
 * { labMode })` e recebem o pool. A razao do parametro e permitir que
 * tests/unit/bancoRepository.test.js injete um executor falso e verifique a
 * parte que
 * importa para a aula -- que o modo vuln monta texto e o modo safe usa
 * placeholder -- sem subir MySQL, sem seed e sem depender da rede.
 *
 * E o mesmo executor para os dois cenarios de proposito: um duplo que so
 * imitasse o caminho seguro deixaria a interpolacao passar sem ninguem ver.
 */
const executorPadrao = pool;

const EXTRATO_COLUNAS =
  'id_lancamento, id_conta, descricao, valor, data_lancamento';

const NOTICIA_COLUNAS = 'titulo, conteudo, data_publicacao';

const CIDADES_DISPONIVEIS_SQL =
  'SELECT DISTINCT cidade FROM agencias ORDER BY cidade';

/**
 * Toda LEITURA do laboratorio espera o reset em andamento antes de tocar o banco.
 *
 * O `executor` injetado pelos testes de unidade nao precisa da espera: a
 * espera e sobre o estado do banco, e o duble nao tem estado nenhum. Por isso
 * ela fica aqui, e nao dentro de um wrapper do pool -- que teria de ser
 * furado do mesmo jeito, so que em outro lugar.
 */
async function ler(executor, consultar) {
  await aguardarResetEmAndamento();
  return consultar(executor);
}

/**
 * Cenario 1 - SQLi UNION (DAS 4.1).
 * Payloads previstos (query string da pagina):
 *   ' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito --
 *
 * O `@returns` mantem a camada visivel para o typecheck: sem ele o retorno do
 * mysql2 vira `any` e um `await` esquecido em quem chama passa sem aviso.
 *
 * @returns {Promise<LinhasSql>}
 */
export async function listarAgencias(cidade, { labMode, executor = executorPadrao }) {
  return ler(executor, async (exec) => {
    if (cidade === undefined || cidade === null || cidade === '') {
      const [rows] = await exec.execute(
        `${AGENCIAS_SQL} ORDER BY nome_agencia`,
      );
      return /** @type {LinhasSql} */ (rows);
    }

    if (labMode === LAB_MODE_VULN) {
      const sql = `${AGENCIAS_SQL} WHERE cidade = '${cidade}' ORDER BY nome_agencia`;
      const [rows] = await exec.query(sql);
      return /** @type {LinhasSql} */ (rows);
    }

    const [rows] = await exec.execute(
      `${AGENCIAS_SQL} WHERE cidade = ? ORDER BY nome_agencia`,
      [cidade],
    );
    return /** @type {LinhasSql} */ (rows);
  });
}

/** @returns {Promise<string[]>} */
export async function listarCidades({ executor = executorPadrao } = {}) {
  return ler(executor, async (exec) => {
    const [rows] = await exec.execute(CIDADES_DISPONIVEIS_SQL);
    return /** @type {string[]} */ (
      /** @type {LinhasSql} */ (rows).map((row) => row.cidade)
    );
  });
}

/**
 * Cenario 2 - SQLi baseada em erro (DAS 4.2).
 * Payload previsto (DAS, secao 6):
 *   98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM
 *   administradores WHERE id_admin='1'))) --%20
 *
 * No modo vuln o erro chega ao errorHandler, que expoe err.sqlMessage.
 * No modo safe a query vai parametrizada e o erro vira mensagem generica.
 *
 * @returns {Promise<LinhasSql>}
 */
export async function buscarExtrato(idConta, { labMode, executor = executorPadrao }) {
  return ler(executor, async (exec) => {
    if (labMode === LAB_MODE_VULN) {
      const sql = `SELECT ${EXTRATO_COLUNAS} FROM extratos WHERE id_conta = '${idConta}' ORDER BY data_lancamento`;
      const [rows] = await exec.query(sql);
      return /** @type {LinhasSql} */ (rows);
    }

    const [rows] = await exec.execute(
      `SELECT ${EXTRATO_COLUNAS} FROM extratos WHERE id_conta = ? ORDER BY data_lancamento`,
      [idConta],
    );
    return /** @type {LinhasSql} */ (rows);
  });
}

/**
 * Leitura de apoio do cliente logado (DAS v2.3, secao 4).
 *
 * `GET /banco/cliente/:id` alimenta o cartao de conta do autoatendimento. Nao
 * existe cenario de injecao aqui, e por isso a funcao NAO recebe `labMode`:
 * so existe uma implementacao, e ela e parametrizada. Nao dar ao script a
 * chance de montar texto com o id seria o mesmo trabalho de novo, sem o
 * exercicio que justifica o risco.
 *
 * O id tem o formato de `clientes.id_cliente` (`CLI001`) e so de leitura: e o
 * numero da conta que o banco mostrou na tela anterior, nunca algo digitado em
 * um campo de busca.
 *
 * @returns {Promise<LinhaSql | null>}
 */
export async function buscarCliente(idCliente, { executor = executorPadrao } = {}) {
  return ler(executor, async (exec) => {
    const [rows] = await exec.execute(
      'SELECT id_cliente, nome, cpf, numero_telefone, saldo_conta FROM clientes WHERE id_cliente = ?',
      [idCliente],
    );
    const linhas = /** @type {LinhasSql} */ (rows);
    return linhas[0] || null;
  });
}

/**
 * Listagem de comunicados do banco (DAS v2.3, secao 4).
 *
 * `GET /banco/comunicados` monta o mural do autoatendimento. E a origem dos
 * links de `/finbank/noticia`: quem clica chega em `/banco/noticia?id=<id>`,
 * que e a rota do cenario 3.
 *
 * A coluna `conteudo` fica de fora de proposito. O mural mostra titulo e data;
 * o texto so aparece na pagina do comunicado, e traz-lo aqui duplicaria o
 * corpo do artigo na resposta sem nenhum ganho na tela.
 *
 * @returns {Promise<LinhasSql>}
 */
export async function listarComunicados({ executor = executorPadrao } = {}) {
  return ler(executor, async (exec) => {
    const [rows] = await exec.execute(
      'SELECT id, titulo, data_publicacao FROM noticias ORDER BY data_publicacao DESC, id DESC',
    );
    return /** @type {LinhasSql} */ (rows);
  });
}

/**
 * Cenario 3 - SQLi inferencial/cega (DAS 4.3).
 * Oraculo: noticia (HTTP 200) versus 404.
 *
 * No modo safe ha validacao complementar alem do prepared statement: apenas
 * identificadores numericos passam, o que impede montar a condicao booleana
 * (`5' AND 1=1 -- `). Retorna null para entrada invalida, sem tocar no banco.
 *
 * Erros de banco sao suprimidos pelo chamador: aqui o unico canal de resposta
 * e o conteudo da noticia.
 *
 * @returns {Promise<LinhaSql | null>}
 */
export async function buscarNoticia(id, { labMode, executor = executorPadrao }) {
  return ler(executor, async (exec) => {
    if (labMode === LAB_MODE_VULN) {
      const sql = `SELECT ${NOTICIA_COLUNAS} FROM noticias WHERE id = '${id}'`;
      const [rows] = await exec.query(sql);
      const linhas = /** @type {LinhasSql} */ (rows);
      return linhas[0] || null;
    }

    if (!/^\d{1,20}$/.test(String(id))) {
      return null;
    }

    const [rows] = await exec.execute(
      `SELECT ${NOTICIA_COLUNAS} FROM noticias WHERE id = ?`,
      [id],
    );
    const linhas = /** @type {LinhasSql} */ (rows);
    return linhas[0] || null;
  });
}
