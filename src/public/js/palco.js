/**
 * Console do instrutor (DAS v2.3, secao 6).
 *
 * Tudo que NAO pode aparecer na tela da plateia mora aqui: o roteiro de cada
 * cenario, os payloads prontos e um inspetor para sondar as rotas sem trocar de
 * aba no meio da demonstracao.
 *
 * A separacao nao e estetica. O aluno precisa ver um produto -- um banco, um
 * portal de receitas -- e nao uma ferramenta de ataque com o gabarito colado
 * na tela. Aqui o gabarito pode estar, porque aqui so olha quem conduz.
 *
 * Este arquivo nao desenha o conteudo de nenhum app e nao escreve em nenhuma
 * pagina de app. Ele fala com as mesmas rotas publicas que o aluno usa, mais
 * `/api/mode`, `/api/reset` e `/api/health`.
 *
 * NAO ha innerHTML neste arquivo, nem nos outros scripts do cliente. E a regra
 * que a oficina repete sobre saida de dado do servidor vale para as ferramentas
 * tambem: um painel do instrutor nao e um lugar seguro por ser "so do
 * instrutor". O roteiro e uma constante local e os payloads sao texto puro
 * dentro de <code>, com textContent.
 */

import {
  aplicarModoNoDocumento,
  copiarTexto,
  obterModo,
  reiniciarLab,
  rotuloDoModo,
} from './lab.js';
import { montarControleModo } from './chrome.js';

/* -------------------------------------------------------------------------- */
/* Roteiro e payloads                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Os quatro cenarios, na ordem da apresentacao.
 *
 * `sonda` diz ao inspetor qual rota e qual parametro aquele cenario ataca: quem
 * troca de cenario troca tambem o alvo do inspector, e nao precisa lembrar qual
 * nome de query string usar.
 *
 * Nos passos, o que esta entre crases vira <code>. E a unica marcacao do
 * roteiro, e ela e montada por nos de texto -- ver `passoComMarcacao`.
 */
