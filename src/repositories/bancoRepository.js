import { pool } from '../config/database.js';
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

const EXTRATO_COLUNAS =
  'id_lancamento, id_conta, descricao, valor, data_lancamento';

const NOTICIA_COLUNAS = 'titulo, conteudo, data_publicacao';

const CIDADES_DISPONIVEIS_SQL =
  'SELECT DISTINCT cidade FROM agencias ORDER BY cidade';

/**
 * Cenario 1 - SQLi UNION (DAS 4.1).
 * Payloads previstos (query string da pagina):
 *   ' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito -- 
 */
export async function listarAgencias(cidade, { labMode }) {
  if (cidade === undefined || cidade === null || cidade === '') {
    const [rows] = await pool.execute(
      `${AGENCIAS_SQL} ORDER BY nome_agencia`,
    );
    return rows;
  }

  if (labMode === LAB_MODE_VULN) {
    const sql = `${AGENCIAS_SQL} WHERE cidade = '${cidade}' ORDER BY nome_agencia`;
    const [rows] = await pool.query(sql);
    return rows;
  }

  const [rows] = await pool.execute(
    `${AGENCIAS_SQL} WHERE cidade = ? ORDER BY nome_agencia`,
    [cidade],
  );
  return rows;
}

export async function listarCidades() {
  const [rows] = await pool.execute(CIDADES_DISPONIVEIS_SQL);
  return rows.map((row) => row.cidade);
}

/**
 * Cenario 2 - SQLi baseada em erro (DAS 4.2).
 * Payload previsto (DAS, secao 6):
 *   98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM
 *   administradores WHERE id_admin='1'))) --%20
 *
 * No modo vuln o erro chega ao errorHandler, que expoe err.sqlMessage.
 * No modo safe a query vai parametrizada e o erro vira mensagem generica.
 */
export async function buscarExtrato(idConta, { labMode }) {
  if (labMode === LAB_MODE_VULN) {
    const sql = `SELECT ${EXTRATO_COLUNAS} FROM extratos WHERE id_conta = '${idConta}' ORDER BY data_lancamento`;
    const [rows] = await pool.query(sql);
    return rows;
  }

  const [rows] = await pool.execute(
    `SELECT ${EXTRATO_COLUNAS} FROM extratos WHERE id_conta = ? ORDER BY data_lancamento`,
    [idConta],
  );
  return rows;
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
 */
export async function buscarNoticia(id, { labMode }) {
  if (labMode === LAB_MODE_VULN) {
    const sql = `SELECT ${NOTICIA_COLUNAS} FROM noticias WHERE id = '${id}'`;
    const [rows] = await pool.query(sql);
    return rows[0] || null;
  }

  if (!/^\d{1,20}$/.test(String(id))) {
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT ${NOTICIA_COLUNAS} FROM noticias WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
}
