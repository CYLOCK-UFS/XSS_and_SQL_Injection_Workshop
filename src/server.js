import { createApp } from './app.js';
import { closeDatabase, waitForDatabase } from './config/database.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

await waitForDatabase();

const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`[lab] FinBank & ChefLab em http://${host}:${port}`);
  console.log('[lab] ambiente isolado, dados sinteticos, nao publicar externamente.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });
}
