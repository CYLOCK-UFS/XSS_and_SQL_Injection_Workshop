#!/usr/bin/env node
/**
 * Roda a verificacao inteira do laboratorio com um comando so.
 *
 * O que hoje e manual e cheio de ordem implicita, numa sequencia so:
 *   1. typecheck (rapido, nao precisa de banco);
 *   2. sobe o MySQL do compose, se ainda nao estiver escutando;
 *   3. npm test        -> aceitacao (T01-T10) + unidade, precisa de MySQL;
 *   4. npm run test:e2e -> o Playwright sobe a aplicacao sozinho na porta 3100.
 *
 * O banco fica de pe no fim, para o proximo `npm run test:full` ser rapido.
 * Use --down quando quiser encerrar o compose junto.
 *
 * Nada aqui e especifico de Windows: e um script Node, e o mesmo comando roda
 * no PowerShell, no cmd, no bash e no CI. Este arquivo substitui os .bat/.ps1
 * avulsos que existiam antes (com caminho absoluto e `taskkill` global).
 *
 * Uso:
 *   npm run test:full                 # tudo, deixa o banco de pe
 *   npm run test:full -- --down       # derruba o compose no fim
 *   npm run test:full -- --sem-e2e    # so typecheck + npm test
 *   npm run test:full -- --sem-docker # exige o banco ja no ar
 *
 * Flags:
 *   --down           docker compose down no fim (mesmo se algo falhar)
 *   --sem-docker     nao toca no Docker; falha se o banco nao responder
 *   --sem-typecheck  pula o `tsc --checkJs`
 *   --sem-test       pula o `npm test`
 *   --sem-e2e        pula o Playwright
 *   -h, --ajuda      mostra esta ajuda
 */
import 'dotenv/config';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);

const AJUDA = `Verificacao completa do laboratorio (typecheck + testes + E2E).

Uso: npm run test:full [-- <flags>]

  --down           roda \`docker compose down\` no fim, passe ou falhe
  --sem-docker     nao mexe no Docker; exige o banco ja respondendo
  --sem-typecheck  pula o typecheck
  --sem-test       pula \`npm test\` (aceitacao + unidade)
  --sem-e2e        pula \`npm run test:e2e\` (Playwright)
  -h, --ajuda      mostra esta ajuda`;

const flags = new Set(process.argv.slice(2));
const tem = (...nomes) => nomes.some((nome) => flags.has(nome));

/** Resultado de cada etapa, para o resumo final e para o codigo de saida. */
const etapas = [];

function registrar(nome, ok) {
  etapas.push({ nome, ok });
}

/** Monta a linha de comando, citando o argumento que tiver espaco. */
function linhaDeComando(comando, argumentos) {
  const citar = (valor) => (/\s/.test(valor) ? `"${valor}"` : valor);
  return [comando, ...argumentos].map(citar).join(' ');
}

/**
 * Roda um comando no diretorio da raiz e devolve true em sucesso.
 *
 * O comando vai como uma string unica com `shell: true`, e nao como array de
 * argumentos. No Windows isso e obrigatorio (o npm e um `npm.cmd`, e o Node
 * recusa spawnar .cmd sem shell), e a string unica evita o DEP0190 -- passar
 * array de args junto de `shell: true` e depreciado, porque os argumentos sao
 * concatenados sem escape. Os nossos argumentos nao vem de entrada do usuario,
 * entao a concatenacao e segura; a citacao acima cobre o que tiver espaco.
 */
function executar(comando, argumentos, rotulo) {
  const linha = linhaDeComando(comando, argumentos);
  console.log(`\n==================== ${rotulo} ====================`);
  console.log(`$ ${linha}\n`);

  const resultado = spawnSync(linha, {
    cwd: RAIZ,
    stdio: 'inherit',
    shell: true,
  });

  return resultado.status === 0;
}

/** CLI do Docker + plugin compose instalados. Nao diz nada sobre o daemon. */
function dockerCliDisponivel() {
  const resultado = spawnSync('docker compose version', {
    cwd: RAIZ,
    stdio: 'ignore',
    shell: true,
  });
  return resultado.status === 0;
}

/**
 * Daemon do Docker respondendo.
 *
 * `docker compose version` responde mesmo com o engine parado, porque so le o
 * plugin; `docker info` exige o daemon. Usar `info` antes do `down` evita falar
 * com um daemon ausente e despejar o erro de npipe no meio do resumo.
 */
