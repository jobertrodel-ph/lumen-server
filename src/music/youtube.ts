/**
 * YouTube last-resort fallback.
 *
 * We only hit this when BOTH Spotify and iTunes failed to give us a preview
 * URL. By that point we already know the (title, artist) we want — we just
 * need a video to play. The client uses the YouTube IFrame Player API to
 * play it muted-then-unmuted, starting at 25% of duration.
 *
 * YouTube Data API v3 has a 10,000 quota/day on free tier, with each search
 * costing 100 units. By making YouTube the LAST fallback, we burn quota
 * only on edge-case tracks (~5-15% of rounds, depending on catalog).
 *
 * If your project genuinely runs out of quota you can:
 *  - Get a second API key from a different Google account
 *  - Cache successful (title,artist) -> videoId mappings in Firestore
 *  - Pre-warm the cache with the top N tracks per genre
 */

export interface YouTubeFallbackTrack {
  videoId: string;
  /** Total duration in seconds (parsed from ISO 8601). Used for 25%-seek. */
  durationSec: number;
  /** Region restriction info — if non-empty, the video may not play for some users. */
  blockedRegions: string[];
  allowedRegions: string[];
}

/**
 * Search YouTube for a music video matching the title + artist.
 * Filters to videos that are public, embeddable, and (best-effort) likely
 * the actual song rather than a cover.
 *
 * Returns null if quota exhausted, no matches, or no embeddable result.
 */
export async function findVideo(
  title: string,
  artist: string
): Promise<YouTubeFallbackTrack | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[youtube] YOUTUBE_API_KEY not set — YouTube fallback disabled');
    return null;
  }

  // Construct a query that tends to surface the official audio rather
  // than a 10-hour loop or a kids' cover.
  const query = `${artist} - ${title} official audio`;

  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    maxResults: '5',
    key: apiKey,
  });

  let searchResp: Response;
  try {
    searchResp = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  } catch (err) {
    console.warn('[youtube] search network error:', (err as Error).message);
    return null;
  }

  if (searchResp.status === 403) {
    console.warn('[youtube] quota exceeded or forbidden');
    return null;
  }
  if (!searchResp.ok) {
    console.warn(`[youtube] search failed: ${searchResp.status}`);
    return null;
  }

  const searchData = await searchResp.json() as {
    items: Array<{ id: { videoId: string }; snippet: { title: string } }>;
  };
  if (searchData.items.length === 0) return null;

  // Validate the top candidates by fetching their details — we need the
  // duration (to seek to 25%) and the regionRestriction to predict which
  // users will see "not available in your country."
  const ids = searchData.items.map((it) => it.id.videoId).join(',');
  const detailsParams = new URLSearchParams({
    part: 'contentDetails,status',
    id: ids,
    key: apiKey,
  });

  let detailsResp: Response;
  try {
    detailsResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
  } catch (err) {
    console.warn('[youtube] details network error:', (err as Error).message);
    return null;
  }

  if (!detailsResp.ok) return null;
  const detailsData = await detailsResp.json() as {
    items: Array<{
      id: string;
      contentDetails: {
        duration: string;     // ISO 8601 e.g. "PT3M45S"
        regionRestriction?: { allowed?: string[]; blocked?: string[] };
      };
      status: { embeddable: boolean; privacyStatus: string };
    }>;
  };

  for (const item of detailsData.items) {
    if (!item.status.embeddable || item.status.privacyStatus !== 'public') continue;

    const durationSec = parseISO8601Duration(item.contentDetails.duration);
    // Filter out videos under 30s (unlikely to be the song) or over 15min
    // (probably a 1-hour mix).
    if (durationSec < 30 || durationSec > 900) continue;

    return {
      videoId: item.id,
      durationSec,
      allowedRegions: item.contentDetails.regionRestriction?.allowed ?? [],
      blockedRegions: item.contentDetails.regionRestriction?.blocked ?? [],
    };
  }

  return null;
}

/**
 * Parse YouTube's ISO 8601 duration ("PT3M45S") into seconds.
 */
function parseISO8601Duration(iso: string): number {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  return h * 3600 + m * 60 + s;
}
