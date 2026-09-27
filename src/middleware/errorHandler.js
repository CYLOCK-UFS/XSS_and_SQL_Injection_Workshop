/**
 * Tratamento de erros e 404 (DAS v2.2, secoes 4.2 e 8).
 *
 * Modo vuln: expoe o detalhe do MySQL (err.sqlMessage / err.sql / err.code)
 *            para a demonstracao didatica de SQLi baseada em erro.
 * Modo safe: registra o erro apenas no log interno do servidor e responde
 *            com mensagem generica, sem nenhum detalhe do banco.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({ erro: 'Rota nao encontrada.' });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const labMode = req.labMode;

  console.error(
    `[lab] erro em ${req.method} ${req.originalUrl} (modo=${labMode}):`,
    err.code || err.name,
    '-',
    err.message,
  );

  /**
   * Corpo JSON malformado e erro de ENTRADA, nao de banco: nenhuma consulta foi
   * executada, entao nao existe detalhe de SQL para revelar nem para o modo
   * vulneravel. Devolve 400 nos dois modos. O valor de mode invalido (ex.:
   * {"mode":"banana"}) nao cai aqui: esse e tratado por normalizeLabMode, que
   * assume o modo padrao do laboratorio.
   */
  const erroDeEntrada =
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && err.status === 400);

  if (erroDeEntrada) {
    res.status(400).json({ erro: 'Corpo JSON invalido.' });
    return;
  }

  if (labMode === 'safe') {
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
