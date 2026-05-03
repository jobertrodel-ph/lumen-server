import { Schema, MapSchema, type } from '@colyseus/schema';

/**
 * Player adds room/zone tracking for Phase 3 maps.
 * `room` is which sub-world they're currently in (atrium/library/garden).
 * `zone` is the named conversation area, or empty string if between zones.
 */
export class Player extends Schema {
  @type('string') uid: string = '';
  @type('string') displayName: string = '';
  @type('string') photoURL: string = '';
  @type('string') room: string = 'atrium';
  @type('string') zone: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
