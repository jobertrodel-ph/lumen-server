import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') uid: string = '';
  @type('string') displayName: string = '';
  @type('string') photoURL: string = '';
  @type('string') avatarId: string = 'yan';
  @type('string') room: string = 'rooftop';
  @type('string') zone: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
}

/**
 * One reaction entry. `users` is the list of uids that reacted with this emoji,
 * so we can show counts and prevent double-reacting.
 */
export class ChatReaction extends Schema {
  @type('string') emoji: string = '';
  @type(['string']) users = new ArraySchema<string>();
}

/**
 * ChatMessage — one entry in a room's rolling buffer.
 *
 * `scope` is either 'room:<roomId>' (visible to everyone in that room)
 * or 'zone:<zoneId>' (visible only to people in that named zone).
 *
 * `kind` distinguishes user-generated 'message' from 'system' (joins/leaves)
 * and 'quote' (which embeds another message).
 *
 * `replyToId` and the four `quote*` fields are populated only on the relevant
 * kinds. Kept inline rather than as nested schemas because Colyseus schemas
 * are deeply nested already and shallow keeps wire format small.
 */
export class ChatMessage extends Schema {
  @type('string') id: string = '';
  @type('string') kind: string = 'message';
  @type('string') scope: string = '';
  @type('string') senderUid: string = '';
  @type('string') senderName: string = '';
  @type('string') senderAvatarId: string = '';
  @type('string') text: string = '';
  @type('number') timestamp: number = 0;
  @type('string') replyToId: string = '';

  // For `quote` kind: snapshot of the original at quote-time.
  @type('string') quoteText: string = '';
  @type('string') quoteSenderName: string = '';
  @type('number') quoteTimestamp: number = 0;

  // For `bump` kind: original message id, refreshed timestamp.
  @type('string') bumpedFromId: string = '';

  @type([ChatReaction]) reactions = new ArraySchema<ChatReaction>();
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type([ChatMessage]) chat = new ArraySchema<ChatMessage>();
}
