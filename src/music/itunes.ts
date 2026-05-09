/**
 * iTunes Search API client — primary music source for the game.
 *
 * iTunes is free, no-auth, no daily quota (just ~20 calls/min per IP).
 * Coverage of mainstream music with 30s previews is excellent — better
 * than Spotify's preview catalog in 2026 since many labels pulled out
 * of Spotify's preview program.
 *
 * Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 *
 * Two functions are exported:
 *   - searchTracks: primary search, used by the round picker
 *   - findPreview:  legacy fallback (kept for compatibility with any
 *                   code that might still call it)
 */

interface RawITunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  artistId?: number;
  collectionName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  country?: string;
  trackPrice?: number;
  trackExplicitness?: string;
  isStreamable?: boolean;
  kind?: string;
}

export interface ITunesTrack {
  /** Stable iTunes track id, used for de-duplication across rounds. */
  id: string;
  title: string;
  artist: string;
  /** Album name, used for filtering out karaoke/cover/tribute albums. */
  album: string;
  previewUrl: string;
  durationMs: number;
  year: number | null;
  genre: string | null;
  coverUrl: string | null;
}

/**
 * Words in a `collectionName` (album) that signal a low-quality match —
 * usually a karaoke version, instrumental, tribute, or cover that just
 * happens to share the song title we wanted.
 */
const ALBUM_BLACKLIST = [
  'karaoke', 'tribute', 'cover', 'covers', 'instrumental', 'made famous',
  'in the style of', 'made popular', 'as made', 'as performed by',
  'workout', 'remix collection', 'minus one',
];

function albumLooksFake(albumName: string | undefined): boolean {
  if (!albumName) return false;
  const lower = albumName.toLowerCase();
  return ALBUM_BLACKLIST.some((bad) => lower.includes(bad));
}

function mapITunesTrack(raw: RawITunesTrack): ITunesTrack | null {
  if (!raw.previewUrl || !raw.trackName || !raw.artistName) return null;
  if (raw.kind && raw.kind !== 'song') return null;     // skip music videos, podcasts, etc.

  const yearMatch = raw.releaseDate?.match(/^(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  // Larger artwork: iTunes returns 100x100 by default, swap for 600x600.
  const cover = raw.artworkUrl100?.replace(/\/\d+x\d+(bb)?\./, '/600x600$1.') ?? null;

  return {
    id: String(raw.trackId),
    title: raw.trackName,
    artist: raw.artistName,
    album: raw.collectionName ?? '',
    previewUrl: raw.previewUrl,
    durationMs: raw.trackTimeMillis ?? 0,
    year,
    genre: raw.primaryGenreName ?? null,
    coverUrl: cover,
  };
}

// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Free-text search term — title, artist, genre, anything matches. */
  term: string;
  /** ISO 3166 country code. Affects ordering — most-popular-in-this-country first. */
  country?: string;
  /** Max results per call. iTunes accepts up to 200. */
  limit?: number;
  /** Optional explicit content filter. iTunes default: include explicit. */
  explicit?: 'Yes' | 'No';
}

/**
 * Search iTunes for songs matching a free-text term.
 * Returns up to `limit` tracks. iTunes orders by relevance, which roughly
 * corresponds to popularity within the given country.
 *
 * Throws on network or parse errors. Empty results are returned as `[]`.
 */
export async function searchTracks(opts: SearchOptions): Promise<ITunesTrack[]> {
  const term = opts.term.trim();
  if (!term) return [];

  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: String(Math.min(Math.max(opts.limit ?? 50, 1), 200)),
  });
  if (opts.country) params.set('country', opts.country);
  if (opts.explicit) params.set('explicit', opts.explicit);

  const resp = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!resp.ok) {
    throw new Error(`iTunes search failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as { results: RawITunesTrack[] };
  const mapped: ITunesTrack[] = [];
  for (const raw of data.results) {
    const t = mapITunesTrack(raw);
    if (t) mapped.push(t);
  }
  return mapped;
}

/**
 * Filter out probable junk results (karaoke/cover/tribute albums).
 * The picker uses this after searchTracks.
 */
export function filterJunk(tracks: ITunesTrack[]): ITunesTrack[] {
  return tracks.filter((t) => !albumLooksFake(t.album));
}

/**
 * Year-range filter for the picker. iTunes search itself doesn't accept
 * a year filter; we apply it client-side on the result list.
 */
export function filterByYear(
  tracks: ITunesTrack[],
  opts: { year?: number; yearStart?: number; yearEnd?: number }
): ITunesTrack[] {
  if (!opts.year && !opts.yearStart && !opts.yearEnd) return tracks;
  return tracks.filter((t) => {
    if (t.year == null) return false;
    if (opts.year != null) return t.year === opts.year;
    const start = opts.yearStart ?? 1900;
    const end = opts.yearEnd ?? new Date().getFullYear();
    return t.year >= start && t.year <= end;
  });
}

/**
 * Legacy compatibility: find a single preview by (title, artist).
 * Used to be the iTunes fallback when Spotify lacked a preview.
 * Kept so the picker can also use it for "validate this distractor".
 */
export async function findPreview(
  title: string,
  artist: string
): Promise<ITunesTrack | null> {
  const term = `${artist} ${title}`;
  const results = await searchTracks({ term, limit: 20 });
  if (results.length === 0) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const targetTitle = normalize(title);
  const targetArtist = normalize(artist);

  const scored = results
    .filter((r) => !albumLooksFake(r.album))
    .map((r) => {
      const t = normalize(r.title);
      const a = normalize(r.artist);
      let score = 0;
      if (t === targetTitle) score += 100;
      else if (t.startsWith(targetTitle) || targetTitle.startsWith(t)) score += 60;
      else if (t.includes(targetTitle) || targetTitle.includes(t)) score += 30;
      if (a === targetArtist) score += 50;
      else if (a.includes(targetArtist) || targetArtist.includes(a)) score += 20;
      return { track: r, score };
    })
    .filter((c) => c.score >= 80)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.track ?? null;
}
