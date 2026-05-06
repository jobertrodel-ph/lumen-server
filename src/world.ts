/**
 * Shared world map. Three rooms in a modern-cultivation aesthetic:
 *
 *  - rooftop : Rooftop Garden (天台园) — spawn point, social hub
 *  - subway  : Late-Night Subway (末班车) — liminal urban
 *  - karaoke : Private Karaoke (私人房) — booths for group voice
 */

export type RoomId = 'rooftop' | 'subway' | 'karaoke';

export interface Rect { x: number; y: number; width: number; height: number; }

export interface Portal {
  bounds: Rect;
  toRoom: RoomId;
  spawnX: number;
  spawnY: number;
  label: string;
}

export interface Zone {
  id: string;
  bounds: Rect;
  name: string;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  /** Bilingual subtitle shown briefly on entry. */
  subtitle: string;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;
  /** Floor base color. */
  floorTint: number;
  /** Accent for ambient pools / room glow. */
  poolTint: number;
  walls: Rect[];
  portals: Portal[];
  zones: Zone[];
  pools: Array<{ x: number; y: number; scale: number }>;
}

// ============================================================================
// THE ROOFTOP GARDEN — spawn point, warm and open
// ============================================================================
const ROOFTOP: RoomDef = {
  id: 'rooftop',
  name: 'The Rooftop Garden',
  subtitle: '天台园',
  width: 1700,
  height: 1200,
  spawnX: 850,
  spawnY: 900,
  floorTint: 0x18221c,       // deep mossy green-black
  poolTint: 0x7fc4a3,        // jade
  walls: [
    // Outer railing — thin perimeter walls (you can see past them, can't pass).
    { x: 0, y: 0, width: 1700, height: 24 },
    { x: 0, y: 1176, width: 1700, height: 24 },
    { x: 0, y: 0, width: 24, height: 500 },
    { x: 0, y: 700, width: 24, height: 500 },           // gap = subway portal
    { x: 1676, y: 0, width: 24, height: 500 },
    { x: 1676, y: 700, width: 24, height: 500 },        // gap = karaoke portal
    // Koi pond surround — central feature.
    { x: 720, y: 480, width: 220, height: 16 },
    { x: 720, y: 600, width: 220, height: 16 },
    { x: 720, y: 480, width: 16, height: 136 },
    { x: 924, y: 480, width: 16, height: 136 },
    // Bonsai planters scattered.
    { x: 280, y: 240, width: 80, height: 80 },
    { x: 1340, y: 240, width: 80, height: 80 },
    { x: 280, y: 880, width: 80, height: 80 },
    { x: 1340, y: 880, width: 80, height: 80 },
  ],
  portals: [
    {
      bounds: { x: 0, y: 540, width: 24, height: 120 },
      toRoom: 'subway',
      spawnX: 1300,
      spawnY: 500,
      label: 'Subway',
    },
    {
      bounds: { x: 1676, y: 540, width: 24, height: 120 },
      toRoom: 'karaoke',
      spawnX: 80,
      spawnY: 500,
      label: 'Karaoke',
    },
  ],
  zones: [
    { id: 'rooftop-pond',     name: 'Koi Pond',       bounds: { x: 600, y: 380, width: 460, height: 320 } },
    { id: 'rooftop-northeast', name: 'String Lights',  bounds: { x: 1080, y: 100, width: 480, height: 280 } },
    { id: 'rooftop-southwest', name: 'Bonsai Corner',  bounds: { x: 140, y: 800, width: 480, height: 280 } },
  ],
  pools: [
    { x: 200, y: 200, scale: 1.4 },
    { x: 1500, y: 200, scale: 1.2 },
    { x: 200, y: 1000, scale: 1.0 },
    { x: 1500, y: 1000, scale: 1.3 },
    { x: 830, y: 540, scale: 1.6 }, // pond glow
  ],
};

