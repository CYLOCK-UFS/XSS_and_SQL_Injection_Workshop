/**
 * Utilitarios compartilhados do laboratorio (DAS v2.2, secoes 3 e 7).
 *
 * Este modulo monta a barra de modo em qualquer pagina que declare os
 * marcadores data-lab-modo e data-lab-reset, para que o toggle de modo e o
 * reset sejam escritos uma unica vez.
 *
 * REGRA IMPORTANTE: todo texto vindo do servidor e escrito com textContent,
 * nunca com innerHTML. Os paineis de debug deste arquivo existe justamente para
 * deixar a saida do servidor visivel durante a demo, e nao podem se tornar um
 * segundo ponto de injecao. O unico innerHTML do laboratorio e o sink XSS
 * documentado em src/public/receitas/receitas.js (DAS 4.4).
 */

const MODO_VULN = 'vuln';
const MODO_SAFE = 'safe';

const ROTULOS = { [MODO_VULN]: 'Vulneravel', [MODO_SAFE]: 'Seguro' };

/* -------------------------------------------------------------------------- */
/* Contrato de modo (DAS, secao 3)                                            */
/* -------------------------------------------------------------------------- */

/** Le o modo vigente. O cookie lab_mode e httpOnly: so o servidor pode ler. */
export async function obterModo() {
  const resposta = await fetch('/api/mode', {
    headers: { Accept: 'application/json' },
  });
  const dados = await resposta.json();
  return dados.mode;
}

/** POST /api/mode e recarrega: o backend decide o que cada pagina renderiza. */
export async function definirModo(modo) {
  await fetch('/api/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: modo }),
  });
  window.location.reload();
}

/** POST /api/reset: restaura o estado inicial completo do laboratorio. */
export async function reiniciarLab(evento) {
  const botao = evento?.currentTarget ?? null;
  const rotuloOriginal = botao?.textContent;

  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Restaurando...';
  }

  try {
    const resposta = await fetch('/api/reset', { method: 'POST' });
    if (!resposta.ok) {
      throw new Error(`reset respondeu ${resposta.status}`);
    }
    window.location.reload();
  } catch (erro) {
    if (botao) {
      botao.disabled = false;
      botao.textContent = rotuloOriginal;
    }
    window.alert(`Falha ao restaurar o laboratorio: ${erro.message}`);
  }
}

/** Pintura do modo no <html>, para o CSS escolher a cor de destaque. */
export function aplicarModoNoDocumento(modo) {
  document.documentElement.dataset.modo = modo;
}

/* -------------------------------------------------------------------------- */
/* Barra de modo e reset                                                      */
/* -------------------------------------------------------------------------- */

function montarControleModo(alvo) {
  const container = document.createElement('div');
  container.className = 'modo-controle';

  const rotulo = document.createElement('span');
  rotulo.className = 'modo-controle__rotulo';
  rotulo.textContent = 'Modo';
  container.append(rotulo);

  for (const modo of [MODO_VULN, MODO_SAFE]) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'modo-opcao';
    botao.textContent = ROTULOS[modo];
    botao.dataset.modo = modo;
    botao.setAttribute('aria-pressed', 'false');
    botao.addEventListener('click', () => definirModo(modo));
    container.append(botao);
  }

  alvo.replaceChildren(container);
}

function marcarModoAtivo(modo) {
  // Anotacao apenas para o `tsc --checkJs`: `querySelectorAll` devolve
  // `Element`, e `dataset` existe em `HTMLElement`. Nada muda em runtime.
  for (const botao of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.modo-opcao')
  )) {
    botao.setAttribute('aria-pressed', String(botao.dataset.modo === modo));
  }
}

/* -------------------------------------------------------------------------- */
/* Formatacao e exibicao                                                      */
/* -------------------------------------------------------------------------- */

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** DATETIME do MySQL chega como string ISO no JSON; tolera valor invalido. */
export function formatarData(valor) {
  if (!valor) {
    return '';
  }
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? String(valor) : DATA_HORA.format(data);
}

/**
 * Mostra a resposta bruta da API. E aqui que o aluno ve o vazamento: as linhas
 * extras do UNION e a mensagem XPATH do cenario 2 ficam visiveis no JSON.
 */
export function mostrarJson(elemento, dados) {
  if (!elemento) {
    return;
  }
  elemento.textContent = JSON.stringify(dados, null, 2);
  elemento.classList.remove('oculto');
}

export function ocultar(elemento) {
  if (elemento) {
    elemento.classList.add('oculto');
  }
}

/** Substitui o conteudo de um container por nos de texto, sem parsear HTML. */
export function preencherTexto(elemento, texto) {
  if (elemento) {
    elemento.textContent = texto;
  }
}

/* -------------------------------------------------------------------------- */
/* Roteiro: payload clicavel                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Liga cada bloco .payload a um campo de entrada, para o apresentador nao ter
 * que colar o payload na mao durante a demonstracao ao vivo. O texto do bloco
 * precisa estar sem quebras de linha, porque e lido via textContent.
 */
function montarRoteiros() {
  // Anotacao apenas para o `tsc --checkJs`: sem ela `bloco` e `Element` e o
  // `dataset.alvo` abaixo seria reportado como propriedade inexistente.
  for (const bloco of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.payload[data-exemplo]')
  )) {
    // Todo `data-alvo` do laboratorio aponta para um campo de texto (textarea
    // no ChefLab, input no FinBank), e `value` so existe nos subtipos de
    // formulario -- por isso o cast, e nao `HTMLElement` generico.
    const alvo = /** @type {HTMLTextAreaElement | HTMLInputElement} */ (
      document.querySelector(bloco.dataset.alvo)
    );
    if (!alvo) {
      continue;
    }

    const exemplo = bloco.textContent;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao botao--primario';
    botao.textContent = 'Usar no campo';
    botao.addEventListener('click', () => {
      alvo.value = exemplo;
      alvo.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    bloco.insertAdjacentElement('afterend', botao);
  }
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Executa em toda pagina do laboratorio. Busca o modo uma unica vez e so entao
 * monta a barra, para que a pagina nunca pisque no modo errado.
 */
export async function iniciarLaboratorio() {
  let modo = MODO_VULN;

  try {
    modo = await obterModo();
  } catch (erro) {
    console.warn('[lab] nao foi possivel ler o modo, assumindo vuln:', erro.message);
  }

  aplicarModoNoDocumento(modo);

  for (const alvo of document.querySelectorAll('[data-lab-modo]')) {
    montarControleModo(alvo);
  }
  marcarModoAtivo(modo);

  for (const alvo of document.querySelectorAll('[data-lab-reset]')) {
    alvo.addEventListener('click', reiniciarLab);
  }

  montarRoteiros();

  document.dispatchEvent(
    new CustomEvent('lab:pronto', { detail: { modo } }),
  );

  return modo;
}

export const LAB_MODO_VULN = MODO_VULN;
export const LAB_MODO_SAFE = MODO_SAFE;
