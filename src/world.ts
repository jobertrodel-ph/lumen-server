/**
 * Shared world map data. Authoritative source of truth for layout, walls,
 * portals, and zones. Used by:
 *
 *  - Server: collision validation, zone tracking
 *  - Client: rendering walls, registering portals, drawing zone hints
 *
 * Coordinates are in world pixels. Origin is top-left of each room.
 * Each room is its own coordinate space; portals teleport between them.
 */

export type RoomId = 'atrium' | 'library' | 'garden';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Portal {
  /** Trigger area — walking into this teleports the player. */
  bounds: Rect;
  /** Destination room. */
  toRoom: RoomId;
  /** Spawn position in destination room. */
  spawnX: number;
  spawnY: number;
  /** Display label, e.g. "→ Library". */
  label: string;
}

export interface Zone {
  /** Unique id. Used by server for grouping & by Phase 4 voice routing. */
  id: string;
  /** Bounds — when player is inside, they are "in" this zone. */
  bounds: Rect;
  /** Display name, shown to players in the zone. */
  name: string;
}

export interface RoomDef {
  id: RoomId;
  /** Display name (in HUD when entering). */
  name: string;
  /** Room dimensions in world pixels. */
  width: number;
  height: number;
  /** Default spawn for first-time entry to this room. */
  spawnX: number;
  spawnY: number;
  /** Floor tint — drives the room's light/mood. CSS hex. */
  floorTint: number;
  /** Ambient pool color. */
  poolTint: number;
  /** Walls — solid rectangles that block movement. */
  walls: Rect[];
  /** Portals into other rooms. */
  portals: Portal[];
  /** Named conversation zones. */
  zones: Zone[];
  /** Decorative ambient pool positions (for atmospheric lighting). */
  pools: Array<{ x: number; y: number; scale: number }>;
}

// =============================================================================
// THE ATRIUM — central plaza, warm peach, fountain in the middle
// =============================================================================
const ATRIUM: RoomDef = {
  id: 'atrium',
  name: 'The Atrium',
  width: 1600,
  height: 1200,
  spawnX: 800,
  spawnY: 880,
  floorTint: 0x141a2e,
  poolTint: 0xf5b39a,
  walls: [
    // Outer perimeter — leave gaps where portals are.
    { x: 0, y: 0, width: 1600, height: 24 },           // top
    { x: 0, y: 1176, width: 1600, height: 24 },        // bottom
    { x: 0, y: 0, width: 24, height: 500 },            // left top
    { x: 0, y: 700, width: 24, height: 500 },          // left bottom (gap = library portal)
    { x: 1576, y: 0, width: 24, height: 500 },         // right top
    { x: 1576, y: 700, width: 24, height: 500 },       // right bottom (gap = garden portal)
    // Central fountain — circular wall approximated with 4 thin rects.
    { x: 720, y: 540, width: 160, height: 16 },
    { x: 720, y: 644, width: 160, height: 16 },
    { x: 720, y: 540, width: 16, height: 120 },
    { x: 864, y: 540, width: 16, height: 120 },
  ],
  portals: [
    {
      bounds: { x: 0, y: 540, width: 24, height: 120 },
      toRoom: 'library',
      spawnX: 1440,
      spawnY: 500,
      label: 'Library',
    },
    {
      bounds: { x: 1576, y: 540, width: 24, height: 120 },
      toRoom: 'garden',
      spawnX: 80,
      spawnY: 500,
      label: 'Garden',
    },
  ],
  zones: [
    { id: 'atrium-fountain', name: 'The Fountain', bounds: { x: 600, y: 420, width: 400, height: 360 } },
    { id: 'atrium-northeast', name: 'Northeast Corner', bounds: { x: 1100, y: 100, width: 400, height: 280 } },
    { id: 'atrium-southwest', name: 'Southwest Corner', bounds: { x: 100, y: 820, width: 400, height: 280 } },
  ],
  pools: [
    { x: 200, y: 200, scale: 1.4 },
    { x: 1400, y: 200, scale: 1.2 },
    { x: 200, y: 1000, scale: 1.0 },
    { x: 1400, y: 1000, scale: 1.3 },
    { x: 800, y: 600, scale: 1.6 }, // fountain glow
  ],
};

