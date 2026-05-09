/**
 * iTunes Search API — used for verifying Gemini's setlist suggestions
 * and providing the actual preview URLs.
 */

interface RawITunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  kind?: string;
}

export interface ITunesTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  previewUrl: string;
  durationMs: number;
  year: number | null;
  genre: string | null;
  coverUrl: string | null;
}

const ALBUM_BLACKLIST = [
  'karaoke', 'tribute', 'cover', 'covers', 'instrumental', 'made famous',
  'in the style of', 'made popular', 'as made', 'as performed by',
  'workout', 'remix collection', 'minus one', 'made famous by',
];

function albumLooksFake(albumName: string | undefined): boolean {
  if (!albumName) return false;
  const lower = albumName.toLowerCase();
  return ALBUM_BLACKLIST.some((bad) => lower.includes(bad));
}

function mapITunesTrack(raw: RawITunesTrack): ITunesTrack | null {
  if (!raw.previewUrl || !raw.trackName || !raw.artistName) return null;
  if (raw.kind && raw.kind !== 'song') return null;

  const yearMatch = raw.releaseDate?.match(/^(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
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

/**
 * Normalize a title or artist string for matching:
 *   - lowercase
 *   - strip parenthetical/bracketed bits like "(Remastered 2009)" or "[Live]"
 *   - strip "feat. X" / "ft. X" suffixes
 *   - strip non-word punctuation
 *   - collapse whitespace
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?)\s+.+$/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------

/**
 * Look up a specific song by title and artist. Used by the round picker
 * to verify Gemini-suggested songs actually exist on iTunes.
 *
 * Returns the best-matching track that has a previewUrl, or null if no
 * acceptable match is found.
 */
export async function findSong(
  title: string,
  artist: string,
  country = 'US'
): Promise<ITunesTrack | null> {
  // iTunes search is keyword-based. Combining artist + title in the term
  // gives the best precision.
  const term = `${artist} ${title}`.slice(0, 200);
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: '20',
    country,
  });

  const resp = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!resp.ok) {
    throw new Error(`iTunes search failed: ${resp.status}`);
  }

  const data = await resp.json() as { results: RawITunesTrack[] };
  if (data.results.length === 0) return null;

  const targetTitle = normalize(title);
  const targetArtist = normalize(artist);

  // Score every result; pick the highest-scoring one that has a previewUrl
  // and isn't from a junk album.
  const scored: Array<{ track: ITunesTrack; score: number }> = [];
  for (const raw of data.results) {
    const track = mapITunesTrack(raw);
    if (!track) continue;
    if (albumLooksFake(track.album)) continue;

    const t = normalize(track.title);
    const a = normalize(track.artist);

    let score = 0;
    if (t === targetTitle) score += 100;
    else if (t.startsWith(targetTitle) || targetTitle.startsWith(t)) score += 60;
    else if (t.includes(targetTitle) || targetTitle.includes(t)) score += 30;

    if (a === targetArtist) score += 50;
    else if (a.includes(targetArtist) || targetArtist.includes(a)) score += 25;

    if (score < 80) continue;     // not a meaningful match
    scored.push({ track, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].track;
}

// ---------------------------------------------------------------------------
// Legacy exports — kept so any other code that imports these still works.
// ---------------------------------------------------------------------------

export interface SearchOptions {
  term: string;
  country?: string;
  limit?: number;
}

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

  const resp = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!resp.ok) throw new Error(`iTunes search failed: ${resp.status}`);

  const data = await resp.json() as { results: RawITunesTrack[] };
  const mapped: ITunesTrack[] = [];
  for (const raw of data.results) {
    const t = mapITunesTrack(raw);
    if (t) mapped.push(t);
  }
  return mapped;
}

export function filterJunk(tracks: ITunesTrack[]): ITunesTrack[] {
  return tracks.filter((t) => !albumLooksFake(t.album));
}

export async function findPreview(
  title: string,
  artist: string
): Promise<ITunesTrack | null> {
  return findSong(title, artist);
}
