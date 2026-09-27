/**
 * Tipagem do retorno do MySQL, em JSDoc.
 *
 * O `pool.execute()` do mysql2 e tipado como uniao de tres possibilidades --
 * `RowDataPacket[]` para SELECT, `OkPacket` para INSERT/UPDATE e
 * `ResultSetHeader` para INSERT. O TypeScript nao consegue estreitar a uniao a
 * partir da string SQL, entao `rows.map(...)`, `rows.length` e
 * `result.insertId` aparecem como erro embora sejam a operacao normal de cada
 * endpoint.
 *
 * As formas sao declaradas no escopo GLOBAL de proposito. Em JavaScript puro
 * nao existe `import type` -- usar essa sintaxe aqui faria o Node falhar ao
 * carregar o modulo, e o laboratorio pararia de funcionar. Com `declare global`,
 * o comentario JSDoc `/** @type {LinhasSql} *\/` resolve sem nenhum import.
 *
 * Este arquivo nao emite nada: e anotacao para o typecheck.
 */

/**
 * Uma linha qualquer devolvida por um SELECT.
 */
declare global {
  type LinhaSql = Record<string, unknown>;

  /** Resultado de SELECT: lista de linhas. */
  type LinhasSql = LinhaSql[];

  /** Resultado de INSERT: traz o id gerado. */
  type InsercaoSql = { insertId: number };
}

export {};
