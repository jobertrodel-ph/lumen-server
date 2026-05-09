/**
 * Round picker — composes iTunes (primary), YouTube (fallback), and Gemini.
 *
 * Flow:
 *   1. Gemini parses the query into structured intent.
 *   2. Build an iTunes search term that combines artist, genre, and any
 *      free text. Year is filtered client-side because iTunes' API doesn't
 *      support a year filter.
 *   3. Filter junk (karaoke/cover/tribute albums).
 *   4. Filter played tracks.
 *   5. For each candidate (iTunes' relevance order ~= popularity),
 *      we already have a previewUrl, so we either accept the iTunes
 *      preview directly or — if the user's market blocks it — fall back
 *      to YouTube.
 *   6. Generate distractors via Gemini.
 *   7. Shuffle 4 options.
 */

import { searchTracks, filterJunk, filterByYear, ITunesTrack, findPreview as findItunesPreview } from './itunes';
import { findVideo as findYouTubeVideo } from './youtube';
import { parseQuery, generateDistractors, ParsedQuery, Distractor } from './gemini';

const MAX_CANDIDATES_TO_TRY = 12;
const VERIFY_DISTRACTORS = false;

export type AudioSource = 'itunes' | 'youtube';

export interface PlayableTrack {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  source: AudioSource;
  audioUrl?: string;
  youtubeVideoId?: string;
  youtubeStartSec?: number;
}

export interface RoundOption {
  id: string;
  title: string;
  artist: string;
  correct?: boolean;
}

export interface Round {
  track: PlayableTrack;
  options: RoundOption[];
  correctOptionId: string;
}

export class NoPlayableTrackError extends Error {
  constructor(query: string, attempted: number) {
    super(`No playable track found for "${query}" after ${attempted} attempts`);
    this.name = 'NoPlayableTrackError';
  }
}

export interface PickRoundOptions {
  query: string;
  playedTrackIds: string[];
  /** ISO 3166 country code for iTunes' relevance ordering. Default 'US'. */
  market?: string;
}

/**
 * Build an iTunes search term from parsed intent. iTunes searches across
 * track title, artist, album, and genre simultaneously, so we just join
 * the structured fields into a single string.
 */
function buildITunesTerm(parsed: ParsedQuery, originalQuery: string): string {
  const parts: string[] = [];
  if (parsed.artist) parts.push(parsed.artist);
  if (parsed.genre) parts.push(parsed.genre);
  if (parsed.text) parts.push(parsed.text);
  // If parsing yielded nothing structural, just send the raw query.
  const term = parts.join(' ').trim();
  return term || originalQuery.trim();
}

export async function pickRound(opts: PickRoundOptions): Promise<Round> {
  const parsed = await parseQuery(opts.query);
  const term = buildITunesTerm(parsed, opts.query);
  if (!term) throw new NoPlayableTrackError(opts.query, 0);

  // iTunes accepts large limits — fetch wide so we have room after
  // filtering for year, junk, and played-set.
  const rawResults = await searchTracks({
    term,
    country: opts.market ?? 'US',
    limit: 100,
  });

  // Filter junk → year → played.
  let candidates = filterJunk(rawResults);
  candidates = filterByYear(candidates, {
    year: parsed.year,
    yearStart: parsed.yearStart,
    yearEnd: parsed.yearEnd,
  });

  const playedSet = new Set(opts.playedTrackIds);
  candidates = candidates.filter((t) => !playedSet.has(t.id));

  if (candidates.length === 0) {
    throw new NoPlayableTrackError(opts.query, 0);
  }

  // iTunes already orders by relevance/popularity for the country —
  // we keep that order. (No client-side popularity sort needed.)
  // Try candidates until one is fully playable. Since iTunes results all
  // have previewUrls, the first try succeeds in nearly all cases. The
  // YouTube branch only runs if iTunes' preview URL is somehow blocked.
  let chosen: { track: ITunesTrack; playable: PlayableTrack } | null = null;
  const tryCount = Math.min(candidates.length, MAX_CANDIDATES_TO_TRY);

  for (let i = 0; i < tryCount; i++) {
    const candidate = candidates[i];
    const playable = await resolvePlayable(candidate);
    if (playable) {
      chosen = { track: candidate, playable };
      break;
    }
  }

  if (!chosen) {
    throw new NoPlayableTrackError(opts.query, tryCount);
  }

  // Distractors via Gemini.
  const distractors = await getDistractors({
    correctTitle: chosen.track.title,
    correctArtist: chosen.track.artist,
    correctYear: chosen.track.year,
    context: opts.query,
    avoidTitles: [chosen.track.title],
  });

  const ids = ['a', 'b', 'c', 'd'];
  const slots: RoundOption[] = [
    { id: '', title: chosen.track.title, artist: chosen.track.artist, correct: true },
    ...distractors.map((d) => ({ id: '', title: d.title, artist: d.artist })),
  ];
  shuffleInPlace(slots);
  slots.forEach((s, idx) => { s.id = ids[idx]; });
  const correctOption = slots.find((s) => s.correct);
  if (!correctOption) throw new Error('Internal: lost track of correct option');

  return {
    track: chosen.playable,
    options: slots,
    correctOptionId: correctOption.id,
  };
}

/**
 * iTunes results all have `previewUrl` (we filtered out the ones that
 * don't), so this is mostly a passthrough. The YouTube branch exists
 * only as a defensive fallback in case a previewUrl is somehow null
 * by the time we read it (very rare, but cheap to handle).
 */
async function resolvePlayable(track: ITunesTrack): Promise<PlayableTrack | null> {
  if (track.previewUrl) {
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      year: track.year,
      coverUrl: track.coverUrl,
      source: 'itunes',
      audioUrl: track.previewUrl,
    };
  }

  // Defensive YouTube fallback (rarely reached).
  try {
    const yt = await findYouTubeVideo(track.title, track.artist);
    if (yt) {
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        year: track.year,
        coverUrl: track.coverUrl,
        source: 'youtube',
        youtubeVideoId: yt.videoId,
        youtubeStartSec: Math.floor(yt.durationSec * 0.25),
      };
    }
  } catch (err) {
    console.warn('[picker] YouTube lookup failed:', (err as Error).message);
  }

  return null;
}

async function getDistractors(req: {
  correctTitle: string;
  correctArtist: string;
  correctYear: number | null;
  context: string;
  avoidTitles: string[];
}): Promise<Distractor[]> {
  let candidates: Distractor[] = [];
  try {
    candidates = await generateDistractors(req);
  } catch (err) {
    console.warn('[picker] distractor generation failed:', (err as Error).message);
    candidates = [];
  }

  if (!VERIFY_DISTRACTORS) {
    while (candidates.length < 3) {
      candidates.push({
        title: `Mystery Track ${candidates.length + 1}`,
        artist: 'Unknown',
      });
    }
    return candidates.slice(0, 3);
  }

  // Optional verification: each distractor must exist on iTunes.
  // Slower (extra HTTP call per distractor) but catches Gemini hallucinations.
  const validated: Distractor[] = [];
  const seen = new Set([req.correctTitle.toLowerCase()]);
  for (const cand of candidates) {
    if (validated.length >= 3) break;
    const key = cand.title.toLowerCase();
    if (seen.has(key)) continue;
    const found = await findItunesPreview(cand.title, cand.artist);
    if (found) {
      validated.push(cand);
      seen.add(key);
    }
  }
  while (validated.length < 3) {
    validated.push({ title: `Mystery Track ${validated.length + 1}`, artist: 'Unknown' });
  }
  return validated;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
