import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Verifica se o Chromium empacotado pelo Playwright ja esta no cache.
 *
 * A revisao e lida de playwright-core/browsers.json em vez de fixada no codigo:
 * fixar a revisao transformaria este arquivo em mais um lugar a atualizar a cada
 * upgrade do Playwright, e um erro ali faria o suite cair silenciosamente no
 * navegador do sistema sem ninguem perceber.
 */
function chromiumEmpacotadoDisponivel() {
  try {
    const catalogos = require('playwright-core/browsers.json').browsers;
    const chromium = catalogos.find((navegador) => navegador.name === 'chromium');
    if (!chromium) {
      return false;
    }

    for (const [diretorio, sufixo] of [
      ['chromium', ''],
      ['chromium_headless_shell', ''],
    ]) {
      const alvo = path.join(
        homedir(),
        'AppData',
        'Local',
        'ms-playwright',
        `${diretorio}-${chromium.revision}${sufixo}`,
      );
      if (existsSync(alvo)) {
        return true;
      }
    }
    return false;
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
