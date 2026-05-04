import { Schema, MapSchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') uid: string = '';
  @type('string') displayName: string = '';
  @type('string') photoURL: string = '';
  @type('string') avatarId: string = 'ember';
  @type('string') room: string = 'atrium';
  @type('string') zone: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
