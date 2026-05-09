/**
 * Game preparation — Gemini-curated setlist + iTunes verification.
 *
 * Flow at game start:
 *   1. Ask Gemini for 15 iconic songs that match the theme.
 *      (Asking for more than 10 gives buffer for iTunes misses.)
 *   2. For each suggestion, look it up on iTunes by (title, artist).
 *   3. Keep the ones that match and have a preview URL.
 *   4. If we don't yet have 10, ask Gemini for more — naming the
 *      already-tried titles in the avoid list so it doesn't repeat them.
 *   5. Stop when we have 10 verified tracks, or after 3 generation rounds.
 *
 * For each verified track:
 *   6. Ask Gemini for 3 distractors specific to that song's theme.
 *   7. Shuffle the 4 options and assign letter ids.
 *
 * Returns the entire game's 10 rounds, fully prepared. The game flow
 * (Session B) just iterates through this list.
 */

import {
  generateSetlist, generateDistractors, SetlistSong, Distractor,
} from './gemini';
import { findSong, ITunesTrack } from './itunes';
import { findVideo as findYouTubeVideo } from './youtube';

const TARGET_ROUNDS = 10;
const SETLIST_INITIAL_COUNT = 15;
const SETLIST_REFILL_COUNT = 8;
const MAX_GENERATION_ATTEMPTS = 3;
const MIN_ROUNDS_FOR_GAME = 6;     // if we can't find at least this many, fail

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
  id: string;            // 'a' | 'b' | 'c' | 'd'
  title: string;
  artist: string;
  correct?: boolean;
}

export interface PreparedRound {
  index: number;         // 0..N-1 (display 1..N)
  track: PlayableTrack;
  options: RoundOption[];
  correctOptionId: string;
}

export interface PreparedGame {
  theme: string;
  rounds: PreparedRound[];
  /** Songs Gemini suggested but iTunes couldn't find — useful for debugging. */
  unverifiedSuggestions: SetlistSong[];
}

export class GamePrepFailedError extends Error {
  public readonly verifiedCount: number;
  constructor(theme: string, verifiedCount: number) {
    super(
      `Could not prepare a full ${TARGET_ROUNDS}-round game for "${theme}". ` +
      `Only ${verifiedCount} verified tracks found. Try a different theme.`
    );
    this.name = 'GamePrepFailedError';
    this.verifiedCount = verifiedCount;
  }
}

export interface PrepareGameOptions {
  theme: string;
  /** ISO 3166 country code for iTunes lookups. */
  market?: string;
}

// ---------------------------------------------------------------------------

export async function prepareGame(opts: PrepareGameOptions): Promise<PreparedGame> {
  const theme = opts.theme.trim();
  if (!theme) {
    throw new GamePrepFailedError(theme, 0);
  }
  const market = opts.market ?? 'US';

  const verified: ITunesTrack[] = [];
  const verifiedTitlesLower = new Set<string>();
  /** Titles Gemini suggested that we already tried (verified or not). */
  const triedTitles = new Set<string>();
  const unverified: SetlistSong[] = [];

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    if (verified.length >= TARGET_ROUNDS) break;

    const need = TARGET_ROUNDS - verified.length;
    const requestCount = attempt === 0
      ? SETLIST_INITIAL_COUNT
      : Math.max(SETLIST_REFILL_COUNT, need + 3);

    let suggestions: SetlistSong[] = [];
    try {
      suggestions = await generateSetlist({
        theme,
        count: requestCount,
        avoidTitles: Array.from(triedTitles),
      });
    } catch (err) {
      console.warn(`[picker] setlist gen attempt ${attempt + 1} failed:`, (err as Error).message);
      // If Gemini fails on attempt 0, we've got nothing — propagate.
      if (attempt === 0) throw err;
      break;
    }

    if (suggestions.length === 0) {
      // Gemini is exhausted on this theme.
      break;
    }

    // Verify each suggestion against iTunes. Skip already-tried.
    for (const song of suggestions) {
      if (verified.length >= TARGET_ROUNDS) break;

      const titleKey = song.title.toLowerCase().trim();
      if (triedTitles.has(titleKey)) continue;
      triedTitles.add(titleKey);

      let found: ITunesTrack | null = null;
      try {
        found = await findSong(song.title, song.artist, market);
      } catch (err) {
        console.warn(`[picker] iTunes lookup failed for "${song.title}":`, (err as Error).message);
      }

      if (!found) {
        unverified.push(song);
        continue;
      }

      const verifiedKey = found.title.toLowerCase().trim();
      if (verifiedTitlesLower.has(verifiedKey)) continue;   // dedupe by actual iTunes title

      verified.push(found);
      verifiedTitlesLower.add(verifiedKey);
    }
  }

  if (verified.length < MIN_ROUNDS_FOR_GAME) {
    throw new GamePrepFailedError(theme, verified.length);
  }

  // Trim down to exactly TARGET_ROUNDS (or however many we got, up to that).
  const finalTracks = verified.slice(0, TARGET_ROUNDS);

  // Build distractors + options for each round, in parallel where safe.
  // We avoid running ALL distractor calls in parallel because that would
  // burst Gemini's rate limit (15 RPM on the free tier). Limit concurrency.
  const rounds = await buildRoundsWithLimitedConcurrency(finalTracks, theme, 3);

  return {
    theme,
    rounds,
    unverifiedSuggestions: unverified,
  };
}

