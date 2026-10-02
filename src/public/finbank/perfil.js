/* =============================================================================
   FinBank - XSS armazenado na area de perfil (DAS v2.4, secao 8)
   =============================================================================
   Segunda superficie de XSS armazenado do laboratorio, e a primeira fora do
   ChefLab. A diferenca entre as duas paginas nao esta no banco nem no
   transporte: e o PRODUTO. O mesmo comportamento, a mesma aplicacao, outra
   tela -- e e isso que muda a conclusao do aluno.

   A divisao em dois renderizadores no MESMO arquivo e deliberada, e e a mesma
   razao de src/public/cheflab/receita.js: o que muda entre os modos nao e a
   gravacao, e a SAIDA.

     modo vulneravel -> atribuir innerHTML    (o navegador analisa a marcacao)
     modo seguro     -> atribuir textContent (o texto entra como texto)

   O INSERT em src/repositories/perfilRepository.js e parametrizado nos dois
   modos, e `id_cliente` vai como placeholder nos dois. A marcacao volta
   intacta da API; e por isso que o cenario se chama XSS ARMAZENADO: o payload
   dispara a cada visita, sem nova interacao.

   Esta pagina nao tem aviso de modo. Quem conduz troca o modo na barra e ve a
   descricao mudar de comportamento sem que o site tenha se revelado.

   ids e classes exportados para o CSS e para o E2E sao contrato: #perfil-painel,
   #perfil-descricao, #perfil-vazia, #perfil-cliente, #perfil-registro,
   #perfil-resumo, #aviso-perfil, #lab-eventos, #json-resposta.
   ============================================================================= */

// Caminho RELATIVO, e nao `/js/finbank.js`. Um import com caminho absoluto
// funciona no navegador -- o servidor responde `/js/...` pelo static -- mas o
// `tsc --checkJs` nao tem como resolver esse caminho e acusa TS2307. E o
// arquivo tem typecheck: um erro aqui apareceria como "modulo inexistente", que
// e o tipo de mensagem que faz alguem procurar um arquivo que existe.
import { buscarConta, iniciarFinBank } from '../js/finbank.js';
import { mostrarJson, preencherTexto } from '../js/lab.js';

const modo = await iniciarFinBank();

const formulario = /** @type {HTMLFormElement} */ (
  document.querySelector('#formulario-perfil')
);

/**
 * As anotacoes abaixo existem so para o `tsc --checkJs`.
 *
 * `querySelector` devolve `Element`, que nao tem `value` nem `disabled`: o tipo
 * real do campo de texto e um `HTMLInputElement`, o da area de descricao e um
 * `HTMLTextAreaElement`, o do botao e um `HTMLButtonElement`. Sem estas
 * anotacoes o typecheck acusaria propriedade inexistente. Nenhuma delas altera
 * o runtime. Mesma convencao de src/public/cheflab/receita.js.
 */
const campoCliente = /** @type {HTMLInputElement} */ (
  document.querySelector('#perfil-id-cliente')
);
const campoDescricao = /** @type {HTMLTextAreaElement} */ (
  document.querySelector('#perfil-descricao-forma')
);

/* Contrato com perfil.html e com o E2E: nao renomear. */
const painel = document.querySelector('#perfil-painel');
const descricao = document.querySelector('#perfil-descricao');
const vazio = document.querySelector('#perfil-vazio');
const rotuloCliente = document.querySelector('#perfil-cliente');
const rotuloRegistro = document.querySelector('#perfil-registro');
const resumo = document.querySelector('#perfil-resumo');
const aviso = document.querySelector('#aviso-perfil');
const json = document.querySelector('#json-resposta');

/**
 * O cliente logado no cabecalho, o mesmo CLI001 de src/public/js/finbank.js.
 *
 * A pagina abre nele porque um formulario vazio na entrada faz o aluno suspeitar
 * do laboratorio antes de chegar no cenario -- a mesma razao do extrato, em
 * src/public/finbank/extrato.html.
 *
 * A query string tem precedencia, e nao por enfeite: e o que permite ao botao
 * de retorno do console do instrutor reconstruir a tela EXATA da demonstracao
 * (DAS v2.4, secao 16.2). Sem isto, `/finbank/perfil?id_cliente=CLI002` abriria
 * o perfil do CLI001 e o roteiro apontaria para a mesa errada.
 */
const CLIENTE_INICIAL =
  new URLSearchParams(window.location.search).get('id_cliente') || 'CLI001';

campoCliente.value = CLIENTE_INICIAL;

formulario.addEventListener('submit', salvar);

/* -------------------------------------------------------------------------- */
/* Gravacao: identica nos dois modos                                          */
/* -------------------------------------------------------------------------- */

/**
 * Salva a descricao e recarrega.
 *
 * Identico nos dois modos: o risco nao esta em gravar. O aviso de sucesso usa
 * `preencherTexto`, e nao uma interpolacao em HTML, justamente porque um
 * laboratorio que ensina a escapar texto nao pode injetar o texto de um erro
 * na propria pagina.
 */
