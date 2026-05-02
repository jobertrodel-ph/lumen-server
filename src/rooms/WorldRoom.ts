import { Room, Client } from 'colyseus';
import { WorldState, Player } from './schema/WorldState';
import { verifyIdToken, AuthResult } from '../auth';

const WORLD_SIZE = 4000;
const SPAWN_X = WORLD_SIZE / 2;
const SPAWN_Y = WORLD_SIZE / 2;
const MAX_PLAYERS = 50;

// Anti-grief speed cap. Real client walk speed is 220 px/s; this allows ~3x
// for diagonal/teleport tolerance while blocking obvious cheating.
const MAX_PIXELS_PER_MS = 0.6;

interface MovePayload {
  x: number;
  y: number;
}

export class WorldRoom extends Room<WorldState> {
  maxClients = MAX_PLAYERS;

  // Per-session timestamps for movement rate limiting.
  private lastMoveAt = new Map<string, number>();

  /**
   * onAuth runs BEFORE onJoin. Throwing here rejects the connection
   * with a clean error message. The returned object is passed to onJoin
   * as its third argument.
   */
  async onAuth(_client: Client, options: { token?: string }): Promise<AuthResult> {
    if (!options?.token) {
      throw new Error('Missing auth token');
    }
    try {
      return await verifyIdToken(options.token);
    } catch (err) {
      console.warn('[world] auth failed:', (err as Error).message);
      throw new Error('Invalid auth token');
    }
  }

  onCreate() {
    this.setState(new WorldState());

    this.onMessage('move', (client, payload: MovePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Type & sanity validation — never trust the client.
      if (typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      if (payload.x < 0 || payload.x > WORLD_SIZE) return;
      if (payload.y < 0 || payload.y > WORLD_SIZE) return;

      // Speed gate — reject impossible jumps.
      const now = Date.now();
      const last = this.lastMoveAt.get(client.sessionId) ?? now;
      const dt = Math.max(now - last, 1);
      const dx = payload.x - player.x;
      const dy = payload.y - player.y;
      const distance = Math.hypot(dx, dy);

      if (distance > MAX_PIXELS_PER_MS * dt + 50) {
        // Soft reject: ignore this update, force-resync by leaving state
        // unchanged. Client will eventually reconcile.
        return;
      }

      player.x = payload.x;
      player.y = payload.y;
      this.lastMoveAt.set(client.sessionId, now);
    });
  }

  onJoin(client: Client, _options: unknown, auth: AuthResult) {
    const player = new Player();
    player.uid = auth.uid;
    player.displayName = auth.name?.trim() || 'Visitor';
    player.photoURL = auth.picture ?? '';
    player.x = SPAWN_X;
    player.y = SPAWN_Y;

    this.state.players.set(client.sessionId, player);
    this.lastMoveAt.set(client.sessionId, Date.now());

    console.log(
      `[world] +${player.displayName} (uid=${auth.uid}) — ${this.state.players.size} online`
    );
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(
        `[world] -${player.displayName} — ${this.state.players.size - 1} online`
      );
    }
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  onDispose() {
    console.log('[world] room disposed');
  }
}
