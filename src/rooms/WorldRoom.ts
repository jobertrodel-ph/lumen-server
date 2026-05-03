import { Room, Client } from 'colyseus';
import { WorldState, Player } from './schema/WorldState';
import { verifyIdToken, AuthResult } from '../auth';
import { ROOMS, RoomId, isBlocked, zoneAt, portalAt } from '../world';

const AVATAR_RADIUS = 20;
const MAX_PLAYERS = 80;

// Anti-grief speed cap. Real client walk speed is 220 px/s; allow up to 3x.
const MAX_PIXELS_PER_MS = 0.6;

interface MovePayload {
  x: number;
  y: number;
}

const VALID_ROOMS: RoomId[] = ['atrium', 'library', 'garden'];

function isValidRoom(s: string): s is RoomId {
  return (VALID_ROOMS as string[]).includes(s);
}

export class WorldRoom extends Room<WorldState> {
  maxClients = MAX_PLAYERS;

  private lastMoveAt = new Map<string, number>();

  async onAuth(_client: Client, options: { token?: string }): Promise<AuthResult> {
    if (!options?.token) throw new Error('Missing auth token');
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

      // Type & sanity checks.
      if (typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;

      const room = ROOMS[player.room as RoomId];
      if (!room) return;

      // Per-room bounds.
      if (payload.x < 0 || payload.x > room.width) return;
      if (payload.y < 0 || payload.y > room.height) return;

      // Speed gate.
      const now = Date.now();
      const last = this.lastMoveAt.get(client.sessionId) ?? now;
      const dt = Math.max(now - last, 1);
      const dx = payload.x - player.x;
      const dy = payload.y - player.y;
      if (Math.hypot(dx, dy) > MAX_PIXELS_PER_MS * dt + 50) return;

      // Wall collision — server is authoritative. Client renders prediction
      // but the truth lives here.
      if (isBlocked(player.room as RoomId, payload.x, payload.y, AVATAR_RADIUS)) return;

      player.x = payload.x;
      player.y = payload.y;
      this.lastMoveAt.set(client.sessionId, now);

      // Recompute zone — null becomes empty string for schema compatibility.
      const newZone = zoneAt(player.room as RoomId, payload.x, payload.y) ?? '';
      if (newZone !== player.zone) {
        player.zone = newZone;
      }

      // Portal detection — automatic teleport when stepping onto a portal tile.
      const portal = portalAt(player.room as RoomId, payload.x, payload.y);
      if (portal) {
        player.room = portal.toRoom;
        player.x = portal.spawnX;
        player.y = portal.spawnY;
        player.zone = zoneAt(portal.toRoom, portal.spawnX, portal.spawnY) ?? '';
        console.log(
          `[world] ${player.displayName} -> ${portal.toRoom} (${this.roomCount(portal.toRoom)} there now)`
        );
      }
    });

    // Optional: client can request explicit teleport (debug / future menu UI).
    this.onMessage('teleport', (client, payload: { room?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!payload?.room || !isValidRoom(payload.room)) return;

      const dest = ROOMS[payload.room];
      player.room = payload.room;
      player.x = dest.spawnX;
      player.y = dest.spawnY;
      player.zone = zoneAt(payload.room, dest.spawnX, dest.spawnY) ?? '';
    });
  }

  onJoin(client: Client, _options: unknown, auth: AuthResult) {
    const spawn = ROOMS.atrium;
    const player = new Player();
    player.uid = auth.uid;
    player.displayName = auth.name?.trim() || 'Visitor';
    player.photoURL = auth.picture ?? '';
    player.room = 'atrium';
    player.x = spawn.spawnX;
    player.y = spawn.spawnY;
    player.zone = zoneAt('atrium', spawn.spawnX, spawn.spawnY) ?? '';

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

  private roomCount(roomId: RoomId): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.room === roomId) n++;
    });
    return n;
  }
}
