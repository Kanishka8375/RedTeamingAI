import dotenv from 'dotenv';
import { runMigrations } from './db/migrations.js';
import { createProxyServer } from './proxy/server.js';
import { startApiServer } from './api/server.js';

dotenv.config();
runMigrations();

const proxyPort = Number(process.env.PORT ?? 3000);
const apiPort = Number(process.env.API_PORT ?? 4000);

createProxyServer().listen(proxyPort, () => console.log(`Proxy on ${proxyPort}`));
startApiServer(apiPort);