/**
 * Build a `PreparedRound` for each verified track — parallel up to `concurrency`.
 * Sequencing matters: Gemini Flash free tier is 15 RPM, and we already
 * burned a few calls on setlist generation. Limit to 3 concurrent
 * distractor calls so we stay under rate limits with margin.
 */
async function buildRoundsWithLimitedConcurrency(
  tracks: ITunesTrack[],
  theme: string,
  concurrency: number
): Promise<PreparedRound[]> {
  const rounds: PreparedRound[] = new Array(tracks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tracks.length) return;
      rounds[i] = await buildRound(tracks[i], i, theme);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker());
  await Promise.all(workers);
  return rounds;
}

async function buildRound(
  track: ITunesTrack,
  index: number,
  theme: string
): Promise<PreparedRound> {
  const playable = await resolvePlayable(track);

  const distractors = await getDistractorsSafely({
    correctTitle: track.title,
    correctArtist: track.artist,
    correctYear: track.year,
    context: theme,
    avoidTitles: [track.title],
  });

  const ids = ['a', 'b', 'c', 'd'];
  const slots: RoundOption[] = [
    { id: '', title: track.title, artist: track.artist, correct: true },
    ...distractors.map((d) => ({ id: '', title: d.title, artist: d.artist })),
  ];
  shuffleInPlace(slots);
  slots.forEach((s, idx) => { s.id = ids[idx]; });
  const correctOption = slots.find((s) => s.correct);
  if (!correctOption) throw new Error('Internal: lost track of correct option');

  return {
    index,
    track: playable,
    options: slots,
    correctOptionId: correctOption.id,
  };
}

async function resolvePlayable(track: ITunesTrack): Promise<PlayableTrack> {
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

  // Defensive YouTube fallback (rarely reached because findSong already
  // requires previewUrl to be present).
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
    console.warn('[picker] YouTube fallback failed:', (err as Error).message);
  }

  // Last resort: still mark as iTunes but with no audio. Session B will
  // need to handle this (skip the round). In practice this should never
  // happen because findSong already required previewUrl.
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    year: track.year,
    coverUrl: track.coverUrl,
    source: 'itunes',
  };
}

async function getDistractorsSafely(req: {
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
  }
  while (candidates.length < 3) {
    candidates.push({
      title: `Mystery Track ${candidates.length + 1}`,
      artist: 'Unknown',
    });
  }
  return candidates.slice(0, 3);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Legacy export for backwards compatibility — Session B will use prepareGame
// instead, but keep the single-round picker exported in case anything else
// is still calling it.
// ---------------------------------------------------------------------------

export async function pickRound(opts: {
  query: string;
  playedTrackIds: string[];
  market?: string;
}): Promise<PreparedRound> {
  // Convenience wrapper: prepare a small game, return the first round.
  // Inefficient but kept for compatibility.
  const game = await prepareGame({ theme: opts.query, market: opts.market });
  const fresh = game.rounds.find((r) => !opts.playedTrackIds.includes(r.track.id));
  if (!fresh) throw new GamePrepFailedError(opts.query, 0);
  return fresh;
}
