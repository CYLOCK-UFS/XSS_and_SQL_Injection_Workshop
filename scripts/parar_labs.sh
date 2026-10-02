#!/usr/bin/env bash
# =============================================================================
# parar_labs.sh - encerra as bancadas sem apagar os dados
# =============================================================================
# Complemento de `iniciar_labs.sh`. Faz `down` -- que remove container e rede,
# mas preserva o volume `bancada_N_db_data`. Os comentarios que o aluno publicou
# continuam la na proxima execucao.
#
# Para RECOMEÇAR do zero (isso apaga os dados de TODAS as bancadas indicadas):
#   ./scripts/limpar_labs.sh 13
#
# Uso:
#   ./scripts/parar_labs.sh          # as 13 bancadas
#   ./scripts/parar_labs.sh 5        # so a bancada 5
# =============================================================================

set -euo pipefail

ALUNOS="${1:-13}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${RAIZ}/docker/compose/docker-compose.student.yml"

# As mesmas credenciais do inicio: sem elas, o Compose avisa sobre variaveis
# nao definidas ao remover a rede -- inofensivo, mas polui o log da aula.
export DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-lab_root_password}"
export DB_NAME="${DB_NAME:-lab_palestra}"
export DB_USER="${DB_USER:-lab_user}"
export DB_PASSWORD="${DB_PASSWORD:-lab_password}"
export HOST="${HOST:-0.0.0.0}"

for (( i = 1; i <= ALUNOS; i++ )); do
  export COMPOSE_PROJECT_NAME="bancada_${i}"
  export APP_PORT=$(( 3000 + i ))
  export LAB_ALUNO_ID="aluno$(printf '%02d' "$i")"

  echo "Encerrando ${COMPOSE_PROJECT_NAME}"
  docker compose -f "$COMPOSE_FILE" down
done

echo
echo "As ${ALUNOS} bancada(s) foram encerradas. Os volumes com os dados continuam."