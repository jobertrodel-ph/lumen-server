import type { Express, Request, Response } from 'express';
import { prepareGame, GamePrepFailedError, pickRound } from './roundPicker';
import { verifyIdToken } from '../auth';

/**
 * Music game HTTP endpoints.
 *
 *   POST /game/prepare        (NEW) — full 10-round game prepared at once
 *     Body: { token, theme, market? }
 *     Returns: { theme, rounds[], unverifiedSuggestions[] }
 *
 *   POST /game/next-round     (LEGACY) — single round, kept for compatibility
 *     Body: { token, query, playedTrackIds[], market? }
 *     Returns: { track, options, correctOptionId }
 *
 * Auth: Firebase ID token verification on both routes.
 */

interface PrepareRequest {
  token?: string;
  theme?: string;
  market?: string;
}

interface NextRoundRequest {
  token?: string;
  query?: string;
  playedTrackIds?: string[];
  market?: string;
}

const MAX_THEME_LENGTH = 200;
const MAX_PLAYED_LIST = 50;

export function registerMusicRoutes(app: Express): void {
  app.post('/game/prepare', async (req: Request, res: Response) => {
    const body = req.body as PrepareRequest;

    if (!body?.token) return res.status(401).json({ error: 'Missing auth token' });
    try {
      await verifyIdToken(body.token);
    } catch {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    const theme = (typeof body.theme === 'string' ? body.theme : '').trim().slice(0, MAX_THEME_LENGTH);
    if (!theme) return res.status(400).json({ error: 'Theme is required' });

    const market = typeof body.market === 'string' && /^[A-Z]{2}$/.test(body.market)
      ? body.market : 'US';

    try {
      const game = await prepareGame({ theme, market });

      // Build the wire-safe response — includes correctOptionId for now
      // (Session B will hold this server-side and not leak it to clients).
      res.json({
        theme: game.theme,
        rounds: game.rounds.map((r) => ({
          index: r.index,
          track: {
            id: r.track.id,
            source: r.track.source,
            audioUrl: r.track.audioUrl,
            youtubeVideoId: r.track.youtubeVideoId,
            youtubeStartSec: r.track.youtubeStartSec,
            coverUrl: r.track.coverUrl,
          },
          options: r.options.map((o) => ({
            id: o.id,
            title: o.title,
            artist: o.artist,
          })),
          correctOptionId: r.correctOptionId,
        })),
        unverifiedSuggestions: game.unverifiedSuggestions,
      });
    } catch (err) {
      if (err instanceof GamePrepFailedError) {
        return res.status(404).json({
          error: err.message,
          verifiedCount: err.verifiedCount,
        });
      }
      console.error('[music] prepare failed:', err);
      return res.status(500).json({ error: 'Failed to prepare game' });
    }
  });

  // Legacy single-round endpoint, kept for any existing clients.
  app.post('/game/next-round', async (req: Request, res: Response) => {
    const body = req.body as NextRoundRequest;

    if (!body?.token) return res.status(401).json({ error: 'Missing auth token' });
    try {
      await verifyIdToken(body.token);
    } catch {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    const query = (typeof body.query === 'string' ? body.query : '').trim().slice(0, 80);
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const playedTrackIds = Array.isArray(body.playedTrackIds)
      ? body.playedTrackIds.filter((s): s is string => typeof s === 'string').slice(0, MAX_PLAYED_LIST)
      : [];

    const market = typeof body.market === 'string' && /^[A-Z]{2}$/.test(body.market)
      ? body.market : 'US';

    try {
      const round = await pickRound({ query, playedTrackIds, market });
      res.json({
        track: {
          id: round.track.id,
          source: round.track.source,
          audioUrl: round.track.audioUrl,
          youtubeVideoId: round.track.youtubeVideoId,
          youtubeStartSec: round.track.youtubeStartSec,
          coverUrl: round.track.coverUrl,
        },
        options: round.options.map((o) => ({
          id: o.id,
          title: o.title,
          artist: o.artist,
        })),
        correctOptionId: round.correctOptionId,
      });
    } catch (err) {
      if (err instanceof GamePrepFailedError) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[music] next-round failed:', err);
      return res.status(500).json({ error: 'Failed to pick round' });
    }
  });

  console.log('[music] routes registered: POST /game/prepare, POST /game/next-round');
}
