import { Router } from 'express';
import {
  buscarCliente,
  buscarExtrato,
  buscarNoticia,
  listarAgencias,
  listarCidades,
  listarComunicados,
} from '../repositories/bancoRepository.js';
import {
  LIMITE_CLIENTE,
  LIMITE_DESCRICAO,
  buscarPerfil,
  salvarPerfil,
} from '../repositories/perfilRepository.js';
import { LAB_MODE_VULN } from '../middleware/mode.js';

const router = Router();

/**
 * Le um parametro de query como texto.
 *
 * O Express 5 usa o parser `simple`, que monta um ARRAY quando o mesmo
 * parametro aparece mais de uma vez (?cidade=A&cidade=B). Sem esta
 * normalizacao o array chegaria ao repository: no modo vuln a interpolacao
 * viraria "WHERE cidade = 'A,B'" e no modo safe o placeholder receberia um
 * array, com resultado silenciosamente errado nos dois casos. A entrada de
 * qualquer cenario e um unico valor, entao qualquer coisa que nao seja string
 * e tratada como ausente.
 *
 * A guarda tambem cobre a notacao de colchetes (?cidade[x]=A). Nesse caso o
 * parser `simple` cria a chave literal "cidade[x]" e req.query.cidade fica
 * undefined, mas um switch futuro para `query parser: 'extended'` faria o
 * parametro virar objeto. As duas situacoes colapsam no mesmo resultado.
 */
function textoUnico(valor) {
  if (typeof valor !== 'string') {
    return '';
  }
  return valor;
}

/**
 * Cenario 1 - SQLi UNION (DAS 4.1).
 * GET /banco/agencias?cidade=<cidade>
 * A query string carrega apenas o parametro do cenario; o modo vem do cookie.
 */
router.get('/agencias', async (req, res) => {
  const cidade = textoUnico(req.query.cidade);
  const agencias = await listarAgencias(cidade, { labMode: req.labMode });
  const cidades = await listarCidades();

  res.json({
    modo: req.labMode,
    filtro: { cidade },
    cidades,
    total: agencias.length,
    agencias,
  });
});

/**
 * Cenario 2 - SQLi baseada em erro (DAS 4.2).
 * GET /banco/extrato?id_conta=<id_conta>
 * No modo vuln o erro do MySQL chega ao cliente; no modo safe, nao.
 */
router.get('/extrato', async (req, res) => {
  const idConta = textoUnico(req.query.id_conta);
  const lancamentos = await buscarExtrato(idConta, { labMode: req.labMode });

  res.json({
    modo: req.labMode,
    conta: idConta,
    total: lancamentos.length,
    lancamentos,
  });
});

/**
 * Cenario 3 - SQLi inferencial/cega (DAS 4.3).
 * GET /banco/noticia?id=<id>
 * Oraculo: 200 com a noticia ou 404.
 *
 * No modo VULN o erro de banco e suprimido de proposito, para que o conteudo
 * da noticia seja o unico canal de resposta. E o que torna o cenario 3 um
 * oraculo de verdade: sem essa supressao, um payload de sintaxe invalida
 * responderia 500 em vez de 404, e a plateia leria "acertou a condicao" num
 * erro de parser -- a mesma resposta para a condicao verdadeira e para um
 * payload quebrado, que e a forma mais barata de quebrar um ataque por inferencia.
 *
 * No modo SAFE a supressao e removida de proposito, e o erro volta a ser
 * erro. Ali a consulta e parametrizada e o id ja passou pela validacao de
 * formato, entao a entrada nao consegue distorcer a consulta: qualquer falha
 * aqui e MySQL fora do ar, pool esgotado ou bug de verdade. Reportar isso como
 * "noticia nao encontrada" seria trocar um diagnostico honesto por um 404 que
 * mente -- e o 404 e justamente o sinal que o ataque precisa ler. Numa
 * apresentacao, MySQL caido viraria "o oraculo parou de responder" sem ninguem
 * saber que o banco tinha parado.
 *
 * O DAS (4.3) diz "erros suprimidos" para manter o oraculo exato. Isso e
 * verdade no modo em que o oraculo existe.
 */
router.get('/noticia', async (req, res) => {
  const id = textoUnico(req.query.id);

  let noticia = null;
  try {
    noticia = await buscarNoticia(id, { labMode: req.labMode });
  } catch (error) {
    if (req.labMode === LAB_MODE_VULN) {
      console.error(
        `[lab] erro suprimido em /banco/noticia (modo=${req.labMode}):`,
        error.code || error.name,
        '-',
        error.message,
      );
      noticia = null;
    } else {
      throw error;
    }
  }

  if (!noticia) {
    res.status(404).json({
      modo: req.labMode,
      erro: 'Noticia nao encontrada.',
    });
    return;
  }

  res.json({
    modo: req.labMode,
    noticia,
  });
});

