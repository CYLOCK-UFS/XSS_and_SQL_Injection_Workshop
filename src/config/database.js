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

  /**
   * DATETIME chega como TEXTO, nunca como objeto Date do JavaScript.
   *
   * Sem esta opcao o mysql2 monta um `new Date(ano, mes, dia, hora, ...)` a
   * partir dos componentes do DATETIME -- hora de parede do servidor -- e o
   * valor vira um instante absoluto. A partir dai a exibicao passa a depender de
   * DOIS fusos que o laboratorio nao controla: o do processo Node e o do
   * navegador. E eles nao sao o mesmo.
   *
   * No Docker, por exemplo, o container roda em UTC e o navegador da plateia
   * roda em UTC-3. O seed `2024-01-10 18:30:00` era exibido como 15:30 no
   * projetor, e o mesmo seed aparecia com a hora certa quando o apresentador
   * subia `npm start` na maquina em vez de usar o container. A hora exibida
   * mudava conforme COMO o laboratorio foi iniciado, o que e o pior tipo de
   * bug para uma demonstracao.
   *
   * Ler o valor como texto deixa a data fora de qualquer conversao: a pagina
   * mostra exatamente o que esta gravado no banco, e o comentario e o JSON
   * bruto da API passam a concordar. `formatarData` em src/public/js/lab.js
   * formata esses componentes sem passar por `new Date(string)`.
   */
  dateStrings: true,
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
let resetEmAndamento = null;

export function runInitScript() {
  if (resetEmAndamento) {
    return resetEmAndamento;
  }

  resetEmAndamento = executarInitScript().finally(() => {
    resetEmAndamento = null;
  });

  return resetEmAndamento;
}

/**
 * Faz a LEITURA esperar o reset em andamento, quando existir.
 *
 * Serializar reset contra reset resolve apenas metade do problema. A outra
 * metade e o cruzamento: o init.sql faz `DROP TABLE` antes de `CREATE TABLE`, e
 * durante essa janela um `GET /banco/...` que ja esteja no banco falha com
 * "table doesn't exist". No modo vulneravel isso volta ao aluno como HTTP 500
 * com o erro do MySQL no corpo -- no meio da demonstracao, sem que ninguem
 * tenha clicado em nada, porque a aba da plateia estava so recarregando.
 *
 * Este e um ponto unico de espera em vez de uma checagem por repository: a
 * leitura e a unica coisa que sofre com o DROP, e qualquer leitura nova
 * precisa se lembrar de esperar. Um repository esquecido seria um 500 em direto.
 *
 * A falha do reset e engolida de proposito: quem precisa saber que o reset
 * quebrou e a propria rota POST /api/reset, que responde com o erro. A leitura
 * nao pode virar mensageiro de uma falha alheia -- ela so precisa de um estado
 * consistente, e um estado ja quebrado vai falhar na consulta de qualquer
 * jeito, dessa vez com um erro que descreve a causa real.
 */
export async function aguardarResetEmAndamento() {
  if (!resetEmAndamento) {
    return;
  }

  try {
    await resetEmAndamento;
  } catch {
    // O reset em andamento ja reportou a falha em POST /api/reset.
  }
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