// =============================================================================
// THE LIBRARY — soft amber, bookshelves & reading nooks
// =============================================================================
const LIBRARY: RoomDef = {
  id: 'library',
  name: 'The Library',
  width: 1500,
  height: 1000,
  spawnX: 1440,
  spawnY: 500,
  floorTint: 0x1a1612,
  poolTint: 0xe8b88a,
  walls: [
    { x: 0, y: 0, width: 1500, height: 24 },
    { x: 0, y: 976, width: 1500, height: 24 },
    { x: 0, y: 0, width: 24, height: 1000 },
    { x: 1476, y: 0, width: 24, height: 440 },
    { x: 1476, y: 560, width: 24, height: 440 },
    // Bookshelves — running parallel rows that define reading nooks between them.
    { x: 200, y: 180, width: 360, height: 24 },
    { x: 200, y: 380, width: 360, height: 24 },
    { x: 200, y: 580, width: 360, height: 24 },
    { x: 200, y: 780, width: 360, height: 24 },
    { x: 760, y: 180, width: 360, height: 24 },
    { x: 760, y: 380, width: 360, height: 24 },
    { x: 760, y: 580, width: 360, height: 24 },
    { x: 760, y: 780, width: 360, height: 24 },
  ],
  portals: [
    {
      bounds: { x: 1476, y: 440, width: 24, height: 120 },
      toRoom: 'atrium',
      spawnX: 60,
      spawnY: 600,
      label: 'Atrium',
    },
  ],
  zones: [
    { id: 'library-nook-a', name: 'Reading Nook A', bounds: { x: 220, y: 220, width: 320, height: 140 } },
    { id: 'library-nook-b', name: 'Reading Nook B', bounds: { x: 220, y: 620, width: 320, height: 140 } },
    { id: 'library-nook-c', name: 'Reading Nook C', bounds: { x: 780, y: 220, width: 320, height: 140 } },
    { id: 'library-nook-d', name: 'Reading Nook D', bounds: { x: 780, y: 620, width: 320, height: 140 } },
    { id: 'library-back', name: 'Back of the Library', bounds: { x: 1180, y: 100, width: 280, height: 800 } },
  ],
  pools: [
    { x: 380, y: 290, scale: 0.6 },
    { x: 380, y: 690, scale: 0.6 },
    { x: 940, y: 290, scale: 0.6 },
    { x: 940, y: 690, scale: 0.6 },
    { x: 1320, y: 500, scale: 1.4 },
  ],
};

// =============================================================================
// THE GARDEN — cool teal, open with grouped benches
// =============================================================================
const GARDEN: RoomDef = {
  id: 'garden',
  name: 'The Garden',
  width: 1800,
  height: 1200,
  spawnX: 80,
  spawnY: 500,
  floorTint: 0x0e1a1c,
  poolTint: 0x7fc4b8,
  walls: [
    { x: 0, y: 0, width: 1800, height: 24 },
    { x: 0, y: 1176, width: 1800, height: 24 },
    { x: 0, y: 0, width: 24, height: 440 },
    { x: 0, y: 560, width: 24, height: 640 },
    { x: 1776, y: 0, width: 24, height: 1200 },
    // Hedge clusters — each cluster forms a partial enclosure.
    { x: 400, y: 240, width: 160, height: 16 },
    { x: 400, y: 240, width: 16, height: 120 },
    { x: 1100, y: 800, width: 160, height: 16 },
    { x: 1244, y: 800, width: 16, height: 120 },
    { x: 700, y: 600, width: 16, height: 120 },
    { x: 700, y: 700, width: 200, height: 16 },
  ],
  portals: [
    {
      bounds: { x: 0, y: 440, width: 24, height: 120 },
      toRoom: 'atrium',
      spawnX: 1540,
      spawnY: 600,
      label: 'Atrium',
    },
  ],
  zones: [
    { id: 'garden-northwest', name: 'Northwest Bench', bounds: { x: 280, y: 160, width: 320, height: 240 } },
    { id: 'garden-southeast', name: 'Southeast Bench', bounds: { x: 1080, y: 760, width: 320, height: 240 } },
    { id: 'garden-center', name: 'Garden Center', bounds: { x: 700, y: 540, width: 360, height: 280 } },
  ],
  pools: [
    { x: 480, y: 320, scale: 1.2 },
    { x: 880, y: 660, scale: 1.5 },
    { x: 1180, y: 880, scale: 1.2 },
    { x: 1500, y: 300, scale: 1.0 },
    { x: 300, y: 900, scale: 1.0 },
  ],
};

export const ROOMS: Record<RoomId, RoomDef> = {
  atrium: ATRIUM,
  library: LIBRARY,
  garden: GARDEN,
};

// =============================================================================
// Helpers — pure, used by both client (movement preview) and server (validation)
// =============================================================================

/** AABB collision check between a circular avatar and a wall rectangle. */
export function avatarCollidesWithWall(
  cx: number,
  cy: number,
  radius: number,
  wall: Rect
): boolean {
  const closestX = Math.max(wall.x, Math.min(cx, wall.x + wall.width));
  const closestY = Math.max(wall.y, Math.min(cy, wall.y + wall.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

/** Returns true if (x, y) is inside any wall of the room. */
export function isBlocked(roomId: RoomId, x: number, y: number, radius: number): boolean {
  const room = ROOMS[roomId];
  for (const wall of room.walls) {
    if (avatarCollidesWithWall(x, y, radius, wall)) return true;
  }
  return false;
}

/** Returns the zone id at (x, y) in a room, or null if outside any zone. */
export function zoneAt(roomId: RoomId, x: number, y: number): string | null {
  const room = ROOMS[roomId];
  for (const zone of room.zones) {
    const b = zone.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return zone.id;
    }
  }
  return null;
}

/** Returns the portal at (x, y) in a room, or null. */
export function portalAt(roomId: RoomId, x: number, y: number): Portal | null {
  const room = ROOMS[roomId];
  for (const portal of room.portals) {
    const b = portal.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return portal;
    }
  }
  return null;
}
