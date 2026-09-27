/**
 * Tipagem do `req.labMode`.
 *
 * O modo do laboratorio NAO vem de header nem de query string: o middleware
 * `src/middleware/mode.js` le o cookie e gruda a propriedade no request para que
 * nenhuma rota precise repassar o modo por parametro. Em JavaScript puro isso
 * funciona sem declaracao nenhuma -- porem o `tsc --checkJs` nao tem como saber
 * que a propriedade existe e acusa `Property 'labMode' does not exist on type
 * 'Request'` em todas as rotas.
 *
 * Estas duas linhas resolvem o problema inteiro. A alternativa seria espalhar
 * `/** @type {any} *\/` por quinze chamadas, e um typecheck que obriga a
 * desligar a checagem em cada arquivo deixa de ser util.
 *
 * Este arquivo nao emite nada: e apenas anotacao para o typecheck.
 */
declare module 'express-serve-static-core' {
  interface Request {
    /** 'vuln' ou 'safe', definido por src/middleware/mode.js. */
    labMode: string;
  }
}

export {};