function dockerEngineDisponivel() {
  const resultado = spawnSync('docker info --format {{.ServerVersion}}', {
    cwd: RAIZ,
    stdio: 'ignore',
    shell: true,
  });
  return resultado.status === 0;
}

/** Teste de porta cru: nao depende de mysql2 nem de credencial nenhuma. */
function portaAberta(host, porta, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: porta });
    let encerrado = false;

    const finalizar = (aberta) => {
      if (encerrado) {
        return;
      }
      encerrado = true;
      socket.destroy();
      resolve(aberta);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalizar(true));
    socket.once('timeout', () => finalizar(false));
    socket.once('error', () => finalizar(false));
  });
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera o banco aceitar conexao.
 *
 * O `start_period` do healthcheck do compose e 30s, e um volume recem-criado
 * leva mais que isso para o MySQL 8 inicializar. O pool do mysql2 tambem
 * reconecta sozinho, mas o socket e o sinal que nao depender de credencial.
 */
async function esperarBanco({ tentativas = 60, intervaloMs = 2000 } = {}) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    if (await portaAberta(DB_HOST, DB_PORT)) {
      process.stdout.write('\n');
      return true;
    }
    process.stdout.write(
      `\r[banco] aguardando ${DB_HOST}:${DB_PORT} (${tentativa}/${tentativas})...`,
    );
    await dormir(intervaloMs);
  }
  process.stdout.write('\n');
  return false;
}

function finalizar(derrubar) {
  if (derrubar) {
    if (dockerEngineDisponivel()) {
      executar('docker', ['compose', 'down'], 'docker compose down');
    } else {
      console.warn('[aviso] --down foi pedido, mas o daemon do Docker nao responde.');
    }
  }

  console.log('\n==================== RESUMO ====================');
  for (const etapa of etapas) {
    console.log(`${etapa.ok ? 'OK   ' : 'FALHA'}  ${etapa.nome}`);
  }
  const falhou = etapas.some((etapa) => !etapa.ok);
  if (etapas.length === 0) {
    console.log('nenhuma etapa executada');
  }
  console.log('===============================================');

  return falhou ? 1 : 0;
}

async function principal() {
  if (tem('-h', '--ajuda')) {
    console.log(AJUDA);
    return 0;
  }

  const semDocker = tem('--sem-docker');
  const derrubar = tem('--down');

  // 1. Typecheck: barato e sem banco, entao roda antes de qualquer container.
  if (!tem('--sem-typecheck')) {
    registrar(
      'typecheck',
      executar('npm', ['run', 'typecheck'], 'typecheck (tsc --checkJs)'),
    );
  }

  // 2. Banco de dados.
  let bancoPronto = await portaAberta(DB_HOST, DB_PORT);

  if (!bancoPronto && semDocker) {
    console.error(
      `\n[erro] ${DB_HOST}:${DB_PORT} nao responde e --sem-docker foi usado.`,
    );
    registrar('banco', false);
    return finalizar(derrubar);
  }

  if (!bancoPronto) {
    if (!dockerCliDisponivel()) {
      console.error(
        `\n[erro] ${DB_HOST}:${DB_PORT} nao responde e o Docker nao esta disponivel.`,
      );
      console.error(
        'Suba o banco manualmente (docker compose up -d db) ou inicie o Docker Desktop.',
      );
      registrar('banco', false);
      return finalizar(derrubar);
    }

    const subiu = executar(
      'docker',
      ['compose', 'up', '-d', 'db'],
      'subindo o MySQL (docker compose up -d db)',
    );
    registrar('docker compose up -d db', subiu);
    if (!subiu) {
      return finalizar(derrubar);
    }

    bancoPronto = await esperarBanco();
  }

  if (!bancoPronto) {
    console.error('\n[erro] o banco nao ficou pronto dentro do tempo esperado.');
    registrar('banco', false);
    return finalizar(derrubar);
  }

  registrar('banco', true);
  console.log(`\n[banco] ${DB_HOST}:${DB_PORT} respondendo.`);

  // 3. Suite de aceitacao + unidade.
  if (!tem('--sem-test')) {
    registrar(
      'npm test',
      executar('npm', ['test'], 'npm test (aceitacao T01-T10 + unidade)'),
    );
  }

  // 4. E2E. O Playwright sobe o proprio servidor (porta 3100) via webServer.
  if (!tem('--sem-e2e')) {
    registrar(
      'npm run test:e2e',
      executar('npm', ['run', 'test:e2e'], 'npm run test:e2e (Playwright)'),
    );
  }

  return finalizar(derrubar);
}

process.exitCode = await principal();
