import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WorldRoom } from './rooms/WorldRoom';

const port = Number(process.env.PORT) || 2567;
const app = express();

app.use(cors());

// Health endpoint — Fly's load balancer pings this to know the machine is alive.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Register the world room. Clients connect via colyseus.client.joinOrCreate('world', ...)
gameServer.define('world', WorldRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[lumen-server] listening on :${port}`);
  })
  .catch((err) => {
    console.error('[lumen-server] failed to start:', err);
    process.exit(1);
  });
