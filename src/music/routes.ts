import type { Express, Request, Response } from 'express';
import { pickRound, NoPlayableTrackError } from './roundPicker';
import { verifyIdToken } from '../auth';

/**
 * Music game HTTP endpoint. Mounted on the Express app alongside the
 * existing /livekit-token route.
 *
 *   POST /game/next-round
 *     Body: { token, query, playedTrackIds[], market? }
 *     Returns: { track, options }   (correctOptionId stripped)
 *
 * Auth: requires the same Firebase ID token as everything else.
 *
 * The endpoint is stateless — game state lives in the Colyseus room
 * (Session B). This is just a "give me a playable round" service.
 */

interface NextRoundRequest {
  token?: string;
  query?: string;
  playedTrackIds?: string[];
  market?: string;
  offset?: number;
}

const MAX_QUERY_LENGTH = 80;
const MAX_PLAYED_LIST = 50;

export function registerMusicRoutes(app: Express): void {
  app.post('/game/next-round', async (req: Request, res: Response) => {
    const body = req.body as NextRoundRequest;

    // Auth: same Firebase ID token verification as everywhere else.
    if (!body?.token) {
      return res.status(401).json({ error: 'Missing auth token' });
    }
    try {
      await verifyIdToken(body.token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Sanitize input.
    const query = (typeof body.query === 'string' ? body.query : '').trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const playedTrackIds = Array.isArray(body.playedTrackIds)
      ? body.playedTrackIds.filter((s): s is string => typeof s === 'string').slice(0, MAX_PLAYED_LIST)
      : [];

    const market = typeof body.market === 'string' && /^[A-Z]{2}$/.test(body.market)
      ? body.market : 'US';

    const offset = typeof body.offset === 'number' && body.offset >= 0 && body.offset < 1000
      ? Math.floor(body.offset) : 0;

    try {
      const round = await pickRound({ query, playedTrackIds, market, offset });

      // Strip correctness from the wire response — server keeps it for scoring.
      const clientOptions = round.options.map((opt) => ({
        id: opt.id,
        title: opt.title,
        artist: opt.artist,
      }));

      // For the source URL, we only expose what the client needs to play it.
      // YouTube fallback exposes videoId + start; otherwise audioUrl.
      res.json({
        track: {
          id: round.track.id,
          source: round.track.source,
          audioUrl: round.track.audioUrl,
          youtubeVideoId: round.track.youtubeVideoId,
          youtubeStartSec: round.track.youtubeStartSec,
          coverUrl: round.track.coverUrl,
        },
        options: clientOptions,
        // The correctOptionId is intentionally NOT in the response — the
        // server keeps it for scoring. Session B's MusicGameRoom will hold
        // it in memory and check guesses.
        correctOptionId: round.correctOptionId,
      });
    } catch (err) {
      if (err instanceof NoPlayableTrackError) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[music] next-round failed:', err);
      return res.status(500).json({ error: 'Failed to pick round' });
    }
  });

  console.log('[music] routes registered: POST /game/next-round');
}