const CENARIOS = [
  {
    id: 'uniao',
    nome: 'UNION em agencias',
    alvo: '/finbank/agencias',
    descricao: 'SQLi por UNION: quatro colunas, quatro dados de cartao.',
    passos: [
      'Abra `/finbank/agencias` e filtre por `Sao Paulo`. Duas agencias aparecem.',
      'Troque a cidade por `Atlantis`: zero resultados, sem erro. A consulta aceitou o texto.',
      "Fechando a aspa e abrindo outra, o payload entra no meio da consulta. Copie o segundo payload do painel ao lado.",
      'Os cartoes aparecem como se fossem agencias: quatro campos, na ordem da tabela.',
      'Repita em `Seguro`. A mesma string nao altera nada, e a lista volta vazia.',
    ],
    payloads: [
      {
        rotulo: 'Cidade inexistente',
        valor: 'Atlantis',
        nota: 'Nenhum erro: a consulta rodou e nao achou nada.',
      },
      {
        rotulo: 'UNION SELECT, quatro colunas',
        valor:
          "' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito -- ",
        nota: 'O espaco depois de -- fecha o comentario do MySQL.',
      },
      {
        rotulo: 'Dado que ja estava ali',
        valor:
          "' UNION SELECT CONCAT(nome_agencia, ' - ', cidade), endereco, telefone, gerente FROM agencias -- ",
        nota: 'Prova que o vazamento tambem alcanca dados que o aluno ja via.',
      },
    ],
    sonda: { rota: '/banco/agencias', parametro: 'cidade' },
  },
  {
    id: 'erro',
    nome: 'Erro do MySQL no extrato',
    alvo: '/finbank/extrato',
    descricao: 'SQLi baseada em erro: o detalhe da consulta volta na resposta.',
    passos: [
      'Abra `/finbank/extrato`. A conta `CLI001` ja vem carregada.',
      'Repare no bloco `Detalhe tecnico` no meio da tela: ele existe, fechado e vazio.',
      'Em `Vulneravel`, cole o payload de `EXTRACTVALUE` no campo da conta.',
      'A tela mostra HTTP 500 e, ao abrir o detalhe, a mensagem do MySQL com a senha sintetica do administrador.',
      'Em `Seguro`, o mesmo payload devolve a mensagem generica e o bloco de detalhe nem aparece.',
    ],
    payloads: [
      {
        rotulo: 'Conta valida',
        valor: 'CLI001',
        nota: 'O caminho normal: tres lancamentos.',
      },
      {
        rotulo: 'EXTRACTVALUE, extrai a senha',
        valor:
          "98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- ",
        nota: 'O XPath invalido obriga o MySQL a devolver o resultado da subquery.',
      },
      {
        rotulo: 'EXTRACTVALUE, confirma o usuario',
        valor:
          "98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT username FROM administradores WHERE id_admin='1'))) -- ",
        nota: 'Trocar a coluna troca o dado: o erro carrega o que voce pediu.',
      },
    ],
    sonda: { rota: '/banco/extrato', parametro: 'id_conta' },
  },
  {
    id: 'oraculo',
    nome: 'Oraculo booleano no comunicado',
    alvo: '/finbank/noticia',
    descricao: 'SQLi inferencial: a resposta e 200 ou 404, e isso basta.',
    passos: [
      'Abra `/finbank/noticia`. O comunicado 5 aparece: essa e a linha de base.',
      'Troque o id por `999999`: a tela diz que nao foi encontrado. Este 404 e o sinal.',
      "Use `' OR 1=1 -- `: volta 200. Use `' AND 1=2 -- `: volta 404.",
      'A condicao booleana virou resposta HTTP. Nada de `SELECT` escrito na tela.',
      "Para reconstruir um texto, posicione a condicao com `id='1' AND SUBSTRING(...)` e varie o alfabeto.",
    ],
    payloads: [
      {
        rotulo: 'Linha de base',
        valor: '5',
        nota: 'Existe: 200 com o comunicado.',
      },
      {
        rotulo: 'Condicao verdadeira',
        valor: "' OR 1=1 -- ",
        nota: 'Tautologia: 200.',
      },
      {
        rotulo: 'Condicao falsa',
        valor: "' AND 1=2 -- ",
        nota: 'Nunca verdadeira: 404.',
      },
      {
        rotulo: 'Um caractere da posicao 1',
        valor: "' OR (id='1' AND SUBSTRING(titulo,1,1)='F') -- ",
        nota: 'Com BINARY no lugar de SUBSTRING, a comparacao volta a distinguir caixa.',
      },
    ],
    sonda: { rota: '/banco/noticia', parametro: 'id' },
  },
  {
    id: 'xss',
    nome: 'XSS armazenado nos comentarios',
    alvo: '/cheflab/receita',
    descricao: 'XSS armazenado: o codigo roda sozinho, a cada visita.',
    passos: [
      'Abra `/cheflab/receita` e role ate os comentarios da receita.',
      'Em `Vulneravel`, publique o primeiro payload no campo de comentario.',
      'O `alert` dispara na hora. Recarregue a pagina: dispara de novo, sem clicar em nada.',
      'No mesmo modo, cole o segundo payload no campo `Seu nome`: o autor e um segundo sink.',
      'Em `Seguro`, os dois payloads aparecem como texto, e nenhum dialogo abre.',
    ],
    payloads: [
      {
        rotulo: 'Comentario, dispara sozinho',
        valor: '<img src=x onerror=alert(document.domain)>',
        nota: 'Sem interacao: e o que torna o XSS armazenado.',
      },
      {
        rotulo: 'Nome do autor, segundo sink',
        valor: '<img src=x onerror=alert(1)>',
        nota: 'O roteiro antigo citava so o texto do comentario.',
      },
      {
        rotulo: 'Marca visivel, sem alerta',
        valor: '<b>teste</b>',
        nota: 'Serve para mostrar a linha renderizada sem interromper a aula.',
      },
    ],
    sonda: { rota: '/banco/comunicados', parametro: '' },
  },
];

/** Rotas oferecidas pelo inspetor, com o parametro de cada uma. */
const ROTAS_INSPETOR = [
  { rota: '/banco/agencias', parametro: 'cidade' },
  { rota: '/banco/extrato', parametro: 'id_conta' },
  { rota: '/banco/noticia', parametro: 'id' },
  { rota: '/banco/comunicados', parametro: '' },
];

/* -------------------------------------------------------------------------- */
/* Atalhos de DOM                                                             */
/* -------------------------------------------------------------------------- */

/**
 * As anotacoes `/** @type {HTMLSelectElement} *\/` sao para o `tsc --checkJs`:
 * `querySelector` devolve `Element`, que nao tem `value`. Nenhuma delas altera o
 * runtime. Ver a mesma explicacao em src/public/cheflab/receita.js.
 */
const seletorCenario = /** @type {HTMLSelectElement} */ (
  document.querySelector('#seletor-cenario')
);
const seletorRota = /** @type {HTMLSelectElement} */ (
  document.querySelector('#seletor-rota')
);
const campoParametro = /** @type {HTMLInputElement} */ (
  document.querySelector('#campo-parametro')
);
const campoValor = /** @type {HTMLInputElement} */ (
  document.querySelector('#campo-valor')
);
const botaoSondar = /** @type {HTMLButtonElement} */ (
  document.querySelector('#botao-sondar')
);
const botaoReset = /** @type {HTMLButtonElement} */ (
  document.querySelector('#palco-reset')
);

