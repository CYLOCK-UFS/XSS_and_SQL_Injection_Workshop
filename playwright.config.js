import { chromium, defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Verifica se o Chromium empacotado pelo Playwright ja esta no cache.
 *
 * A pergunta e feita ao proprio Playwright (`chromium.executablePath()`), que
 * resolve o cache correto do sistema -- `%LOCALAPPDATA%\ms-playwright` no
 * Windows, `~/Library/Caches/ms-playwright` no macOS, `~/.cache/ms-playwright`
 * no Linux -- e ja honra `PLAYWRIGHT_BROWSERS_PATH`. A revisao nunca e fixada
 * aqui, entao um upgrade do Playwright nao deixa este arquivo desatualizado.
 *
 * Nao use `require('playwright-core/browsers.json')` para descobrir a revisao:
 * o Playwright moderno fechou os subpaths do pacote, o `require` lanca
 * ERR_PACKAGE_PATH_NOT_EXPORTED e a deteccao responde `false` para sempre --
 * o suite cai calado no navegador do sistema mesmo com o Chromium instalado,
 * que e exatamente a falha que esta funcao existe para evitar.
 */
function chromiumEmpacotadoDisponivel() {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Escolhe o navegador sem travar o suite em maquina nenhuma.
 *
 * O Playwright baixa o Chromium proprio no primeiro `npx playwright install`. Em
 * rede de treinamento isolada -- exatamente o ambiente em que este laboratorio
 * roda, com projetor em Wi-Fi de sala e sem acesso a CDN -- esse download falha,
 * e um `npm run test:e2e` que depende de rede nao pode ser o procedimento de
 * quem esta apresentando.
 *
 * Resolucao em duas etapas:
 *   1. Chromium empacotado, se ja estiver no cache (comportamento padrao);
 *   2. um navegador do sistema, se o empacotado nao estiver.
 *
 * O canal pode ser fixado explicitamente quando houver mais de um instalado:
 *
 *   PLAYWRIGHT_CHANNEL=msedge npm run test:e2e
 */
function resolverCanal() {
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return process.env.PLAYWRIGHT_CHANNEL;
  }
  if (chromiumEmpacotadoDisponivel()) {
    return undefined;
  }
  return process.platform === 'darwin' ? 'chrome' : 'msedge';
}

const canal = resolverCanal();

/**
 * Porta exclusiva do E2E.
 *
 * O container de demonstracao publica a 3000, e ele e o mesmo que o
 * apresentador abre no projetor. Rodar o E2E em 3000 e perigoso de um jeito
 * silencioso: com `reuseExistingServer`, o Playwright encontraria o container
 * no caminho, acharia que o servidor ja estava de pe, e testaria a copia do
 * codigo assada na imagem em vez da arvore de trabalho. Os testes ficariam
 * verdes mesmo depois de uma mudanca que quebrasse o laboratorio, e o
 * `npx playwright install` de alguem na sua maquina nao acusaria nada.
 *
 * Portao separada e `reuseExistingServer: false`: o E2E sobe o servidor a partir
 * do codigo que esta no disco, e falha alto se a porta estiver ocupada.
 */
const PORTA_E2E = Number(process.env.E2E_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORTA_E2E}`;

if (canal) {
  console.log(
    `[e2e] Chromium empacotado ausente; usando o navegador do sistema (${canal}).`,
  );
  console.log('[e2e] Para usar o empacotado, rode: npx playwright install chromium');
}

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * O E2E grava comentarios no mesmo MySQL da suite de aceitacao e chama
   * /api/reset. Rodar em paralelo faria um resetar o banco embaixo do outro,
   * entao nada aqui pode ser paral nem repetir em worker.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(canal ? { channel: canal } : {}) },
    },
  ],

  /**
   * O MySQL ja e publicado em 127.0.0.1:3306 pelo compose, entao o servidor da
   * aplicacao roda direto no host, sem container e sem build de imagem.
   *
   * A URL de espera e o proprio /api/health, e nao a raiz: ele responde 503
   * enquanto o banco nao responde, entao a espera so termina quando a aplicacao
   * esta de fato pronta.
   */
  webServer: {
    command: 'npm start',
    url: `${BASE_URL}/api/health`,
    env: { PORT: String(PORTA_E2E) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
