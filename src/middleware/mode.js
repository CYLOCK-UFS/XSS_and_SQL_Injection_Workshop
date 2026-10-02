/**
 * Contrato de modo do laboratorio (DAS v2.2, secao 3).
 *
 * Regra unica e documentada para cookie ausente ou invalido: o laboratorio
 * assume o modo `vuln` (DEFAULT_LAB_MODE). Nao ha excecao nem segundo
 * fallback em nenhum ponto do codigo. O cookie e uma convencao do
 * laboratorio, NAO um mecanismo de seguranca.
 */

/**
 * `dotenv` e importado aqui, e nao so em src/config/database.js, porque este
 * arquivo le LAB_ALUNO_ID e LAB_SECURE_COOKIES no TOPO do modulo. E
 * src/app.js importa este middleware antes das rotas, que so chegam no dotenv
 * por tras de src/config/database.js -- sem esta linha as duas variaveis
 * seriam lidas como `undefined` e cairiam no padrao silenciosamente. Falha de
 * ambiente que so aparece na bancada 7 e o tipo de coisa que se perde um dia de
 * oficina.
 */
import 'dotenv/config';

export const LAB_MODE_COOKIE = 'lab_mode';

export const LAB_MODE_VULN = 'vuln';
export const LAB_MODE_SAFE = 'safe';

export const LAB_MODES = [LAB_MODE_VULN, LAB_MODE_SAFE];

export const DEFAULT_LAB_MODE = LAB_MODE_VULN;

export function isValidLabMode(value) {
  return LAB_MODES.includes(value);
}

export function normalizeLabMode(value) {
  return isValidLabMode(value) ? value : DEFAULT_LAB_MODE;
}

/* -----------------------------------------------------------------------------
   Sessao sintetica do cenario 6 (DAS v2.4, secao 9)
   -------------------------------------------------------------------------- */

/**
 * Cookie de sessao do laboratorio.
 *
 * EXISTE APENAS PARA A AULA. Nao ha autenticacao nesta aplicacao e nada aqui
 * verifica o valor: `modeMiddleware` le `lab_mode`, e `lab_session` e lido por
 * ninguem do lado do servidor. Um cookie de sessao que ninguem valida seria uma
 * falha se estivesse em producao -- aqui ele e um objeto de demonstracao, e o
 * valor precisa ficar visivel para a plateia ver o cookie chegar e sumir do
 * console conforme o modo muda.
 *
 * O nome e proposital: e o nome que o aluno vai procurar em `document.cookie`.
 */
export const LAB_SESSION_COOKIE = 'lab_session';

/**
 * Identidade da bancada, a partir de LAB_ALUNO_ID.
 *
 * Exportada porque `/api/health` precisa mostrar ao console do instrutor QUAL
 * laboratorio ele esta controlando (DAS v2.4, secao 16.3), e o valor nao pode
 * ser lido em dois lugares: duas leituras de `process.env` divergem no dia em
 * que o `.env` da bancada for editado e uma delas for esquecida.
 */
export const LAB_ALUNO_ID = process.env.LAB_ALUNO_ID || 'aluno01';

/**
 * `Secure` por variavel de ambiente, e nao fixo.
 *
 * O laboratorio padrao roda em `http://127.0.0.1`, e o navegador DESCARTA um
 * cookie `Secure` recebido por pagina http -- o cookie apareceria no curl e
 * nao apareceria na apresentacao. Foi por isso que o mesmo cuidado vale aqui e
 * em `lab_mode`.
 *
 * A diferenca e que aqui a opcao existe e e testada: quem implanta a bancada em
 * uma URL com TLS liga LAB_SECURE_COOKIES=true, e o mesmo codigo passa a emitir o
 * cookie com `Secure`, sem branching no meio da aula. Em aplicacao real servida
 * por TLS, isto e obrigatorio e nao e opcao.
 *
 * O valor aceito e `true` ou `1`, porque o `.env.example` documenta `false` como
 * padrao e alguem vai escrever `LAB_SECURE_COOKIES=1`. Qualquer outra coisa --
 * vazio, `nao`, `0` -- fica sem `Secure`, e o laboratorio continua funcionando em
 * HTTP. Uma variavel de ambiente que precisa de valor exato e uma variavel que
 * passa a ser ajustada na mao em 13 bancadas.
 */
const COOKIE_SECURE = ['1', 'true'].includes(
  String(process.env.LAB_SECURE_COOKIES || '').toLowerCase(),
);

/** 12 horas, igual ao `lab_mode`: a bancada vive um dia de oficina. */
const MAX_IDADE = 1000 * 60 * 60 * 12;

/**
 * Valor da sessao sintetica.
 *
 * `sess-<modo>-<aluno>` e deterministico, e sao dois motivos, nao um:
 *
 * 1. O modo aparece no valor. O roteiro precisa mostrar que em `vuln` o
 *    `document.cookie` traz a sessao e em `safe` traz a string VAZIA. Com um
 *    token aleatorio, o aluno nao teria como dizer se o que sumiu foi o cookie
 *    ou foi o valor mudando.
 *
 *    O que nao aparece no `document.cookie` em nenhum dos modos e o `lab_mode`,
 *    porque ele e HttpOnly nos dois (ver setLabModeCookie). A string vazia no
 *    modo seguro e, portanto, a prova de que a diferenca e do ATRIBUTO, e nao
 *    de o cookie ter desaparecido do navegador.
 * 2. O aluno aparece no valor. Na bancada 7 o console mostra `sess-vuln-aluno07`,
 *    e a plateia sabe que o exemplo que esta rodando e o da sua mesa -- sem
 *    precisar perguntar.
 *
 * @param {string} modo `vuln` ou `safe`.
 * @returns {string}
 */
