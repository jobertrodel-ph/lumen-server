import { Room, Client } from 'colyseus';
import { WorldState, Player } from './schema/WorldState';
import { verifyIdToken, AuthResult } from '../auth';
import { ROOMS, RoomId, isBlocked, zoneAt, portalAt } from '../world';

const AVATAR_RADIUS = 20;
const MAX_PLAYERS = 80;
const MAX_PIXELS_PER_MS = 0.6;

const VALID_AVATARS = ['yan', 'ren', 'lin', 'mei', 'zhe', 'hao'] as const;
const DEFAULT_AVATAR = 'yan';

interface MovePayload { x: number; y: number; }
interface JoinOptions { token?: string; avatarId?: string; }

const VALID_ROOMS: RoomId[] = ['rooftop', 'subway', 'karaoke'];
function isValidRoom(s: string): s is RoomId {
  return (VALID_ROOMS as string[]).includes(s);
}
function sanitizeAvatarId(id: unknown): string {
  return typeof id === 'string' && (VALID_AVATARS as readonly string[]).includes(id)
    ? id
    : DEFAULT_AVATAR;
}

export class WorldRoom extends Room<WorldState> {
  maxClients = MAX_PLAYERS;

  private lastMoveAt = new Map<string, number>();
  private sessionByUid = new Map<string, string>();

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthResult> {
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
      if (typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;

      const room = ROOMS[player.room as RoomId];
      if (!room) return;
      if (payload.x < 0 || payload.x > room.width) return;
      if (payload.y < 0 || payload.y > room.height) return;

      const now = Date.now();
      const last = this.lastMoveAt.get(client.sessionId) ?? now;
      const dt = Math.max(now - last, 1);
      const dx = payload.x - player.x;
      const dy = payload.y - player.y;
      if (Math.hypot(dx, dy) > MAX_PIXELS_PER_MS * dt + 50) return;

      if (isBlocked(player.room as RoomId, payload.x, payload.y, AVATAR_RADIUS)) return;

      player.x = payload.x;
      player.y = payload.y;
      this.lastMoveAt.set(client.sessionId, now);

      const newZone = zoneAt(player.room as RoomId, payload.x, payload.y) ?? '';
      if (newZone !== player.zone) player.zone = newZone;

      const portal = portalAt(player.room as RoomId, payload.x, payload.y);
      if (portal) {
        player.room = portal.toRoom;
        player.x = portal.spawnX;
        player.y = portal.spawnY;
        player.zone = zoneAt(portal.toRoom, portal.spawnX, portal.spawnY) ?? '';
      }
    });

    this.onMessage('teleport', (client, payload: { room?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !payload?.room || !isValidRoom(payload.room)) return;
      const dest = ROOMS[payload.room];
      player.room = payload.room;
      player.x = dest.spawnX;
      player.y = dest.spawnY;
      player.zone = zoneAt(payload.room, dest.spawnX, dest.spawnY) ?? '';
    });

    this.onMessage('setAvatar', (client, payload: { avatarId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.avatarId = sanitizeAvatarId(payload?.avatarId);
    });
  }

  onJoin(client: Client, options: JoinOptions, auth: AuthResult) {
    // Dedup: if this uid already has a session, kick the old one.
    const existingSessionId = this.sessionByUid.get(auth.uid);
    if (existingSessionId && existingSessionId !== client.sessionId) {
      const existingClient = this.clients.find(
        (c) => c.sessionId === existingSessionId
      );
      if (existingClient) {
        existingClient.leave(4001, 'replaced-by-new-session');
      }
      this.state.players.delete(existingSessionId);
      this.lastMoveAt.delete(existingSessionId);
      console.log(`[world] kicked stale session for ${auth.uid}`);
    }

    const spawn = ROOMS.rooftop;
    const player = new Player();
    player.uid = auth.uid;
    player.displayName = auth.name?.trim() || 'Visitor';
    player.photoURL = auth.picture ?? '';
    player.avatarId = sanitizeAvatarId(options?.avatarId);
    player.room = 'rooftop';
    player.x = spawn.spawnX;
    player.y = spawn.spawnY;
    player.zone = zoneAt('rooftop', spawn.spawnX, spawn.spawnY) ?? '';

    this.state.players.set(client.sessionId, player);
    this.lastMoveAt.set(client.sessionId, Date.now());
    this.sessionByUid.set(auth.uid, client.sessionId);

    console.log(
      `[world] +${player.displayName} (${player.avatarId}) — ${this.state.players.size} online`
    );
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[world] -${player.displayName} — ${this.state.players.size - 1} online`);
      if (this.sessionByUid.get(player.uid) === client.sessionId) {
        this.sessionByUid.delete(player.uid);
      }
    }
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  onDispose() {
    console.log('[world] room disposed');
  }
}
