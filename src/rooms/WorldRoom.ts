import { Room, Client } from 'colyseus';
import { WorldState, Player, ChatMessage, ChatReaction } from './schema/WorldState';
import { verifyIdToken, AuthResult } from '../auth';
import { ROOMS, RoomId, isBlocked, zoneAt, portalAt } from '../world';

const AVATAR_RADIUS = 20;
const MAX_PLAYERS = 80;
const MAX_PIXELS_PER_MS = 0.6;

// Chat constraints.
const MAX_CHAT_BUFFER = 50;
const MAX_CHAT_TEXT_LENGTH = 500;
const CHAT_RATE_LIMIT_MS = 400;       // min interval between sends per uid
const REACTION_RATE_LIMIT_MS = 150;   // reactions can be more frequent

const VALID_AVATARS = ['yan', 'ren', 'lin', 'mei', 'zhe', 'hao'] as const;
const DEFAULT_AVATAR = 'yan';

interface MovePayload { x: number; y: number; }
interface JoinOptions { token?: string; avatarId?: string; }

interface ChatSendPayload {
  text?: string;
  scope?: string;        // 'room:<id>' | 'zone:<id>'
  replyToId?: string;
  /** If present, this is a quote message. text is the quoter's commentary. */
  quoteOfId?: string;
}
interface ChatReactPayload { messageId?: string; emoji?: string; }
interface ChatBumpPayload { messageId?: string; }

const VALID_ROOMS: RoomId[] = ['rooftop', 'subway', 'karaoke'];
function isValidRoom(s: string): s is RoomId {
  return (VALID_ROOMS as string[]).includes(s);
}
function sanitizeAvatarId(id: unknown): string {
  return typeof id === 'string' && (VALID_AVATARS as readonly string[]).includes(id)
    ? id
    : DEFAULT_AVATAR;
}

/**
 * Sanitize chat text — trim, cap length, strip control chars except newline.
 */
function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';
  let t = input.trim();
  if (!t) return '';
  // Strip control chars except \n.
  t = t.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  if (t.length > MAX_CHAT_TEXT_LENGTH) t = t.slice(0, MAX_CHAT_TEXT_LENGTH);
  return t;
}

/**
 * Quick id generator. Doesn't need crypto-strength; just unique within a session.
 */
let idCounter = 0;
function newId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return Date.now().toString(36) + ':' + idCounter.toString(36);
}

export class WorldRoom extends Room<WorldState> {
  maxClients = MAX_PLAYERS;

  private lastMoveAt = new Map<string, number>();
  private sessionByUid = new Map<string, string>();
  private lastChatAt = new Map<string, number>();
  private lastReactionAt = new Map<string, number>();

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

    // ----------------------------------------------------------------- chat
    this.onMessage('chat:send', (client, payload: ChatSendPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Rate limit per uid.
      const now = Date.now();
      const lastAt = this.lastChatAt.get(player.uid) ?? 0;
      if (now - lastAt < CHAT_RATE_LIMIT_MS) return;

      const text = sanitizeText(payload?.text);
      if (!text) return;

      // Validate scope. Must be either 'room:<currentRoom>' or 'zone:<currentZone>'.
      const validRoomScope = `room:${player.room}`;
      const validZoneScope = player.zone ? `zone:${player.zone}` : null;
      const scope = payload?.scope === validZoneScope || payload?.scope === validRoomScope
        ? payload.scope
        : validRoomScope;

      this.lastChatAt.set(player.uid, now);

      // Quote check — referenced message must exist and be a 'message' or 'quote'.
      let quoted: ChatMessage | null = null;
      if (payload?.quoteOfId) {
        quoted = this.findMessage(payload.quoteOfId);
      }

      const msg = new ChatMessage();
      msg.id = newId();
      msg.kind = quoted ? 'quote' : 'message';
      msg.scope = scope;
      msg.senderUid = player.uid;
      msg.senderName = player.displayName;
      msg.senderAvatarId = player.avatarId;
      msg.text = text;
      msg.timestamp = now;

      if (quoted) {
        msg.quoteText = quoted.text;
        msg.quoteSenderName = quoted.senderName;
        msg.quoteTimestamp = quoted.timestamp;
      } else if (payload?.replyToId) {
        // Validate the reply target exists.
        const target = this.findMessage(payload.replyToId);
        if (target) msg.replyToId = target.id;
      }

      this.appendChat(msg);
    });