const alvoAtivo = /** @type {HTMLAnchorElement} */ (
  document.querySelector('#alvo-ativo')
);
const descricaoCenario = document.querySelector('#descricao-cenario');
const listaPassos = document.querySelector('#lista-passos');
const listaPayloads = document.querySelector('#lista-payloads');
const seloModo = document.querySelector('#palco-modo');
const saude = document.querySelector('#palco-saude');
const statusSonda = document.querySelector('#sonda-status');
const corpoSonda = document.querySelector('#sonda-json');
const controleModo = /** @type {HTMLElement} */ (
  document.querySelector('#palco-modo-controle')
);

/* -------------------------------------------------------------------------- */
/* Utilidades locais                                                          */
/* -------------------------------------------------------------------------- */

/** Escreve texto sem passar por innerHTML. */
function preencher(elemento, texto) {
  if (elemento) {
    elemento.textContent = texto;
  }
}

/**
 * Monta um passo de roteiro, com crases virando <code>.
 *
 * O roteiro precisa mostrar o que colar e em qual campo, e o `<code>` e o que
 * distingue as duas coisas a tres metros de distancia. A marcacao e a
 * delimitacao por crases, e cada pedaco entra por `textContent`: nao existe
 * interpretacao de HTML em nenhum ponto deste arquivo.
 */
