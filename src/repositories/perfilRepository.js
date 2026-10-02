/* =============================================================================
   FinBank - perfil do cliente (DAS v2.4, secao 8)
   =============================================================================
   Segundo ponto de XSS armazenado do laboratorio, fora do ChefLab. Existe
   porque "XSS armazenado em portal de receitas" e uma unica superficie: com
   ele apenas, o aluno concludes que o problema e do portal. Um segundo
   armazenamento, dentro do mesmo banco e da mesma aplicacao, mostra que a
   propriedade e do CONTEXTO DE RENDERIZACAO, e nao do produto onde ele estava.

   Nenhuma funcao deste arquivo recebe `labMode`, e isso e o invariant mais
   importante do arquivo.

   A tabela `perfis_clientes` guarda o texto que o proprio cliente escreve na
   bio, e nao um dado do banco que o cliente nao pediu: nao existe cenario de
   injecao de SQL aqui. `id_cliente` chega do query string ou do corpo e vai
   SEMPRE como placeholder, nos dois modos -- exatamente como
   `GET /banco/cliente/:id` em bancoRepository.js, que existe pelo mesmo motivo
   (um endpoint de apoio que aceitasse concatenacao seria um quinto cenario que
   ninguem pediu, e um `id_cliente` interpolado viraria uma porta de entrada
   para `perfis_clientes` que nem esta no roteiro).

   Consequencia: o INSERT e parametrizado nos DOIS modos, como em
   receitasRepository.js. A marcacao volta intacta do banco. O que muda entre
   vuln e safe esta inteiro na saida, em src/public/finbank/perfil.js.

   O `@returns` nao e decorativo, pelo mesmo motivo do arquivo de receitas: sem
   ele o retorno do mysql2 degrada para `any` e o typecheck para de cobrir esta
   camada, inclusive um `await` esquecido na rota.
   ============================================================================= */

import { aguardarResetEmAndamento, pool } from '../config/database.js';

/**
 * Limite de `id_cliente`, o `VARCHAR(20)` do schema.
 *
 * Nao e defesa: o id tambem poderia ser lido de qualquer lugar. Existe para
 * que a resposta 400 de entrada invalida seja a mesma em qualquer origem do
 * valor, e para que um `id_cliente` gigante (o `?id_cliente=` com megabytes
 * anexados) seja recusado antes de virar parametro de consulta.
 */
export const LIMITE_CLIENTE = 20;

/**
 * Limite de `descricao_perfil` no SERVIDOR.
 *
 * `descricao_perfil` e TEXT e o MySQL guardaria 65535 bytes, o que transformaria
 * o `<textarea>` num campo de megabytes -- e um payload de XSS nao precisa de
 * tanto. O limite espelha o `maxlength` do formulario, pelo motivo oposto ao
 * habitual: aqui os dois lados existe, e o do servidor e o que vale. Quem
 * chamar POST /banco/perfil com curl nao passa pelo `maxlength`.
 */
export const LIMITE_DESCRICAO = 2000;

/**
 * Colunas publicas do perfil.
 *
 * `id_perfil` volta junto porque o PUT e um upsert por `id_cliente`: e o que
 * permite a pagina dizer qual registro ela substituiu, em vez de fingir que
 * gravou um novo. Um identificador de perfil que ninguem usa e um campo que
 * ninguem explica.
 */
const PERFIL_COLUNAS = 'id_perfil, id_cliente, descricao_perfil';

const BUSCAR_SQL =
  `SELECT ${PERFIL_COLUNAS} FROM perfis_clientes WHERE id_cliente = ?`;

const ATUALIZAR_SQL =
  'UPDATE perfis_clientes SET descricao_perfil = ? WHERE id_perfil = ?';

const INSERIR_SQL =
  'INSERT INTO perfis_clientes (id_cliente, descricao_perfil) VALUES (?, ?)';

/**
 * Le o perfil de um cliente.
 *
 * Devolve `null` quando o cliente nao tem perfil gravado -- nao lanca. A
 * ausencia de perfil e um estado normal da pagina (o cadastro existe, a bio
 * ainda nao foi preenchida), e a rota responde 404 com a mensagem que a tela
 * sabe mostrar, em vez de transformar um formulario vazio num erro de banco.
 *
 * @param {string} idCliente
 * @returns {Promise<LinhaSql | null>}
 */
export async function buscarPerfil(idCliente) {
  await aguardarResetEmAndamento();

  const [rows] = await pool.execute(BUSCAR_SQL, [idCliente]);
  const linhas = /** @type {LinhasSql} */ (rows);
  return linhas[0] || null;
}

/**
 * Grava a descricao do cliente, criando o perfil se ainda nao existir.
 *
 * E um UPSERT, e a decisao e do DAS v2.4 secao 8: o campo e uma "descricao /
 * biografia do perfil", singular e persistente -- uma propriedade do cliente,
 * nao um comentarios. Um INSERT a cada envio faria a tela crescer como o mural
 * do ChefLab e transformaria a demonstracao de "troquei a bio" em "publica mais
 * uma", o que e outro cenario.
 *
 * A consulta e parametrizada nos dois modos. `id_perfil` volta na resposta para
 * que a pagina consiga confirmar qual registro foi substituido.
 *
 * A espera pelo reset em andamento vem antes do INSERT pela mesma razao do
 * comentario do ChefLab: sem ela, o clique em "Salvar" durante um reset disparado
 * por outra aba cairia no meio do DROP/CREATE e voltaria com "table doesn't
 * exist" -- no modo vulneravel, como HTTP 500 com o erro do MySQL na tela, sem
 * ninguem ter feito nada de errado.
 *
 * @param {{ idCliente: string, descricao: string }} entrada
 * @returns {Promise<{ id_perfil: number, id_cliente: string, descricao_perfil: string }>}
 */
export async function salvarPerfil({ idCliente, descricao }) {
  await aguardarResetEmAndamento();

  const existente = await buscarPerfil(idCliente);

  if (existente) {
    // `id_perfil` volta do MySQL como `unknown` (LinhaSql e um Record de valores
    // desconhecidos, por src/types/sql.d.ts). O `Number(...)` nao e conversao por
    // estilo: ele (1) diz ao typecheck que o parametro e numerico, como o
    // `AUTO_INCREMENT` do schema, e (2) e a unica normalizacao necessaria --
    // um id gravado no banco nao precisa de validacao de formato.
    await pool.execute(ATUALIZAR_SQL, [
      descricao,
      Number(existente.id_perfil),
    ]);

    return {
      id_perfil: Number(existente.id_perfil),
      id_cliente: idCliente,
      descricao_perfil: descricao,
    };
  }

  const [result] = await pool.execute(INSERIR_SQL, [idCliente, descricao]);
  const inserido = /** @type {InsercaoSql} */ (result);

  return {
    id_perfil: inserido.insertId,
    id_cliente: idCliente,
    descricao_perfil: descricao,
  };
}