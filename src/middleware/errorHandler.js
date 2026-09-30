/**
 * Tratamento de erros e 404 (DAS v2.2, secoes 4.2 e 8).
 *
 * Modo vuln: expoe o detalhe do MySQL (err.sqlMessage / err.sql / err.code)
 *            para a demonstracao didatica de SQLi baseada em erro.
 * Modo safe: registra o erro apenas no log interno do servidor e responde
 *            com mensagem generica, sem nenhum detalhe do banco.
 */
import { LAB_MODE_SAFE } from './mode.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ erro: 'Rota nao encontrada.' });
}

/**
 * Erros de ENTRADA, com o status e a mensagem que fazem sentido para cada um.
 *
 * Nenhum destes e erro de banco: nenhuma consulta chegou a ser executada, e
 * portanto nao existe detalhe de SQL para revelar -- nem no modo vulneravel.
 * O que eles medem e o corpo da requisicao, e por isso que o DAS manda usar
 * "erro generico" (secao 8) sem que isso precise virar 500.
 *
 * A chave e o `err.type` que o body-parser do Express 5 atribui. O status do
 * objeto http-errors e generico demais para ser a fonte da verdade: o
 * `entity.parse.failed` e 400, o `entity.too.large` e 413, e so o type diz
 * QUAL dos dois aconteceu.
 */
const ERROS_DE_ENTRADA = {
  'entity.parse.failed': [400, 'Corpo JSON invalido.'],
  'entity.too.large': [413, 'Corpo da requisicao maior que o limite de 16kb.'],
  'encoding.unsupported': [415, 'Codificacao de conteudo nao suportada.'],
  'charset.unsupported': [415, 'Charset do corpo nao suportado.'],
  'request.aborted': [400, 'Requisicao abortada antes de ser lida.'],
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const labMode = req.labMode;

  /**
   * O stack entra no log em ambos os modos. O log interno e o unico lugar onde
   * o detalhe da falha pode aparecer com profundidade: durante uma apresentacao
   * a mensagem sozinha costuma ser insuficiente para diagnosticar o que quebrou,
   * e no modo safe o cliente recebe 500 generico justamente porque este log e a
   * unica fonte de verdade.
   */
  console.error(
    `[lab] erro em ${req.method} ${req.originalUrl} (modo=${labMode}):`,
    err.code || err.name,
    '-',
    err.message,
  );
  if (err.stack) {
    console.error(err.stack);
  }

  /**
   * Erro de entrada, e nao de banco: devolve o status que a falha merece, nos
   * dois modos, e SEM o bloco `detalhes`.
   *
   * Isto e consequencia direta do DAS secao 8 ("erro generico"), e nao uma
   * exigencia extra: antes desta distincao, um corpo maior que 16kb -- o
   * `limit` do express.json em src/app.js -- caia no ramo de banco e voltava
   * como HTTP 500, no modo seguro, ou como HTTP 500 com `detalhes.sqlMessage`
   * preenchido pela mensagem do body-parser, no modo vulneravel. O laboratorio
   * chegava a chamar "detalhe do banco" de uma mensagem que nunca teve nada a
   * ver com o banco, o que e o tipo de vazamento que faz a aula mentir.
   */
  const erroDeEntrada = ERROS_DE_ENTRADA[/** @type {string} */ (err.type)];
  if (erroDeEntrada) {
    res.status(erroDeEntrada[0]).json({ erro: erroDeEntrada[1] });
    return;
  }

  /**
   * Qualquer outro 4xx. Um SyntaxError lancado fora do body-parser, por
   * exemplo, chega aqui com `status: 400` e sem `type` reconhecivel.
   */
  const status = Number(
    /** @type {{ status?: number, statusCode?: number }} */ (err).status ??
      /** @type {{ status?: number, statusCode?: number }} */ (err).statusCode,
  );
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ erro: 'Requisicao invalida.' });
    return;
  }

  if (labMode === LAB_MODE_SAFE) {
    res.status(500).json({ erro: 'Erro interno no servidor.' });
    return;
  }

  res.status(500).json({
    erro: 'Erro ao consultar o banco de dados.',
    detalhes: {
      sqlMessage: err.sqlMessage || err.message,
      sql: err.sql || null,
      codigo: err.code || null,
      errno: err.errno || null,
    },
  });
}