async function salvar(evento) {
  evento.preventDefault();

  const botao = /** @type {HTMLButtonElement} */ (
    formulario.querySelector('button[type="submit"]')
  );
  botao.disabled = true;
  preencherTexto(aviso, 'salvando...');

  try {
    const resposta = await fetch('/banco/perfil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_cliente: campoCliente.value,
        descricao_perfil: campoDescricao.value,
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      preencherTexto(aviso, dados.erro ?? 'Falha ao salvar o perfil.');
      return;
    }

    preencherTexto(aviso, `perfil salvo no registro #${dados.perfil.id_perfil}.`);
    campoDescricao.value = '';
    await carregar();
  } finally {
    botao.disabled = false;
  }
}

async function carregar() {
  const parametros = new URLSearchParams();
  parametros.set('id_cliente', campoCliente.value.trim());

  const resposta = await fetch(`/banco/perfil?${parametros.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const dados = await resposta.json();

  mostrarJson(json, dados);

  if (resposta.status === 404) {
    // Cadastro sem perfil e um estado normal da tela, nao um erro: o cliente
    // existe e o texto ainda nao foi preenchido.
    mostrarSemPerfil();
    return;
  }

  if (!resposta.ok) {
    painel.classList.add('oculto');
    vazio.classList.add('oculto');
    preencherTexto(aviso, dados.erro ?? 'Falha ao consultar o perfil.');
    return;
  }

  desenhar(dados.perfil);
}

/**
 * Consulta o cliente do cabecalho para nomear o perfil.
 *
 * `buscarConta` nunca lanca -- devolve `null` se a API falhar -- entao esta tela
 * continua funcionando sem o cartao do topo. E por isso que o nome aparece aqui
 * em vez de vir da resposta do perfil: a rota `/banco/perfil` responde sobre a
 * TABELA `perfis_clientes`, e juntar um JOIN em `clientes` ali faria a rota do
 * cenario 5 depender de uma tabela que ele nao tem por que conhecer.
 */
async function nomeDoCliente(idCliente) {
  const cliente = await buscarConta(idCliente);
  return cliente ? String(cliente.nome) : idCliente;
}

function mostrarSemPerfil() {
  painel.classList.add('oculto');
  vazio.classList.remove('oculto');
  preencherTexto(resumo, 'sem descricao gravada para este cliente.');
}

function desenhar(perfil) {
  painel.classList.remove('oculto');
  vazio.classList.add('oculto');

  // O id do cliente e o do registro vem de colunas que o sistema preencheu, e
  // nao do texto que o usuario escreveu. Eles passam por `preencherTexto` mesmo
  // no modo vulneravel, para que o sink da pagina continue sendo UM: o campo de
  // descricao. Um segundo sink aqui transformaria a exibicao em duas
  // Vulnerabilidades para explicar, e o aluno nao saberia qual das duas o
  // roteiro quer que ele quebre.
  preencherTexto(rotuloCliente, String(perfil.id_cliente));
  preencherTexto(rotuloRegistro, `registro #${perfil.id_perfil}`);
  preencherTexto(
    resumo,
    `descricao de ${perfil.id_cliente}, salva por voce mesmo.`,
  );

  if (modo === 'vuln') {
    renderizarComInnerHTML(perfil.descricao_perfil);
  } else {
    renderizarComTextContent(perfil.descricao_perfil);
  }

  void nomeDoCliente(String(perfil.id_cliente)).then((nome) => {
    preencherTexto(rotuloCliente, nome);
  });
}

/* -------------------------------------------------------------------------- */
/* Saida: o unico ponto que muda entre os modos                               */
/* -------------------------------------------------------------------------- */

/**
 * PONTO VULNERAVEL
 *
 * Atribuir a `innerHTML` faz o navegador ANALISAR o conteudo recebido. Se
 * `descricao_perfil` for
 *   <img src=x onerror=alert(document.domain)>
 * o atributo `onerror` vira um manipulador de evento executado pela pagina, e o
 * codigo roda com a origem do laboratorio -- que e a origem do banco inteiro,
 * e nao de um post isolado. Vale o mesmo para `<script>`, `<iframe>` e para
 * qualquer elemento com atributo de evento.
 *
 * Por isso o cenario se chama ARMAZENADO: o texto foi gravado numa visita
 * anterior e dispara em toda visita seguinte, sem nova interacao de quem abre a
 * tela. Trocar por `textContent` e a correcao, e e a unica diferenca entre os
 * dois renderizadores abaixo.
 */
function renderizarComInnerHTML(texto) {
  descricao.innerHTML = String(texto ?? '');
}

/**
 * MITIGACAO
 *
 * `textContent` cria um no de texto: o navegador exibe `<img src=x ...>` como
 * os caracteres que sao, e nao como um elemento. Nao existe interpretacao de
 * markup neste caminho, entao nao existe ponto de injecao, por mais que o
 * perfil tente.
 *
 * A perda de formatacao e o preco: negrito, lista e link na bio viram texto.
 * Quem usa rich text precisa de uma lista de tags permitidas e de construcao do
 * no a partir dela -- e nao de `innerHTML` com o texto do usuario dentro.
 */
function renderizarComTextContent(texto) {
  descricao.textContent = String(texto ?? '');
}

await carregar();