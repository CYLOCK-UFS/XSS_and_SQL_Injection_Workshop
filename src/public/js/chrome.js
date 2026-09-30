/**
 * Chrome do laboratorio: a barra fina que fica sobre as paginas de app
 * (DAS v2.3, secao 3).
 *
 * A barra e a fronteira entre a ferramenta e o alvo. Ela existe porque quem
 * conduz a oficina precisa ler o modo a distancia, mas ela nao pode parecer parte
 * do site: por isso e baixa, grafite, sem o logotipo de nenhum dos dois apps, e
 * carrega o escudo da oficina em vez da marca do banco ou do portal de receitas.
 *
 * Tres coisas e nada mais: em que oficina estamos, em que app, e em que modo.
 * Nenhum nome de cenario e nenhum numero de etapa. O roteiro mora no console
 * /palco, nao na tela que a plateia esta olhando.
 *
 * A barra e montada por codigo em toda pagina que nao trae `data-lab-chrome="ausente"`
 * no <body> -- as paginas de ferramenta (o lancador na raiz e o proprio /palco)
 * montam o controle de modo no corpo delas e dispensam a barra.
 */

import {
  aplicarModoNoDocumento,
  definirModo,
  obterModo,
  reiniciarLab,
  rotuloDoModo,
  LAB_MODO_SAFE,
  LAB_MODO_VULN,
} from './lab.js';

/** Nome da oficina, constante em toda pagina. O app mostra o nome dele. */
const NOME_OFICINA = 'Oficina SQLi e XSS';

/**
 * Como cada contexto se apresenta na barra.
 *
 * O texto e neutro de proposito: `data-app` vem do <body> e o valor aqui e o
 * nome do produto, nunca o do cenario.
 */
const APPS = {
  finbank: 'FinBank',
  cheflab: 'ChefLab',
};

function elemento(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) {
    no.className = classe;
  }
  if (texto !== undefined) {
    no.textContent = texto;
  }
  return no;
}

/**
 * Controle segmentado de modo.
 *
 * Exportado porque o lancador e o console usam o mesmo controle, com outros
 * tokens. `aoTrocar` existe por um motivo especifico: na barra e no lancador o
 * destino e `definirModo`, que recarrega a pagina porque o app precisa ser
 * redesenhado. No console NAO pode recarregar — quem esta olhando essa tela e o
 * instrutor, e perder o roteiro no meio de uma demonstracao seria pior que
 * qualquer conveniencia. Passando um callback proprio, o console troca o modo
 * sem navegar.
 *
 * @param {HTMLElement} alvo container onde o controle entra.
 * @param {string} modo modo a marcar como ativo.
 * @param {(modo: string) => void} [aoTrocar] acao ao clicar num segmento.
 */
export function montarControleModo(alvo, modo, aoTrocar = definirModo) {
  const container = elemento('div', 'modo-controle');

  for (const valor of [LAB_MODO_VULN, LAB_MODO_SAFE]) {
    const botao = elemento('button', 'modo-opcao', rotuloDoModo(valor));
    botao.type = 'button';
    botao.dataset.modo = valor;
    botao.setAttribute('aria-pressed', String(valor === modo));
    botao.addEventListener('click', () => aoTrocar(valor));
    container.append(botao);
  }

  alvo.replaceChildren(container);
  return container;
}

/** Marca o segmento ativo sem remontar o controle (usado apos `definirModo`). */
function marcarModoAtivo(modo) {
  // Anotacao apenas para o `tsc --checkJs`: `querySelectorAll` devolve
  // `Element`, e `dataset` existe em `HTMLElement`. Nada muda em runtime.
  for (const botao of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.modo-opcao')
  )) {
    botao.setAttribute('aria-pressed', String(botao.dataset.modo === modo));
  }
}

/** Monta a barra e a devolve, ja inserida como primeiro filho do <body>. */
function montarBarra(modo) {
  const barra = elemento('header', 'barra');
  const interno = elemento('div', 'barra__interno');

  const marca = elemento('a', 'barra__marca');
  marca.href = '/';
  const escudo = elemento('img', 'barra__escudo');
  escudo.src = '/img/escudo-liga.png';
  escudo.alt = '';
  marca.append(escudo, elemento('span', 'barra__titulo', NOME_OFICINA));

  const app = APPS[document.body.dataset.app ?? ''] ?? 'Laboratório';
  const contexto = elemento('span', 'barra__contexto');
  const rotuloApp = elemento('b', null, app);
  contexto.append(rotuloApp);

  const acoes = elemento('div', 'barra__acoes');
  const controle = montarControleModo(elemento('div'), modo);
  const restaurar = elemento('button', 'botao botao--mini', 'Restaurar');
  restaurar.type = 'button';
  restaurar.addEventListener('click', reiniciarLab);
  const console = elemento('a', 'botao botao--mini', 'Console');
  console.href = '/palco';

  acoes.append(controle, restaurar, console);
  interno.append(marca, contexto, acoes);
  barra.append(interno);

  document.body.prepend(barra);
  return barra;
}

/**
 * Bootstrap de toda pagina de app.
 *
 * Le o modo uma unica vez e so entao monta a barra, para que a pagina nunca
 * pisque no modo errado -- nem no texto, nem na cor.
 *
 * @returns {Promise<string>} o modo vigente.
 */
export async function iniciarChrome() {
  let modo = LAB_MODO_VULN;

  try {
    modo = await obterModo();
  } catch (erro) {
    console.warn('[lab] nao foi possivel ler o modo, assumindo vuln:', erro.message);
  }

  aplicarModoNoDocumento(modo);

  // O lancador e o console trazem `data-lab-chrome="ausente"`: sao ferramentas
  // de tela cheia e montam o controle de modo no corpo.
  if (document.body.dataset.labChrome !== 'ausente') {
    montarBarra(modo);
  }

  for (const alvo of document.querySelectorAll('[data-lab-modo]')) {
    montarControleModo(/** @type {HTMLElement} */ (alvo), modo);
  }
  marcarModoAtivo(modo);

  document.dispatchEvent(new CustomEvent('lab:pronto', { detail: { modo } }));

  return modo;
}
