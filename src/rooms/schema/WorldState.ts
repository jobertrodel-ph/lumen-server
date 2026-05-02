import { Schema, MapSchema, type } from '@colyseus/schema';

/**
 * Player is the per-user state visible to all clients in the room.
 * Anything decorated with @type is automatically synced.
 */
export class Player extends Schema {
  @type('string') uid: string = '';
  @type('string') displayName: string = '';
  @type('string') photoURL: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
}

export class WorldState extends Schema {
  // Keyed by Colyseus session id (one per WebSocket connection).
  @type({ map: Player }) players = new MapSchema<Player>();
}
