import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { modeMiddleware } from './middleware/mode.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import bancoRoutes from './routes/bancoRoutes.js';
import receitasRoutes from './routes/receitasRoutes.js';
import labRoutes from './routes/labRoutes.js';

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'public',
);

/**
 * App separado de server.js para que os testes de aceitacao (T01-T09) possam
 * importar a aplicacao via supertest sem abrir porta.
 */
/**
 * Paginas HTML por URL sem extensao, e os caminhos antigos como alias.
 *
 * Um banco de verdade nao serve `/finbank/agencias.html`: serve `/finbank/agencias`.
 * A extensao faz parte do endereco de arquivo, nao do endereco que o cliente
 * digita, e o laboratorio e explorado por URL -- deixar `.html` a vista entrega
 * que o site e uma pasta de arquivos.
 *
 * O alias antigo existe pelo mesmo motivo do alias novo: as rotas JSON do
 * laboratorio (`/banco/agencias`) e o nome do diretorio (`public/banco`, hoje
 * removido) nao podem ser confundidos com pagina. Os dois sao nomes diferentes:
 * a pagina tem extensao, a rota JSON nao. Por isso o mapa so tem entradas com
 * `.html` do lado legado, e nada aqui pode responder `/banco/agencias` -- se
 * respondesse, a rota JSON da secao 4.1 do DAS deixaria de existir.
 *
 * Sem `redirect`, porque `sendFile` nao redireciona: quem pede `/finbank`
 * recebe o home direto, em vez de um 301 que o E2E contaria como outra pagina.
 */
const PAGINAS = {
  // Rotas do laboratorio.
  '/palco': 'palco.html',

  // FinBank.
  '/finbank': 'finbank/index.html',
  '/finbank/agencias': 'finbank/agencias.html',
  '/finbank/extrato': 'finbank/extrato.html',
  '/finbank/comunicados': 'finbank/comunicados.html',
  '/finbank/noticia': 'finbank/noticia.html',

  // ChefLab.
  '/cheflab': 'cheflab/index.html',
  '/cheflab/receita': 'cheflab/receita.html',

  // Caminhos anteriores, mantidos para o DAS e para links ja publicados.
  '/banco/agencias.html': 'finbank/agencias.html',
  '/banco/extrato.html': 'finbank/extrato.html',
  '/banco/noticia.html': 'finbank/noticia.html',
  '/receitas/receitas.html': 'cheflab/receita.html',
};

/**
 * Pagina de "nao encontrado" de cada app, para quem navega.
 *
 * O notFoundHandler do projeto responde JSON, e continua respondendo JSON para
 * quem fala com a API. Mas um 404 em JSON dentro de uma apresentacao parece
 * erro do laboratorio: alguem digita um caminho errado, e a tela fica branca com
 * um `{"erro": ...}` no meio do projetor. Cada app tem a sua pagina de 404, com
 * a identidade visual dele, porque o aluno precisa sair da tela com a sensacao
 * de que esbarrou numa pagina que nao existe — e nao de que a oficina quebrou.
 */
const PAGINAS_404 = {
  '/finbank': 'finbank/nao-encontrado.html',
  '/cheflab': 'cheflab/nao-encontrado.html',
};

/** Verdadeiro quando o pedido e uma navegacao de pagina, e nao uma chamada de API. */
function ehNavegacao(req) {
  return String(req.headers.accept ?? '').includes('text/html');
}

/**
 * Qual das familias de app pertence a este caminho.
 *
 * A comparacao exige a barra: `/finbank-velho` nao pertence a `/finbank`, e sem
 * esse cuidado um caminho vizinho cairia na pagina do app errado.
 *
 * @param {string} caminho
 * @returns {string | null}
 */
function familiaDoApp(caminho) {
  return (
    Object.keys(PAGINAS_404).find(
      (prefixo) => caminho === prefixo || caminho.startsWith(`${prefixo}/`),
    ) ?? null
  );
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(cookieParser());
  app.use(modeMiddleware);

  // Sem `extensions: ['html']` de proposito: /banco/agencias e a rota JSON do
  // cenario de UNION e nao pode ser confundida com a pagina /banco/agencias.html.
  // Com `redirect: false` o express.static deixa de responder 301 em /banco e
  // /receitas ao encontrar diretorios com esses nomes dentro de src/public.
  // Sem isso o contrato da secao 4.4 quebrava: GET /receitas devolvia 301 em
  // vez de 200, e GET /banco caia num 404 depois do redirect.
  app.use(express.static(publicDir, { redirect: false }));

  for (const [rota, arquivo] of Object.entries(PAGINAS)) {
    app.get(rota, (req, res) => res.sendFile(path.join(publicDir, arquivo)));
  }

  app.use('/banco', bancoRoutes);
  app.use('/receitas', receitasRoutes);
  app.use('/api', labRoutes);

  // 404 de navegacao: a pagina do app correspondente. Fica DEPOIS das rotas de
  // API, para que /banco/agencias inexistente continue sendo JSON e nunca uma
  // pagina de banco.
  app.use((req, res, next) => {
    const familia = ehNavegacao(req) ? familiaDoApp(req.path) : null;
    if (!familia) {
      next();
      return;
    }

    res.status(404).sendFile(path.join(publicDir, PAGINAS_404[familia]));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