/**
 * Leitura da conta do cliente logado (DAS v2.3).
 *
 * Um autoatendimento mostra o nome e o saldo. Essas informacoes vem da tabela
 * clientes, separadas do extrato. O id e uma string (CLI001). Nada e digitado
 * pelo aluno nesta rota: e um GET puro, sem query string livre, e sem qualquer
 * concatenacao de texto.
 */
router.get('/cliente/:id', async (req, res) => {
  const idCliente = textoUnico(req.params.id);
  const cliente = await buscarCliente(idCliente);

  if (!cliente) {
    res.status(404).json({
      erro: 'Cliente nao encontrado.',
    });
    return;
  }

  res.json({
    cliente,
  });
});

/**
 * Lista de comunicados para o mural do FinBank (DAS v2.3).
 *
 * Devolve apenas id, titulo e data_publicacao. A noticia completa fica no
 * cenario 3 (/banco/noticia).
 */
router.get('/comunicados', async (req, res) => {
  const comunicados = await listarComunicados();
  res.json({
    total: comunicados.length,
    comunicados,
  });
});

/**
 * Cenario 5 - XSS armazenado no FinBank (DAS v2.4, secao 8).
 * GET /banco/perfil?id_cliente=<id_cliente>
 *
 * O segundo armazenamento de XSS do laboratorio, e o primeiro que NAO esta no
 * ChefLab. A razao de o DAS escolher uma "area de perfil do cliente" e uma
 * razao didatica, e nao de produto: o mesmo comportamento, o mesmo banco e a
 * mesma aplicacao, em um produto diferente. Quem terminasse o roteiro sabendo
 * apenas que "portal de comentarios tem XSS" levaria essa conclusao para casa;
 * quem viu o mesmo sink em duas telas do mesmo sistema leva a do contexto de
 * renderizacao.
 *
 * `id_cliente` vai como placeholder nos DOIS modos -- nao existe cenario de
 * injecao de SQL nesta rota, e a funcao do repository nao recebe `labMode`.
 * O bloco T12 da suite de aceite existe para travar esse fato: um dia em que
 * `id_cliente` passasse a ser concatenado seria um quinto cenario aparecendo
 * sem ninguem ter pedido, e a pagina nao teria nenhum payload para o exercitar.
 */
router.get('/perfil', async (req, res) => {
  const idCliente = textoUnico(req.query.id_cliente);

  if (idCliente === '') {
    res.status(400).json({
      erro: 'Informe id_cliente.',
    });
    return;
  }

  const perfil = await buscarPerfil(idCliente);

  if (!perfil) {
    res.status(404).json({
      erro: 'Perfil nao encontrado.',
    });
    return;
  }

  res.json({
    modo: req.labMode,
    perfil,
  });
});

/**
 * Cenario 5 - XSS armazenado no FinBank (DAS v2.4, secao 8).
 * POST /banco/perfil  { id_cliente, descricao_perfil }
 *
 * O INSERT e PARAMETRIZADO nos dois modos: e o mesmo desenho de
 * POST /receitas, e pelo mesmo motivo. A marcacao do payload e gravada
 * exatamente como digitada e volta intacta da API -- o que o E2E le, e o que
 * torna a distincao entre "o banco aceitou o payload" e "o navegador executou
 * o payload" observavel na apresentacao.
 *
 * A diferenca entre vuln e safe esta inteira na renderizacao da resposta, em
 * src/public/finbank/perfil.js.
 */
router.post('/perfil', async (req, res) => {
  const idCliente = String(req.body?.id_cliente ?? '').trim();
  const descricao = String(req.body?.descricao_perfil ?? '').trim();

  if (idCliente === '' || descricao === '') {
    res.status(400).json({
      erro: 'Informe id_cliente e descricao_perfil.',
    });
    return;
  }

  // `maxlength` do formulario espelha estes limites, e nao os substitui: quem
  // chamar esta rota com curl envia o que quiser, e um id de megabytes viraria
  // parametro de consulta. Ver os limites em src/repositories/perfilRepository.js.
  if (idCliente.length > LIMITE_CLIENTE) {
    res.status(400).json({
      erro: `id_cliente deve ter no maximo ${LIMITE_CLIENTE} caracteres.`,
    });
    return;
  }

  if (descricao.length > LIMITE_DESCRICAO) {
    res.status(400).json({
      erro: `descricao_perfil deve ter no maximo ${LIMITE_DESCRICAO} caracteres.`,
    });
    return;
  }

  const perfil = await salvarPerfil({ idCliente, descricao });

  res.status(201).json({ modo: req.labMode, perfil });
});


export default router;

