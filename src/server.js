import { createApp } from './app.js';
import { closeDatabase, waitForDatabase } from './config/database.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

/**
 * server.close() so encerra as requisicoes em andamento: conexoes keep-alive
 * ficam abertas e o callback nunca dispara. Como o laboratorio e demonstrado
 * com abas de navegador sempre abertas, e o comportamento normal de um
 * `docker compose down` e o processo ficar pendurado, ha um prazo maximo.
 * Passado ele, o encerramento e forcado e o exit code 1 avisa o supervisor.
 */
const PRAZO_SHUTDOWN_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);

await waitForDatabase();

const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`[lab] FinBank & ChefLab em http://${host}:${port}`);
  console.log('[lab] ambiente isolado, dados sinteticos, nao publicar externamente.');
});

let encerrando = false;

/**
 * Encerramento gracioso: para de aceitar conexoes, deixa o que esta em
 * andamento terminar, fecha o pool do MySQL e so entao sai.
 */
async function encerrar(sinal) {
  if (encerrando) {
    return;
  }
  encerrando = true;
  console.log(`[lab] ${sinal} recebido, encerrando...`);

  const forcar = setTimeout(() => {
    console.error(`[lab] encerramento forcado apos ${PRAZO_SHUTDOWN_MS}ms.`);
    process.exit(1);
  }, PRAZO_SHUTDOWN_MS);
  forcar.unref();

  server.close(async (erro) => {
    clearTimeout(forcar);
    if (erro) {
      console.error('[lab] erro ao encerrar o servidor HTTP:', erro.message);
    }
    try {
      await closeDatabase();
    } catch (erroFim) {
      console.error('[lab] erro ao fechar o pool do MySQL:', erroFim.message);
    }
    process.exit(erro ? 1 : 0);
  });

  // Conexoes ociosas nao vao sumir sozinhas; force o fechamento delas.
  server.closeIdleConnections();
}

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    void encerrar(sinal);
  });
}

/**
 * Erro nao tratado e sempre bug. Sem este handler o Node derruba o processo
 * silenciosamente e o log do container mostra apenas a linha do erro, sem
 * qualquer contexto do laboratorio. Fechar o pool antes de sair devolve o
 * MySQL a um estado limpo para a proxima execucao.
 */
for (const evento of ['uncaughtException', 'unhandledRejection']) {
  process.on(evento, (erro) => {
    console.error(`[lab] ${evento} nao tratado:`, erro?.message ?? erro);
    if (erro?.stack) {
      console.error(erro.stack);
    }
    void encerrar(evento).then(() => {
      process.exit(1);
    });
  });
}
