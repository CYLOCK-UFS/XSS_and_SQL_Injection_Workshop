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

  app.use('/banco', bancoRoutes);
  app.use('/receitas', receitasRoutes);
  app.use('/api', labRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
