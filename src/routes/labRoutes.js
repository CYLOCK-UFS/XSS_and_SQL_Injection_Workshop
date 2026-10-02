import { Router } from 'express';
import {
  checkDatabase,
  dbConfig,
  runInitScript,
} from '../config/database.js';
import {
  DEFAULT_LAB_MODE,
  LAB_ALUNO_ID,
  isValidLabMode,
  normalizeLabMode,
  setLabModeCookie,
  setLabSessionCookie,
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
 *
 * Emite DOIS cookies (DAS v2.4, secao 9), e o roteiro depende de irem juntos
 * na mesma resposta:
 *
 *   lab_mode     httpOnly: true  SEMPRE
 *   lab_session  httpOnly: false em vuln, true em safe
 *
 * Eles sao a mesma demonstracao em dois sentidos: em `safe`, o `document.cookie`
 * passa a mostrar SO o `lab_mode` -- e o nome dele fica ali justamente para
 * provar que a string nao ficou vazia por acidente, mas porque os cookies
 * HttpOnly nao voltam para o script. Um console vazio ensinaria a coisa errada.
 *
 * O corpo da resposta NAO devolve o valor da sessao, em nenhum dos modos.
 * Devolver seria mostrar a sessao pelo outro caminho no modo seguro, e o
 * aluno nao conseguiria dizer se o que sumiu foi a cookie ou o corpo da
 * resposta. A diferenca precisa estar em um lugar so: `document.cookie`.
 */
router.post('/mode', (req, res) => {
  const solicitado = req.body ? req.body.mode : undefined;
  const mode = normalizeLabMode(solicitado);

  setLabModeCookie(res, mode);
  setLabSessionCookie(res, mode);

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
 *
 * `aluno` e a identidade da bancada (LAB_ALUNO_ID), e responde a exigencia do
 * DAS v2.4 secao 16.3: o console do instrutor precisa deixar explicito qual
 * laboratorio esta sendo controlado. Na implantacao por portas, sao treze
 * stacks independentes e um reset no lugar errado estraga a demonstracao de uma
 * mesa que nao e a do instrutor. E por isso que o campo vem do MESMO valor que
 * monta o cookie `lab_session` -- o que o console mostra na tela e o que o
 * aluno ve no `document.cookie` da propria bancada.
 *
 * `origem` nao entra aqui: o servidor nao sabe por qual URL publica o aluno
 * chegou, e um valor inventado seria pior do que a ausencia dele. Quem mostra a
 * URL completa ao instrutor e o console, que le `location.origin` do lado do
 * navegador.
 */
router.get('/health', async (req, res) => {
  try {
    const tabelas = await checkDatabase();
    res.json({
      ok: true,
      mode: req.labMode,
      aluno: LAB_ALUNO_ID,
      banco: dbConfig.database,
      tabelas,
    });
  } catch (error) {
    console.error('[lab] health check falhou:', error.code || error.name, '-', error.message);
    res.status(503).json({
      ok: false,
      mode: req.labMode,
      aluno: LAB_ALUNO_ID,
      banco: dbConfig.database,
      erro: 'Banco de dados indisponivel.',
    });
  }
});

export default router;
