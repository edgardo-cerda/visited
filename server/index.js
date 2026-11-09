import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb(config.dbPath);
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`Visited Chile escuchando en http://localhost:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
