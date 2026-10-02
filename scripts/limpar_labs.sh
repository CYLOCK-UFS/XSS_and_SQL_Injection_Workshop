#!/usr/bin/env bash
# =============================================================================
# limpar_labs.sh - remove as bancadas E os dados
# =============================================================================
# `down -v`: apaga container, rede e VOLUME. Cada bancada perde o que foi
# publicado durante a aula.
#
# E o que se usa no fim de uma oficina em que o proximo uso e com outra turma --
# e o que NAO se usa para "voltar ao estado inicial" no meio da demonstracao,
# que e o botao "Restaurar laboratorio" do console (`/palco`) ou o
# `POST /api/reset`, ambos com efeito sobre uma unica bancada.
#
# Uso:
#   ./scripts/limpar_labs.sh         # as 13 bancadas
#   ./scripts/limpar_labs.sh 5       # so a bancada 5
#
# ATENCAO: nao ha confirmacao interativa. Verifique o numero antes de rodar.
# =============================================================================

set -euo pipefail

ALUNOS="${1:-13}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${RAIZ}/docker/compose/docker-compose.student.yml"

export DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-lab_root_password}"
export DB_NAME="${DB_NAME:-lab_palestra}"
export DB_USER="${DB_USER:-lab_user}"
export DB_PASSWORD="${DB_PASSWORD:-lab_password}"
export HOST="${HOST:-0.0.0.0}"

echo "Removendo ${ALUNOS} bancada(s), INCLUSIVE os volumes com os dados."

for (( i = 1; i <= ALUNOS; i++ )); do
  export COMPOSE_PROJECT_NAME="bancada_${i}"
  export APP_PORT=$(( 3000 + i ))
  export LAB_ALUNO_ID="aluno$(printf '%02d' "$i")"

  echo "  removendo ${COMPOSE_PROJECT_NAME}"
  docker compose -f "$COMPOSE_FILE" down -v
done

echo
echo "Bancadas e volumes removidos. As portas 3001 a $(( 3000 + ALUNOS )) estao livres."