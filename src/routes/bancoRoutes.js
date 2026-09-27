import { Router } from 'express';
import {
  buscarExtrato,
  buscarNoticia,
  listarAgencias,
  listarCidades,
} from '../repositories/bancoRepository.js';

const router = Router();

/**
 * Cenario 1 - SQLi UNION (DAS 4.1).
 * GET /banco/agencias?cidade=<cidade>
 * A query string carrega apenas o parametro do cenario; o modo vem do cookie.
 */
router.get('/agencias', async (req, res) => {
  const cidade = req.query.cidade;
  const agencias = await listarAgencias(cidade, { labMode: req.labMode });
  const cidades = await listarCidades();

  res.json({
    modo: req.labMode,
    filtro: { cidade: cidade ?? '' },
    cidades,
    total: agencias.length,
    agencias,
  });
});

/**
 * Cenario 2 - SQLi baseada em erro (DAS 4.2).
 * GET /banco/extrato?id_conta=<id_conta>
 * No modo vuln o erro do MySQL chega ao cliente; no modo safe, nao.
 */
router.get('/extrato', async (req, res) => {
  const idConta = req.query.id_conta ?? '';
  const lancamentos = await buscarExtrato(idConta, { labMode: req.labMode });

  res.json({
    modo: req.labMode,
    conta: idConta,
    total: lancamentos.length,
    lancamentos,
  });
});

/**
 * Cenario 3 - SQLi inferencial/cega (DAS 4.3).
 * GET /banco/noticia?id=<id>
 * Oraculo: 200 com a noticia ou 404. Erros de banco sao suprimidos nos dois
 * modos para que o conteudo seja o unico canal de resposta.
 */
router.get('/noticia', async (req, res) => {
  const id = req.query.id ?? '';

  let noticia = null;
  try {
    noticia = await buscarNoticia(id, { labMode: req.labMode });
  } catch (error) {
    console.error(
      `[lab] erro suprimido em /banco/noticia (modo=${req.labMode}):`,
      error.code || error.name,
      '-',
      error.message,
    );
  }

  if (!noticia) {
    res.status(404).json({
      modo: req.labMode,
      erro: 'Noticia nao encontrada.',
    });
    return;
  }

  res.json({
    modo: req.labMode,
    noticia,
  });
});

export default router;
