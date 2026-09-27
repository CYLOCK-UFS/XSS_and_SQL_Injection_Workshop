import { Router } from 'express';
import {
  checkDatabase,
  dbConfig,
  runInitScript,
} from '../config/database.js';
import {
  DEFAULT_LAB_MODE,
  isValidLabMode,
  normalizeLabMode,
  setLabModeCookie,
} from '../middleware/mode.js';

const router = Router();

/**
 * Le o modo atual. Extensao ao DAS (secao 3): o frontend precisa do estado
 * para montar o toggle de modo e escolher a renderizacao do ChefLab.
 */
router.get('/mode', (req, res) => {
  res.json({ mode: req.labMode });
});

/**
 * POST /api/mode  { "mode": "vuln" | "safe" }
 * Responde com Set-Cookie. Valor ausente ou invalido segue a regra unica do
 * laboratorio: assume vuln e devolve o modo efetivo.
 */
router.post('/mode', (req, res) => {
  const solicitado = req.body ? req.body.mode : undefined;
  const mode = normalizeLabMode(solicitado);

  setLabModeCookie(res, mode);

  res.json({
    mode,
    solicitado: isValidLabMode(solicitado) ? solicitado : null,
    fallback: !isValidLabMode(solicitado),
    padrao: DEFAULT_LAB_MODE,
  });
});

/**
 * POST /api/reset (DAS, secao 7): restaura o estado inicial completo do
 * laboratorio reexecutando database/init.sql. Disponivel nos dois modos.
 * Rota restrita a ambiente local/laboratorio.
 */
export async function resetLab(req, res) {
  await runInitScript();
  const tabelas = await checkDatabase();
  console.log(`[lab] reset concluido: ${tabelas} tabelas restauradas.`);
  res.status(200).json({
    ok: true,
    message: 'Laboratorio restaurado ao estado inicial.',
    tabelas,
  });
}

router.post('/reset', resetLab);

/**
 * Health check: confirma aplicacao e banco no ar (usado por T01 e T05).
 *
 * Nao propaga a excecao quando o banco esta fora. Um health check que
 * responde 500 nao serve para nada: o HEALTHCHECK do container e o
 * `condition: service_healthy` do compose so conseguem reagir a um `ok`.
 * O erro vai para o log e a resposta carrega `ok: false` com 503, que e o
 * codigo que o Docker espera para marcar o container como unhealthy.
 */
router.get('/health', async (req, res) => {
  try {
    const tabelas = await checkDatabase();
    res.json({
      ok: true,
      mode: req.labMode,
      banco: dbConfig.database,
      tabelas,
    });
  } catch (error) {
    console.error('[lab] health check falhou:', error.code || error.name, '-', error.message);
    res.status(503).json({
      ok: false,
      mode: req.labMode,
      banco: dbConfig.database,
      erro: 'Banco de dados indisponivel.',
    });
  }
});

export default router;
