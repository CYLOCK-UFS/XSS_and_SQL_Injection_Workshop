/**
 * Cabecalho compartilhado das paginas do FinBank (DAS v2.3, secao 4).
 *
 * A barra de navegacao e a conta logada aparecem nas cinco telas do autoatendimento
 * e sao a mesma coisa em todas. O que muda entre as telas e o `aria-current` do
 * link ativo, e esse atributo fica no HTML de cada pagina: e uma propriedade do
 * documento, nao um estado que o script precise inferir do caminho.
 *
 * Este modulo tem duas tarefas e nenhuma outra: subir o chrome do laboratorio e
 * preencher a conta. Nao busca extrato, nao monta tabela, nao decide o que a
 * pagina mostra.
 */

import { iniciarChrome } from './chrome.js';
import { preencherTexto } from './lab.js';

/**
 * Conta exibida como "logada".
 *
* E o cliente CLI001 do init.sql. O laboratorio nao tem autenticacao: quem
 * precisa de um cadastro de verdade e um sistema de producao, nao um
 * autoatendimento de tres cenarios. Enquanto nao ha sessao, mostrar uma conta
 * fixa e mais honesto do que fingir um "cliente" que o aluno nao escolheu.
 */
const CONTA_EXIBIDA = 'CLI001';

/** Iniciais para o avatar, a partir do nome completo. */
function iniciais(nome) {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) {
    return '--';
  }

  const primeira = partes[0][0] ?? '';
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] ?? '' : '';
  return (primeira + ultima).toUpperCase();
}

/**
 * Le um cliente de `clientes`.
 *
 * @param {string} id
 * @returns {Promise<LinhaSql | null>} null quando a conta nao existe ou a API
 *   nao respondeu -- nunca lanca, porque nenhuma tela do autoatendimento pode
 *   quebrar por causa do cartao do cabecalho.
 */
export async function buscarConta(id = CONTA_EXIBIDA) {
  try {
    const resposta = await fetch(
      `/banco/cliente/${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!resposta.ok) {
      return null;
    }

    const dados = await resposta.json();
    return /** @type {LinhaSql} */ (dados.cliente);
  } catch (erro) {
    console.warn('[finbank] cliente indisponivel:', erro.message);
    return null;
  }
}

/** Preenche o cartao de conta do cabecalho. */
async function pintarConta() {
  const cliente = await buscarConta();
  if (!cliente) {
    return;
  }

  preencherTexto(document.querySelector('#conta-nome'), String(cliente.nome));
  preencherTexto(
    document.querySelector('#conta-id'),
    `conta ${cliente.id_cliente}`,
  );
  preencherTexto(
    document.querySelector('#conta-avatar'),
    iniciais(String(cliente.nome)),
  );
}

/**
 * Ponto de entrada das paginas do FinBank.
 *
 * @returns {Promise<string>} o modo vigente, ja pintado no <html>.
 */
export async function iniciarFinBank() {
  const modo = await iniciarChrome();
  await pintarConta();
  return modo;
}

/** A conta mostrada como logada, usada tambem pelo cartao de saldo da home. */
export const CONTA_INICIAL = CONTA_EXIBIDA;