function passoComMarcacao(texto) {
  const pedacos = texto.split(/`([^`]+)`/g);
  const nos = [];

  pedacos.forEach((pedaco, indice) => {
    if (pedaco === '') {
      return;
    }

    if (indice % 2 === 1) {
      const codigo = document.createElement('code');
      codigo.textContent = pedaco;
      nos.push(codigo);
      return;
    }

    nos.push(document.createTextNode(pedaco));
  });

  return nos;
}

/* -------------------------------------------------------------------------- */
/* Roteiro                                                                    */
/* -------------------------------------------------------------------------- */

/** Cenario corrente, resolvido pelo id do <select>. */
function cenarioAtual() {
  const escolhido = CENARIOS.find((item) => item.id === seletorCenario.value);
  return escolhido ?? CENARIOS[0];
}

function desenharCenario() {
  const cenario = cenarioAtual();

  preencher(descricaoCenario, cenario.descricao);
  preencher(document.querySelector('#alvo-cenario'), `Tela: ${cenario.alvo}`);

  if (alvoAtivo) {
    alvoAtivo.href = cenario.alvo;
    preencher(alvoAtivo, `abrir ${cenario.alvo}`);
  }

  // Passos: numero grande, para quem conduz ler de longe.
  const passos = document.createDocumentFragment();
  cenario.passos.forEach((texto, indice) => {
    const passo = document.createElement('div');
    passo.className = 'passo';

    const numero = document.createElement('span');
    numero.className = 'passo__num';
    numero.textContent = String(indice + 1);

    const corpo = document.createElement('span');
    corpo.className = 'passo__texto';
    corpo.append(...passoComMarcacao(texto));

    passo.append(numero, corpo);
    passos.append(passo);
  });
  listaPassos.replaceChildren(passos);

  desenharPayloads(cenario);
  sincronizarInspetor(cenario.sonda);
}

/**
 * Payload + botao de copiar.
 *
 * O botao copia para a area de transferencia: o caminho mais curto entre "esta
 * na tela do instrutor" e "esta no campo do aluno" e um Ctrl+V. Um botao que
 * preenchesse o campo da outra aba exigiria permissao de acesso entre janelas,
 * e navegador nenhum concede isso.
 */
function desenharPayloads(cenario) {
  const linhas = document.createDocumentFragment();

  for (const payload of cenario.payloads) {
    const linha = document.createElement('div');
    linha.className = 'payload-linha';

    const coluna = document.createElement('div');

    const rotulo = document.createElement('span');
    rotulo.className = 'payload-linha__rotulo';
    rotulo.textContent = payload.rotulo;

    const codigo = document.createElement('code');
    codigo.textContent = payload.valor;

    const nota = document.createElement('span');
    nota.className = 'payload-linha__rotulo';
    nota.textContent = payload.nota;

    coluna.append(rotulo, codigo, nota);

    const copiar = document.createElement('button');
    copiar.type = 'button';
    copiar.className = 'botao botao--mini';
    copiar.textContent = 'copiar';

    copiar.addEventListener('click', async () => {
      const ok = await copiarTexto(payload.valor);
      copiar.textContent = ok ? 'copiado' : 'falhou';
      setTimeout(() => {
        copiar.textContent = 'copiar';
      }, 1200);
    });

    linha.append(coluna, copiar);
    linhas.append(linha);
  }

  listaPayloads.replaceChildren(linhas);
}

/* -------------------------------------------------------------------------- */
/* Inspetor                                                                   */
/* -------------------------------------------------------------------------- */

function sincronizarInspetor(sonda) {
  seletorRota.value = sonda.rota;
  campoParametro.value = sonda.parametro;
  campoValor.value = '';
  limparSonda();
}

function limparSonda() {
  preencher(statusSonda, '');
  preencher(corpoSonda, 'nenhuma sondagem ainda');
  corpoSonda.classList.add('inspetor-json--vazio');
}

seletorRota.addEventListener('change', () => {
  const escolhida = ROTAS_INSPETOR.find((item) => item.rota === seletorRota.value);
  campoParametro.value = escolhida?.parametro ?? '';
  campoValor.value = '';
  limparSonda();
});

/**
 * Executa um GET e mostra status e corpo.
 *
 * E um GET puro, sem escrita e sem parametro obrigatorio: a unica coisa que
 * diferencia a sondagem do ataque e o que foi digitado no campo de valor.
 */
async function sondar() {
  botaoSondar.disabled = true;
  preencher(statusSonda, 'consultando...');
  corpoSonda.classList.remove('inspetor-json--vazio');

  try {
    const url = new URL(seletorRota.value, window.location.origin);
    if (campoParametro.value) {
      url.searchParams.set(campoParametro.value, campoValor.value);
    }

    const resposta = await fetch(url.pathname + url.search, {
      headers: { Accept: 'application/json' },
    });

    const tipo = resposta.headers.get('content-type') ?? 'sem tipo';
    const texto = await resposta.text();

    let corpo = texto;
    try {
      corpo = JSON.stringify(JSON.parse(texto), null, 2);
    } catch {
      // Resposta que nao e JSON e mostrada como veio: em um laboratorio de
      // SQLi, ver o corpo cru e o que interessa.
    }

    preencher(statusSonda, `HTTP ${resposta.status} · ${tipo}`);
    preencher(corpoSonda, corpo);
  } catch (erro) {
    preencher(statusSonda, 'falha na sondagem');
    preencher(corpoSonda, String(/** @type {Error} */ (erro)?.message ?? erro));
  } finally {
    botaoSondar.disabled = false;
  }
}

botaoSondar.addEventListener('click', sondar);

/* -------------------------------------------------------------------------- */
/* Controle de sessao                                                         */
/* -------------------------------------------------------------------------- */

/** Repinta o console com o modo vigente. Nao recarrega a pagina. */
function pintarModo(modo) {
  aplicarModoNoDocumento(modo);
  montarControleModo(controleModo, modo, trocarModo);
  preencher(seloModo, rotuloDoModo(modo));
}

/**
 * Troca o modo sem recarregar.
 *
 * Nas paginas de app, trocar de modo RECARREGA, porque o backend decide o que
 * cada pagina renderiza e a pagina precisa ser redesenhada. No console nao ha o
 * que redesenhar: o console e o mesmo nos dois modos, e recarregar apagaria o
 * roteiro selecionado no meio da demonstracao.
 */
async function trocarModo(modo) {
  try {
    await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: modo }),
    });
  } catch (erro) {
    console.warn('[palco] troca de modo falhou:', erro.message);
  }

  pintarModo(modo);
  await consultarSaude();
}

/**
 * Sonda de saude.
 *
 * `tabelas` vem do `/api/health` (DAS, secao 7). Sao dois numeros que
 * respondem "o laboratorio esta de pe?" sem abrir o terminal no meio da
 * apresentacao.
 */
async function consultarSaude() {
  try {
    const resposta = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      preencher(saude, 'banco indisponivel');
      return;
    }

    preencher(saude, `banco ${dados.banco} · ${dados.tabelas} tabelas`);
  } catch {
    preencher(saude, 'banco indisponivel');
  }
}

/* -------------------------------------------------------------------------- */
/* Inicializacao                                                              */
/* -------------------------------------------------------------------------- */

for (const cenario of CENARIOS) {
  const opcao = document.createElement('option');
  opcao.value = cenario.id;
  opcao.textContent = cenario.nome;
  seletorCenario.append(opcao);
}

for (const rota of ROTAS_INSPETOR) {
  const opcao = document.createElement('option');
  opcao.value = rota.rota;
  opcao.textContent = rota.parametro
    ? `${rota.rota}?${rota.parametro}=`
    : rota.rota;
  seletorRota.append(opcao);
}

seletorCenario.addEventListener('change', desenharCenario);
botaoReset.addEventListener('click', reiniciarLab);

pintarModo(await obterModo());
desenharCenario();
limparSonda();
await consultarSaude();
setInterval(consultarSaude, 5000);