// ============================================================================
// THE LATE-NIGHT SUBWAY — liminal, cool, atmospheric
// ============================================================================
const SUBWAY: RoomDef = {
  id: 'subway',
  name: 'Late-Night Subway',
  subtitle: '末班车',
  width: 1500,
  height: 900,
  spawnX: 1300,
  spawnY: 500,
  floorTint: 0x12141c,       // concrete cool dark
  poolTint: 0x8aa8c8,        // pale fluorescent blue
  walls: [
    // Track wall (north side, behind the platform — thick, can't reach trains).
    { x: 0, y: 0, width: 1500, height: 180 },
    // South wall (back wall of station with vending machine).
    { x: 0, y: 800, width: 1500, height: 100 },
    // Sides.
    { x: 0, y: 180, width: 24, height: 620 },
    { x: 1476, y: 180, width: 24, height: 320 },        // gap = back to rooftop
    { x: 1476, y: 620, width: 24, height: 180 },
    // Two benches mid-platform.
    { x: 380, y: 460, width: 200, height: 28 },
    { x: 920, y: 460, width: 200, height: 28 },
    // Vending machine block.
    { x: 200, y: 720, width: 64, height: 80 },
    // Pillar.
    { x: 740, y: 380, width: 32, height: 32 },
  ],
  portals: [
    {
      bounds: { x: 1476, y: 500, width: 24, height: 120 },
      toRoom: 'rooftop',
      spawnX: 60,
      spawnY: 600,
      label: 'Rooftop',
    },
  ],
  zones: [
    { id: 'subway-bench-east', name: 'East Bench',   bounds: { x: 360, y: 500, width: 240, height: 200 } },
    { id: 'subway-bench-west', name: 'West Bench',   bounds: { x: 900, y: 500, width: 240, height: 200 } },
    { id: 'subway-vending',    name: 'By the Machine', bounds: { x: 160, y: 600, width: 200, height: 180 } },
  ],
  pools: [
    { x: 280, y: 300, scale: 0.8 },
    { x: 760, y: 280, scale: 1.0 },
    { x: 1240, y: 300, scale: 0.8 },
    { x: 480, y: 600, scale: 0.9 },
    { x: 1020, y: 600, scale: 0.9 },
  ],
};

// ============================================================================
// THE KARAOKE LOUNGE — three booths, hot lighting, party energy
// ============================================================================
const KARAOKE: RoomDef = {
  id: 'karaoke',
  name: 'Private Karaoke',
  subtitle: '私人房',
  width: 1600,
  height: 1100,
  spawnX: 80,
  spawnY: 500,
  floorTint: 0x1a1018,       // deep magenta-black
  poolTint: 0xe8b870,        // warm gold
  walls: [
    // Outer.
    { x: 0, y: 0, width: 1600, height: 24 },
    { x: 0, y: 1076, width: 1600, height: 24 },
    { x: 0, y: 180, width: 24, height: 320 },
    { x: 0, y: 620, width: 24, height: 480 },
    { x: 0, y: 0, width: 24, height: 180 },             // gap below this for portal
    { x: 1576, y: 0, width: 24, height: 1100 },
    // Booth dividers — three booths along the back, separated by L-shaped walls.
    // Booth A (left)
    { x: 220, y: 180, width: 320, height: 16 },         // top
    { x: 220, y: 180, width: 16, height: 240 },         // left side
    { x: 524, y: 180, width: 16, height: 240 },         // right side
    // Booth B (center)
    { x: 640, y: 180, width: 320, height: 16 },
    { x: 640, y: 180, width: 16, height: 240 },
    { x: 944, y: 180, width: 16, height: 240 },
    // Booth C (right)
    { x: 1060, y: 180, width: 320, height: 16 },
    { x: 1060, y: 180, width: 16, height: 240 },
    { x: 1364, y: 180, width: 16, height: 240 },
    // Bar counter (south side, doesn't fully span — leaves walking room).
    { x: 360, y: 820, width: 880, height: 28 },
  ],
  portals: [
    {
      bounds: { x: 0, y: 500, width: 24, height: 120 },
      toRoom: 'rooftop',
      spawnX: 1620,
      spawnY: 600,
      label: 'Rooftop',
    },
  ],
  zones: [
    { id: 'karaoke-booth-a', name: 'Booth A',    bounds: { x: 240, y: 200, width: 280, height: 200 } },
    { id: 'karaoke-booth-b', name: 'Booth B',    bounds: { x: 660, y: 200, width: 280, height: 200 } },
    { id: 'karaoke-booth-c', name: 'Booth C',    bounds: { x: 1080, y: 200, width: 280, height: 200 } },
    { id: 'karaoke-floor',   name: 'Dance Floor', bounds: { x: 600, y: 500, width: 400, height: 280 } },
    { id: 'karaoke-bar',     name: 'At the Bar', bounds: { x: 380, y: 860, width: 840, height: 180 } },
  ],
  pools: [
    { x: 800, y: 600, scale: 1.6 }, // dance floor
    { x: 380, y: 320, scale: 0.8 }, // booth A glow
    { x: 800, y: 320, scale: 0.8 }, // booth B glow
    { x: 1220, y: 320, scale: 0.8 },// booth C glow
    { x: 800, y: 920, scale: 1.0 }, // bar glow
  ],
};

export const ROOMS: Record<RoomId, RoomDef> = {
  rooftop: ROOFTOP,
  subway: SUBWAY,
  karaoke: KARAOKE,
};

// =============================================================================
// Helpers
// =============================================================================

export function avatarCollidesWithWall(
  cx: number, cy: number, radius: number, wall: Rect
): boolean {
  const closestX = Math.max(wall.x, Math.min(cx, wall.x + wall.width));
  const closestY = Math.max(wall.y, Math.min(cy, wall.y + wall.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

export function isBlocked(roomId: RoomId, x: number, y: number, radius: number): boolean {
  const room = ROOMS[roomId];
  for (const wall of room.walls) {
    if (avatarCollidesWithWall(x, y, radius, wall)) return true;
  }
  return false;
}

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
