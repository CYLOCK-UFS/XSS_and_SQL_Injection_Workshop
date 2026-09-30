/**
 * Utilitarios compartilhados do laboratorio (DAS v2.2, secoes 3 e 7).
 *
 * Este modulo cuida do CONTRATO DE MODO e da formatacao. Ele nao desenha nada:
 * a barra fina do laboratorio e o console do instrutor montam o proprio DOM
 * em src/public/js/chrome.js e src/public/js/palco.js, e as paginas de app
 * tratam do proprio conteudo.
 *
 * REGRA IMPORTANTE: todo texto vindo do servidor e escrito com textContent,
 * nunca com innerHTML. Os paineis de debug deste laboratorio existem justamente
 * para deixar a saida do servidor visivel durante a demonstracao, e nao podem
 * se tornar um segundo ponto de injecao. O unico innerHTML do laboratorio e o
 * sink XSS documentado em src/public/cheflab/receita.js (DAS 4.4).
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

/** Pintura do modo no <html>, para o CSS escolher a cor do chrome. */
export function aplicarModoNoDocumento(modo) {
  document.documentElement.dataset.modo = modo;
}

/** Rotulo legivel de um modo, para texto fora do botao segmentado. */
export function rotuloDoModo(modo) {
  return ROTULOS[modo] ?? ROTULOS[MODO_VULN];
}

/* -------------------------------------------------------------------------- */
/* Formatacao e exibicao                                                      */
/* -------------------------------------------------------------------------- */

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/**
 * Componentes de data na forma `AAAA-MM-DD HH:MM:SS` (o que o MySQL devolve
 * para DATETIME com `dateStrings: true`) ou `AAAA-MM-DDTHH:MM:SS`.
 *
 * O grupo `(?:Z|[+-]\d{2}:?\d{2})` no fim existe para tornar a regex ancorada
 * de verdade: sem ele, `A` casaria com o comeco de `AAAA` e o primeiro grupo
 * seria sempre `A`.
 */
const COMPONENTES_DATA =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Extrai os componentes de data e monta um instante ancorado em UTC.
 *
 * A ancora em UTC e o que torna a formatacao correta sem fuso: os componentes
 * sao lidos de volta com `timeZone: 'UTC'`, entao o valor impresso e sempre o
 * que estava escrito no DATETIME. Nao ha conversao de fuso no caminho, e
 * portanto nao existe o caso em que a hora exibida depende do lugar de onde a
 * pagina foi aberta.
 *
 * @param {string} valor
 * @returns {Date | null} null quando o texto nao e uma data reconhecivel.
 */
export function instanteDeDataHora(valor) {
  const partes = String(valor).trim().match(COMPONENTES_DATA);
  if (!partes) {
    return null;
  }

  return new Date(
    Date.UTC(
      Number(partes[1]),
      Number(partes[2]) - 1,
      Number(partes[3]),
      Number(partes[4]),
      Number(partes[5]),
      Number(partes[6] ?? 0),
    ),
  );
}

/**
 * DATETIME do MySQL chega como texto `AAAA-MM-DD HH:MM:SS`: sao componentes de
 * parede, nao um instante. Tolera valor invalido.
 */
export function formatarData(valor) {
  if (!valor) {
    return '';
  }

  const instante = instanteDeDataHora(valor);
  return instante === null ? String(valor) : DATA_HORA.format(instante);
}

/**
 * Normaliza o valor para o atributo `datetime` de um <time>.
 *
 * A especificacao HTML aceita `AAAA-MM-DDTHH:MM:SS`, com o separador `T`, e
 * nao a forma do MySQL, que usa espaco. Sem esta conversao o atributo fica
 * invalido: o navegador costuma aceitar assim mesmo, mas a maquina de estados
 * do HTML nao reconhece o valor.
 *
 * @param {string} valor
 * @returns {string}
 */
export function paraDataTime(valor) {
  return String(valor ?? '').replace(' ', 'T');
}

/**
 * Mostra a resposta crua da API dentro de um <pre>.
 *
 * O <details> que envolve esse <pre> e estatico no HTML de cada pagina: o
 * laboratorio mostra a resposta quando e util e a esconde quando atrapalha.
 *
 * @param {Element | null} elemento o <pre> de destino.
 * @param {unknown} dados
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

/**
 * Copia texto para a area de transferencia.
 *
 * Existe para o console do instrutor: os payloads ficaram fora das paginas de
 * app, e o caminho mais curto para o campo e a area de transferencia -- colar
 * direto no input, sem passar por um botao que preenche o campo por baixo dos
 * panos, que e o que a afordancia "Usar no campo" fazia.
 *
 * A APIClipboard exige contexto seguro, o laboratorio roda em http://127.0.0.1
 * e conta como seguro. O `execCommand` fica como reserva para os navegadores
 * onde a promessa rejeita.
 *
 * @param {string} texto
 * @returns {Promise<boolean>} se a copia foi concluida.
 */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();

    let copiou = false;
    try {
      copiou = document.execCommand('copy');
    } catch {
      copiou = false;
    }

    area.remove();
    return copiou;
  }
}

export const LAB_MODO_VULN = MODO_VULN;
export const LAB_MODO_SAFE = MODO_SAFE;
export const LAB_ROTULOS = ROTULOS;
