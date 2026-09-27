# =============================================================================
# FinBank & ChefLab - imagem da aplicacao
# =============================================================================
# Build em dois estagios, na ordem recomendados pela skill multi-stage-dockerfile:
# dependencias -> runtime.
#
# A tag e FIXA em patch e flavor, nao em major. `node:24-slim` flutua a cada
# release e transformaria uma imagem de workshop em uma imagem diferente a cada
# `docker compose build`, o que e exatamente o oposto de reproduzivel. O MySQL
# ja era pinado em mysql:8.0.46-bookworm; a aplicacao agora segue o mesmo
# criterio, e no mesmo Debian (bookworm) para nao introduzir diferenca de libc
# entre os dois containers. A tag 24.18.1 tambem corresponde a versao do host
# usada para rodar os testes de aceitacao.
# =============================================================================

# -----------------------------------------------------------------------------
# Estagio deps: instala as dependencias de producao
# -----------------------------------------------------------------------------
# npm ci, e nao npm install: o lockfile versionado e a fonte da verdade e o
# `install` pode resolve-lo diferente,o que faria a imagem divergir do que roda
# na maquina do apresentador sem nenhuma mudanca visivel no repositorio.
FROM node:24.18.1-bookworm-slim AS deps

WORKDIR /app

# O manifesto antes do codigo: esta camada so e invalidada quando
# package.json/package-lock.json mudam, nao a cada edicao em src/.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

# -----------------------------------------------------------------------------
# Estagio runtime: contem apenas o necessario para executar
# -----------------------------------------------------------------------------
FROM node:24.18.1-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Copia as dependencias ja resolvidas do estagio anterior, em vez de instalar de
# novo: o stage de deps e cacheado e a imagem final nao carrega ferramenta de
# build nem o cache do npm.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY database ./database
COPY src ./src

# O processo nao precisa de root para nada. A imagem oficial do Node ja traz o
# usuario `node` (uid 1000), entao nao ha nem criação de usuario aqui.
# Ler os arquivos acima como root e depois dropping para `node` e o padrao, e
# ja basta para que nada em /app seja gravavel pelo processo.
USER node

EXPOSE 3000

# O health check usa o mesmo endpoint que o compose e o T01: /api/health
# responde 503 com `ok:false` quando o banco cai, e 200 com `ok:true` quando
# esta de pe. O Node 24 tem fetch global, entao nao e preciso curl na imagem.
# `start_period` acompanha a espera do MySQL: um banco ainda inicializando nao
# deve marcar o container como unhealthy antes do tempo.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "src/server.js"]
