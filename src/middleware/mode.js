/**
 * Contrato de modo do laboratorio (DAS v2.2, secao 3).
 *
 * Regra unica e documentada para cookie ausente ou invalido: o laboratorio
 * assume o modo `vuln` (DEFAULT_LAB_MODE). Nao ha excecao nem segundo
 * fallback em nenhum ponto do codigo. O cookie e uma convencao do
 * laboratorio, NAO um mecanismo de seguranca.
 */
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
 * Nao ha `secure: true` de proposito -- o laboratorio roda em
 * `http://127.0.0.1`, e um cookie `Secure` seria descartado pelo navegador em
 * pagina http, tirando o seletor de modo da apresentacao. Em aplicacao real
 * servida por TLS, `secure: true` e obrigatorio e faz parte do mesmo raciocinio.
 */
export function setLabModeCookie(res, mode) {
  res.cookie(LAB_MODE_COOKIE, mode, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
  });
}

/**
 * Le o cookie lab_mode e define req.labMode.
 * Usado por todas as rotas, sem excecao.
 */
export function modeMiddleware(req, res, next) {
  const cookieValue = req.cookies ? req.cookies[LAB_MODE_COOKIE] : undefined;
  req.labMode = normalizeLabMode(cookieValue);
  next();
}
