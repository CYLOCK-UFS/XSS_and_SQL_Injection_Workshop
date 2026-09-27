import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'lab_user',
  password: process.env.DB_PASSWORD || 'lab_password',
  database: process.env.DB_NAME || 'lab_palestra',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

/**
 * Pool usado por TODAS as rotas. Nao habilite multipleStatements aqui:
 * isso ampliaria o poder de injecao das queries geradas a partir de entrada
 * do usuario. O protocolo de prepared statement (execute) tambem e o que
 * separa codigo SQL de valores na rota segura.
 */
export const pool = mysql.createPool(dbConfig);

const INIT_SQL_URL = new URL('../../database/init.sql', import.meta.url);

/**
 * Aguarda o MySQL ficar pronto. Sem isso, um clone limpo falharia ao subir
 * os containers ao mesmo tempo (T01).
 */
export async function waitForDatabase({ attempts = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      console.warn(
        `[lab] MySQL indisponivel (tentativa ${attempt}/${attempts}): ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function checkDatabase() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?`,
    [dbConfig.database],
  );
  return Number(rows[0].total);
}

export async function closeDatabase() {
  await pool.end();
}

/**
 * POST /api/reset (DAS, secao 7).
 *
 * Reexecuta database/init.sql inteiro em uma conexao DEDICADA com
 * multipleStatements: true, porque o script tem varios DROP/CREATE/INSERT
 * separados por ponto e virgula e o mysql2 bloqueia multiplas queries na
 * mesma chamada por padrao.
 *
 * ATENCAO: esta e a unica conexao do laboratorio com multiplos statements.
 * Nunca reutilize-a para responder a entrada do usuario.
 */

/**
 * Serializa o reset. Sem isto, dois POST /api/reset simultaneos abrem duas
 * conexoes e o segundo DROP TABLE corre enquanto o primeiro ainda esta
 * recriando as tabelas: as consultas em andamento caem em "table doesn't
 * exist" no meio de uma demonstracao, sem que ninguem tenha feito nada de
 * errado. O laboratorio inteiro depende de o estado do banco ser consistente,
 * entao a garantia e melhor dentro do processo do que no MySQL.
 *
 * Chamadas concorrentes nao sao enfileiradas: elas compartilham a mesma
 * promise, porque o resultado desejado (estado inicial restaurado) e o mesmo.
 */
let resetEmCurso = null;

export function runInitScript() {
  if (resetEmCurso) {
    return resetEmCurso;
  }

  resetEmCurso = executarInitScript().finally(() => {
    resetEmCurso = null;
  });

  return resetEmCurso;
}

async function executarInitScript() {
  const sql = await readFile(INIT_SQL_URL, 'utf8');
  const connection = await mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
  });
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}
