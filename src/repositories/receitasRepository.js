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
 */
export async function listarComentarios() {
  const [rows] = await pool.execute(LISTAR_SQL);
  return rows;
}

export async function inserirComentario({ nomeAutor, textoComentario }) {
  const [result] = await pool.execute(INSERIR_SQL, [
    nomeAutor,
    textoComentario,
  ]);
  return { id: result.insertId, nomeAutor, textoComentario };
}