    this.onMessage('chat:react', (client, payload: ChatReactPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      const lastAt = this.lastReactionAt.get(player.uid) ?? 0;
      if (now - lastAt < REACTION_RATE_LIMIT_MS) return;
      this.lastReactionAt.set(player.uid, now);

      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : '';
      const emoji = typeof payload?.emoji === 'string' ? payload.emoji : '';
      if (!messageId || !emoji || emoji.length > 24) return;

      const msg = this.findMessage(messageId);
      if (!msg) return;

      // Toggle behavior — if user already reacted with this emoji, remove it.
      let reaction = msg.reactions.find((r) => r.emoji === emoji);
      if (reaction) {
        const userIdx = reaction.users.indexOf(player.uid);
        if (userIdx >= 0) {
          reaction.users.splice(userIdx, 1);
          // Drop the reaction if no users remain.
          if (reaction.users.length === 0) {
            const rIdx = msg.reactions.indexOf(reaction);
            msg.reactions.splice(rIdx, 1);
          }
        } else {
          reaction.users.push(player.uid);
        }
      } else {
        reaction = new ChatReaction();
        reaction.emoji = emoji;
        reaction.users.push(player.uid);
        msg.reactions.push(reaction);
      }
    });

    this.onMessage('chat:bump', (client, payload: ChatBumpPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      const lastAt = this.lastChatAt.get(player.uid) ?? 0;
      if (now - lastAt < CHAT_RATE_LIMIT_MS) return;

      const messageId = typeof payload?.messageId === 'string' ? payload.messageId : '';
      const original = this.findMessage(messageId);
      if (!original) return;

      this.lastChatAt.set(player.uid, now);

      const bump = new ChatMessage();
      bump.id = newId();
      bump.kind = 'bump';
      bump.scope = original.scope;
      bump.senderUid = player.uid;
      bump.senderName = player.displayName;
      bump.senderAvatarId = player.avatarId;
      bump.text = original.text;             // cached for clients that don't have the original
      bump.timestamp = now;
      bump.bumpedFromId = original.id;
      bump.quoteSenderName = original.senderName;
      bump.quoteTimestamp = original.timestamp;

      this.appendChat(bump);
    });
  }

  // -------------------------------------------------------------- chat helpers

  private findMessage(id: string): ChatMessage | null {
    for (const m of this.state.chat) {
      if (m.id === id) return m;
    }
    return null;
  }

  private appendChat(msg: ChatMessage): void {
    this.state.chat.push(msg);
    while (this.state.chat.length > MAX_CHAT_BUFFER) {
      this.state.chat.shift();
    }
  }

  private appendSystemMessage(roomId: RoomId, text: string): void {
    const msg = new ChatMessage();
    msg.id = newId();
    msg.kind = 'system';
    msg.scope = `room:${roomId}`;
    msg.text = text;
    msg.timestamp = Date.now();
    this.appendChat(msg);
  }

  // ------------------------------------------------------------- onJoin/onLeave

  onJoin(client: Client, options: JoinOptions, auth: AuthResult) {
    // Dedup: kick any existing session for this uid.
    const existingSessionId = this.sessionByUid.get(auth.uid);
    if (existingSessionId && existingSessionId !== client.sessionId) {
      const existingClient = this.clients.find((c) => c.sessionId === existingSessionId);
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

    // System chat announcement — one line per join, in the spawn room.
    this.appendSystemMessage('rooftop', `${player.displayName} arrived`);

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
