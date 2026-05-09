/**
 * Gemini integration for the music game.
 *
 * Three responsibilities:
 *   1. parseQuery     — text → structured intent (now barely used; the
 *                       new setlist flow doesn't need this since Gemini
 *                       interprets the theme directly).
 *   2. generateSetlist — theme → list of N iconic songs that match.
 *                        This is the new heart of the game.
 *   3. generateDistractors — given a correct answer, give 3 plausible wrongs.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash-lite';

interface GeminiTextResponse {
  candidates?: Array<{
    content: { parts: Array<{ text?: string }> };
  }>;
}

async function gemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY must be set');

  const resp = await fetch(`${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as GeminiTextResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return text;
}

function unfenceJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Setlist generator (new, primary)
// ---------------------------------------------------------------------------

export interface SetlistSong {
  title: string;
  artist: string;
  /** Year if Gemini knows it — used for context only, not strict filtering. */
  year?: number | null;
}

const SETLIST_PROMPT = `You are picking songs for a music guessing game.

Theme: "THEME_HERE"

List COUNT_HERE iconic, widely-recognized, chart-topping songs that match this theme.
Prefer songs that:
  - Are commercially successful and culturally well-known.
  - Are real, existing songs (do not invent titles or artists).
  - Were major hits — songs the general public would recognize from the first few seconds.
  - When the theme is a specific artist, pick that artist's BIGGEST hits across their career.
  - When the theme is a genre + year, pick the year's TOP CHART HITS in that genre.

AVOID titles already provided in the avoid list: AVOID_HERE

Return ONLY valid JSON in this format. No commentary, no markdown fences:
[{"title":"...","artist":"...","year":NUMBER_OR_NULL}, ...]`;

/**
 * Generate a list of iconic songs for a theme.
 * Returns up to `count` songs, possibly fewer if Gemini gives short results.
 *
 * The avoid list contains titles we already verified, plus any titles that
 * already failed iTunes lookup so Gemini doesn't suggest them again.
 */
export async function generateSetlist(args: {
  theme: string;
  count: number;
  avoidTitles: string[];
}): Promise<SetlistSong[]> {
  const avoidStr = args.avoidTitles.length === 0
    ? '(none)'
    : args.avoidTitles.slice(0, 30).map((t) => `"${t}"`).join(', ');

  const prompt = SETLIST_PROMPT
    .replace('THEME_HERE', args.theme.replace(/"/g, '\\"').slice(0, 200))
    .replace('COUNT_HERE', String(Math.max(1, Math.min(args.count, 30))))
    .replace('AVOID_HERE', avoidStr);

  const raw = await gemini(prompt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenceJson(raw));
  } catch {
    throw new Error(`Gemini setlist returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini setlist response was not an array');
  }

  const out: SetlistSong[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as { title?: unknown; artist?: unknown; year?: unknown };
    if (typeof obj.title !== 'string' || typeof obj.artist !== 'string') continue;
    const year = typeof obj.year === 'number' && obj.year > 1900 && obj.year < 2100
      ? obj.year : null;
    out.push({
      title: obj.title.trim().slice(0, 200),
      artist: obj.artist.trim().slice(0, 200),
      year,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distractor generation (kept, slightly enhanced)
// ---------------------------------------------------------------------------

export interface DistractorRequest {
  correctTitle: string;
  correctArtist: string;
  correctYear: number | null;
  context: string;
  avoidTitles: string[];
}

export interface Distractor {
  title: string;
  artist: string;
}

const DISTRACTOR_PROMPT = `Generate 3 multiple-choice distractors for a music guessing game.

Correct answer: "CORRECT_TITLE" by CORRECT_ARTIST (CORRECT_YEAR).
Theme: "CONTEXT".

Rules:
  1. Each distractor must be a REAL, EXISTING, ICONIC song. Not made up.
  2. Same era (within 2-3 years), similar genre, comparable popularity to the correct answer.
  3. If the theme names a specific artist, prefer OTHER POPULAR SONGS BY THAT SAME ARTIST.
  4. NEVER include any of these titles: AVOID_TITLES
  5. NEVER include the correct answer.
  6. Prefer chart-topping, widely-recognized hits — not deep cuts.

Return ONLY valid JSON:
[{"title":"...","artist":"..."},{"title":"...","artist":"..."},{"title":"...","artist":"..."}]`;

export async function generateDistractors(req: DistractorRequest): Promise<Distractor[]> {
  const yearStr = req.correctYear ? String(req.correctYear) : 'unknown year';
  const avoidStr = req.avoidTitles.length > 0
    ? req.avoidTitles.slice(0, 15).map((t) => `"${t}"`).join(', ')
    : '(none)';

  const prompt = DISTRACTOR_PROMPT
    .replace('CORRECT_TITLE', req.correctTitle.replace(/"/g, '\\"'))
    .replace('CORRECT_ARTIST', req.correctArtist)
    .replace('CORRECT_YEAR', yearStr)
    .replace('CONTEXT', req.context.replace(/"/g, '\\"'))
    .replace('AVOID_TITLES', avoidStr);

  const raw = await gemini(prompt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenceJson(raw));
  } catch {
    throw new Error(`Gemini returned invalid distractor JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini distractor response was not an array');
  }

  const out: Distractor[] = [];
  for (const item of parsed) {
    if (item && typeof item === 'object'
      && typeof (item as { title: unknown }).title === 'string'
      && typeof (item as { artist: unknown }).artist === 'string'
    ) {
      const d = item as Distractor;
      out.push({ title: d.title.slice(0, 200), artist: d.artist.slice(0, 200) });
    }
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// parseQuery (legacy, no longer in the main flow but kept for compatibility)
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  artist?: string;
  genre?: string;
  year?: number;
  yearStart?: number;
  yearEnd?: number;
  text?: string;
}

export async function parseQuery(query: string): Promise<ParsedQuery> {
  // The new setlist flow doesn't need structured parsing — Gemini takes
  // the raw theme string. parseQuery now just returns the theme as text.
  return { text: query };
}