export function valorSessaoSintetica(modo) {
  return `sess-${normalizeLabMode(modo)}-${LAB_ALUNO_ID}`;
}

/**
 * Grava o cookie de sessao sintetica do cenario 6.
 *
 * E a funcao onde o `httpOnly` muda entre os modos, e essa e a aula inteira:
 *
 *   modo vulneravel -> httpOnly: false -> `document.cookie` mostra a sessao
 *   modo seguro     -> httpOnly: true  -> o cookie NAO volta para o script
 *
 * O que um payload consegue fazer com isso: em `vuln`, ler a sessao de quem
 * digitou, exibi-la, e ate REESCREVER o valor com
 * `document.cookie = 'lab_session=...'`, cambiando de sessao sem saber a senha.
 * Em `safe`, o mesmo script recebe a string VAZIA de `document.cookie`, porque
 * nenhum documento JS ve os cookies marcados HttpOnly. O ataque deixa de
 * funcionar nao porque o script ficou mais fraco, mas porque o alvo sumiu.
 *
 * Repare que o `httpOnly` nao protege sozinho: ele so muda o alcance do
 * codigo que a pagina JÁ tem. Quem decide o que a pagina pode fazer com a
 * sessao continua sendo o servidor, e por isso que o valor desta sessao e
 * sintetico e nao autentica ninguem.
 *
 * @param {import('express').Response} res
 * @param {string} modo `vuln` ou `safe`.
 */
export function setLabSessionCookie(res, modo) {
  res.cookie(LAB_SESSION_COOKIE, valorSessaoSintetica(modo), {
    path: '/',
    httpOnly: normalizeLabMode(modo) !== LAB_MODE_VULN,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: MAX_IDADE,
  });
}

/**
 * Grava o cookie que carrega o modo do laboratorio.
 *
 * `httpOnly: true` e o ponto que interessa na aula, porque o laboratorio tem
 * um XSS armazenado funcional: se este cookie fosse legivel por JavaScript,
 * o payload da pagina do ChefLab poderia ler o modo e reescreve-lo, e o
 * atacante escolheria o modo `vuln` sozinho, sem clicar em nada.
 *
 * E a razao de o modo NAO estar em header, em query string ou em variavel
 * global: `req.labMode` e lido no servidor, e um cookie HttpOnly nao volta
 * para o documento por `document.cookie`.
 *
 * O e o contraste com `lab_session` acima, e a distincao importa na aula: no
 * laboratorio os dois cookies andam juntos na mesma resposta, e mesmo assim um
 * e legivel e o outro nao. Um cookie HttpOnly nao protege a sessao e um cookie
 * legivel nao vaza o modo -- sao duas configuracoes independentes do mesmo
 * objeto.
 *
 * Nao ha `secure: true` de proposito -- ver COOKIE_SECURE, que explica o mesmo
 * raciocinio para os dois cookies.
 */
export function setLabModeCookie(res, mode) {
  res.cookie(LAB_MODE_COOKIE, mode, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: MAX_IDADE,
  });
}

/**
 * Esta requisicao e a que troca o modo?
 *
 * `POST /api/mode` emite os DOIS cookies de uma vez (ver setLabSessionCookie).
 * Se o middleware abaixo tambem emitisse a sessao aqui, a mesma resposta traria
 * `lab_session` duas vezes -- primeiro o valor do modo ANTIGO, sem HttpOnly,
 * depois o valor novo. O navegador acabaria com o ultimo, que e o certo, e por
 * isso o bug passaria despercebido: porem a aba Network do DevTools mostraria
 * duas linhas `lab_session` na demonstracao do cenario 6, e o aluno ouviria que
 * existem dois cookies de sessao.
 *
 * O `endsWith` em vez do caminho completo e proposital: este middleware roda a
 * nivel de app e ve `/api/mode`, mas a mesma rota la embaixo de um Router ve
 * `/mode`. Comparar o sufixo funciona nos dois casos e nao amarra este arquivo
 * ao ponto de montagem.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function alternaOModo(req) {
  return req.method === 'POST' && req.path.endsWith('/mode');
}

/**
 * Le o cookie lab_mode e define req.labMode.
 * Usado por todas as rotas, sem excecao.
 *
 * Tambem garante que `lab_session` exista, e essa e a unica funcao deste arquivo
 * que ESCREVE um cookie sem ser chamada por uma acao do usuario. O motivo e
 * concreto: sem isso, a sessao sintetica so apareceria depois da primeira
 * troca de modo na barra, e o roteiro comeca mostrando `document.cookie` numa
 * pagina recem-aberta. A demonstracao do cenario 6 nao pode depender de o aluno
 * ter clicado em algo antes.
 *
 * Emitir e o que importa: e assim que a sessao ganha o atributo `httpOnly` do
 * modo vigente, e que o aluno ve o cookie aparecer no console no instante em
 * que troca para `safe`.
 */
export function modeMiddleware(req, res, next) {
  const cookies = req.cookies || {};
  req.labMode = normalizeLabMode(cookies[LAB_MODE_COOKIE]);

  if (cookies[LAB_SESSION_COOKIE] === undefined && !alternaOModo(req)) {
    setLabSessionCookie(res, req.labMode);
  }

  next();
}
