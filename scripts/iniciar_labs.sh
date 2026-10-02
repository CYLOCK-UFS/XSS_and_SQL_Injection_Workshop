#!/usr/bin/env bash
# =============================================================================
# iniciar_labs.sh - sobe as 13 bancadas de laboratorio na EC2
# =============================================================================
# Este e o script do runbook "Passo a passo EC2 oficina.txt", versionado aqui
# para que a aula nao dependa de ninguem recriar um arquivo via `nano` na
# maquina -- e para que a diferenca entre o laboratorio de hoje e o de amanha
# apareca em `git diff`, e nao em treze containers mysterious.
#
# O que cada bancada recebe:
#
#   COMPOSE_PROJECT_NAME=bancada_N   prefixo de container, rede e volume. E o
#                                   que impede a colisao entre as 13.
#   APP_PORT=3000+N                  porta publicada no host, 3001 a 3013.
#   LAB_ALUNO_ID=alunoNN             rotulo sintetico do laboratorio, consumido
#                                   pelo cookie `lab_session` (DAS v2.4, s.9).
#
# Como o isolamento funciona: cada `up` roda com um COMPOSE_PROJECT_NAME
# diferente, entao o Compose cria um projeto por bancada -- rede propria
# (`bancada_N_default`) e volume proprio (`bancada_N_db_data`). O MySQL de uma
# bancada nao e published e nao e resolvido por nenhuma outra: a aplicacao so
# alcanca `db` na propria rede. Nenhuma porta de banco e aberta no host.
#
# O Security Group da EC2 precisa liberar o intervalo 3000-3015 em TCP, origem
# 0.0.0.0/0 -- ver o README, secao "Implantacao em EC2".
#
# Uso:
#   ./scripts/iniciar_labs.sh              # as 13 bancadas, portas 3001-3013
#   ./scripts/iniciar_labs.sh 5            # so a bancada 5, porta 3005
#   ALUNOS=13 ./scripts/iniciar_labs.sh    # outra quantidade
#
# Encerrar (nao apaga os dados):
#   ./scripts/parar_labs.sh
# =============================================================================

set -euo pipefail

# Quantas bancadas subir. 13 e o plano do runbook; o parametro na linha de
# comando sobrescreve para um teste rapido antes da aula.
ALUNOS="${1:-13}"

# 3000 + i: a primeira bancada fica na 3001, a ultima em 3013. A faixa do
# Security Group e 3000-3015 para sobrar folga nas pontas.
PORTA_BASE=3000

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${RAIZ}/docker/compose/docker-compose.student.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "erro: compose do aluno nao encontrado em ${COMPOSE_FILE}" >&2
  exit 1
fi

# O Compose le a interpolacao de ${APP_PORT} e companhia da propria variavel de
# ambiente -- nao de um .env. O script exporta todas as variaveis de que a
# interpolacao precisa, entao funciona numa maquina recem-clonada, sem .env.
export DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-lab_root_password}"
export DB_NAME="${DB_NAME:-lab_palestra}"
export DB_USER="${DB_USER:-lab_user}"
export DB_PASSWORD="${DB_PASSWORD:-lab_password}"
export HOST="${HOST:-0.0.0.0}"

echo "Subindo ${ALUNOS} bancada(s) a partir de ${COMPOSE_FILE}"

for (( i = 1; i <= ALUNOS; i++ )); do
  PORTA_ALUNO=$(( PORTA_BASE + i ))

  # `printf %02d` e o que produz aluno01 em vez de aluno1. O identificador vai
  # para o cookie de sessao didatico e para os logs, e um rotulo de duas casas
  # fica legivel ao lado dos outros sem precisar contar colunas.
  export LAB_ALUNO_ID="aluno$(printf '%02d' "$i")"
  export COMPOSE_PROJECT_NAME="bancada_${i}"
  export APP_PORT="${PORTA_ALUNO}"

  echo "  ${COMPOSE_PROJECT_NAME} (${LAB_ALUNO_ID}) -> porta ${APP_PORT}"

  docker compose -f "$COMPOSE_FILE" up --build -d
done

echo
echo "As ${ALUNOS} bancada(s) foram iniciadas."
echo "Acesso: http://IP_PUBLICO_DA_EC2:3001 ate http://IP_PUBLICO_DA_EC2:${PORTA_BASE}+${ALUNOS}"
echo
echo "Para conferir: docker ps --filter 'name=bancada_' --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo "Para encerrar:  ./scripts/parar_labs.sh ${ALUNOS}"