import { pool } from '../config/database.js';

export const LIMITE_AUTOR = 80;
export const LIMITE_TEXTO = 2000;

const LISTAR_SQL = `SELECT id_comentario, nome_autor, texto_comentario, data_postagem
  FROM comentarios_receita
  ORDER BY data_postagem DESC, id_comentario DESC`;

const INSERIR_SQL =
  'INSERT INTO comentarios_receita (nome_autor, texto_comentario, data_postagem) VALUES (?, ?, NOW())';

/**
 * ChefLab - XSS armazenado (DAS v2.2, secao 4.4).
 *
 * O INSERT e PARAMETRIZADO nos dois modos: a entrada do usuario nunca altera
 * a estrutura da query. A vulnerabilidade do cenario esta na SAIDA, em
 * src/public/receitas (innerHTML no modo vuln, textContent no modo safe).
 *
 * O `@returns` nao e documentacao ornamental: sem ele o retorno do mysql2
 * degrada para `any`, e o typecheck passa a ignorar esta camada inteira --
 * inclusive um `await` esquecido na rota, que viraria um bug de runtime.
 */
export async function listarComentarios() {
  const [rows] = await pool.execute(LISTAR_SQL);
  return /** @type {LinhasSql} */ (rows);
}

/**
 * @returns {Promise<{ id: number, nomeAutor: string, textoComentario: string }>}
 */
export async function inserirComentario({ nomeAutor, textoComentario }) {
  const [result] = await pool.execute(INSERIR_SQL, [
    nomeAutor,
    textoComentario,
  ]);
  // `execute()` devolve `OkPacket | ResultSetHeader | RowDataPacket[]`; num
  // INSERT o membro que interessa e `insertId`. Ver src/types/sql.d.ts.
  const inserido = /** @type {InsercaoSql} */ (result);
  return { id: inserido.insertId, nomeAutor, textoComentario };
}
