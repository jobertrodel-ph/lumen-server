import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WorldRoom } from './rooms/WorldRoom';
import { handleLivekitToken } from './livekit';
import { registerMusicRoutes } from './music/routes';

const port = Number(process.env.PORT) || 2567;
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Voice token issuance. Client posts its Firebase ID token, gets a LiveKit JWT.
app.post('/livekit-token', handleLivekitToken);

registerMusicRoutes(app);

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

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
