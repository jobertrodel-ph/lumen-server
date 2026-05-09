/**
 * Gemini integration for the music game.
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
        temperature: 0.4,
        maxOutputTokens: 800,
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
// Query parsing
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  artist?: string;
  genre?: string;
  year?: number;
  yearStart?: number;
  yearEnd?: number;
  text?: string;
}

const KNOWN_GENRES = new Set([
  'pop', 'rock', 'hip-hop', 'hiphop', 'rap', 'r&b', 'rnb',
  'country', 'jazz', 'metal', 'edm', 'indie', 'k-pop', 'kpop',
  'j-pop', 'jpop', 'latin', 'reggae', 'soul', 'funk', 'lo-fi', 'lofi',
  'electronic', 'house', 'techno', 'dance', 'punk', 'alternative',
  'classical', 'folk', 'blues', 'disco', 'gospel', 'ska',
]);

/**
 * Phrases that, if present, indicate vague time/scope intent that the
 * fast-path can't resolve precisely. These force a fall-through to Gemini
 * for proper parsing. "early X", "late X", "old X", etc.
 */
const VAGUE_TIME_WORDS = new Set([
  'early', 'late', 'old', 'new', 'recent', 'classic', 'vintage',
  'modern', 'contemporary', 'best', 'top', 'greatest',
]);

function normalizeGenre(g: string): string {
  const lower = g.toLowerCase();
  if (lower === 'hiphop') return 'hip-hop';
  if (lower === 'rnb') return 'r&b';
  if (lower === 'kpop') return 'k-pop';
  if (lower === 'jpop') return 'j-pop';
  if (lower === 'lofi') return 'lo-fi';
  return lower;
}

const DECADE_REGEX = /^(\d0)s$/;
const FULL_DECADE_REGEX = /^(19|20)(\d0)s$/;

function fastPathParse(query: string): ParsedQuery | null {
  const trimmed = query.trim();
  if (!trimmed) return {};

  const tokens = trimmed.split(/\s+/);

  // Vague-time word? Defer to Gemini — it knows what "early Drake" means.
  for (const tok of tokens) {
    if (VAGUE_TIME_WORDS.has(tok.toLowerCase())) return null;
  }

  const result: ParsedQuery = {};
  const remaining: string[] = [];

  for (const tok of tokens) {
    const lower = tok.toLowerCase();

    if (/^\d{4}$/.test(tok)) {
      const y = parseInt(tok, 10);
      if (y >= 1900 && y <= new Date().getFullYear() + 1) {
        result.year = y;
        continue;
      }
    }

    const rangeMatch = tok.match(/^(\d{4})-(\d{4})$/);
    if (rangeMatch) {
      result.yearStart = parseInt(rangeMatch[1], 10);
      result.yearEnd = parseInt(rangeMatch[2], 10);
      continue;
    }

    const decade = lower.match(DECADE_REGEX);
    if (decade) {
      const d = parseInt(decade[1], 10);
      const start = d <= 20 ? 2000 + d : 1900 + d;
      result.yearStart = start;
      result.yearEnd = start + 9;
      continue;
    }
    const fullDecade = lower.match(FULL_DECADE_REGEX);
    if (fullDecade) {
      const start = parseInt(fullDecade[1] + fullDecade[2], 10);
      result.yearStart = start;
      result.yearEnd = start + 9;
      continue;
    }

    if (KNOWN_GENRES.has(lower)) {
      result.genre = normalizeGenre(lower);
      continue;
    }

    remaining.push(tok);
  }

  // Structural hits: known genre, year, or year-range. Treat remaining as text.
  if (result.genre || result.year || result.yearStart) {
    if (remaining.length > 0) {
      result.text = remaining.join(' ');
    }
    return result;
  }

  // No structural hits. Be conservative about treating the input as an artist:
  //   - 1 to 4 tokens (longer = probably a phrase, defer to Gemini)
  //   - Each token starts with a capital letter (artist-name heuristic)
  // This catches "Taylor Swift", "BTS", "Olivia Rodrigo", "The Weeknd"
  // but not "music for studying", "best songs ever", etc.
  if (remaining.length >= 1 && remaining.length <= 4) {
    const allCapitalized = remaining.every((t) => /^[A-Z]/.test(t) || /^\d/.test(t));
    if (allCapitalized && /^[\w\s'.&,-]+$/.test(trimmed) && trimmed.length <= 60) {
      return { artist: trimmed };
    }
  }

  return null;  // Defer to Gemini
}

const QUERY_PARSE_PROMPT = `Parse a music-game query into JSON.

Fields (all optional):
  artist (string), genre (string), year (int), yearStart (int), yearEnd (int), text (string)

Examples:
  "early Drake"          → {"artist":"Drake","yearStart":2009,"yearEnd":2013}
  "kpop girl groups"     → {"genre":"k-pop","text":"girl group"}
  "lofi study"           → {"genre":"lo-fi","text":"study"}
  "best songs ever"      → {"text":"best songs"}

Return ONLY JSON, no markdown.

Query: "QUERY_HERE"`;

export async function parseQuery(query: string): Promise<ParsedQuery> {
  const fast = fastPathParse(query);
  if (fast !== null) return fast;

  const prompt = QUERY_PARSE_PROMPT.replace('QUERY_HERE', query.replace(/"/g, '\\"').slice(0, 100));
  let raw: string;
  try {
    raw = await gemini(prompt);
  } catch (err) {
    console.warn('[gemini] parseQuery failed, falling back to free-text:', (err as Error).message);
    return { text: query };
  }

  try {
    const parsed = JSON.parse(unfenceJson(raw));
    const safe: ParsedQuery = {};
    if (typeof parsed.artist === 'string') safe.artist = parsed.artist.slice(0, 100);
    if (typeof parsed.genre === 'string') safe.genre = parsed.genre.slice(0, 30);
    if (typeof parsed.year === 'number') safe.year = parsed.year;
    if (typeof parsed.yearStart === 'number') safe.yearStart = parsed.yearStart;
    if (typeof parsed.yearEnd === 'number') safe.yearEnd = parsed.yearEnd;
    if (typeof parsed.text === 'string') safe.text = parsed.text.slice(0, 100);
    return safe;
  } catch {
    return { text: query };
  }
}

// ---------------------------------------------------------------------------
// Distractor generation
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
  1. Each distractor must be a REAL, EXISTING song. Not made up.
  2. Same era (within 2-3 years), similar genre, comparable popularity.
  3. If the theme names a specific artist, prefer OTHER POPULAR SONGS BY THAT SAME ARTIST.
  4. NEVER include any of these titles: AVOID_TITLES
  5. NEVER include the correct answer.

Return ONLY valid JSON:
[{"title":"...","artist":"..."},{"title":"...","artist":"..."},{"title":"...","artist":"..."}]`;

export async function generateDistractors(req: DistractorRequest): Promise<Distractor[]> {
  const yearStr = req.correctYear ? String(req.correctYear) : 'unknown year';
  const avoidStr = req.avoidTitles.length > 0
    ? req.avoidTitles.slice(0, 12).map((t) => `"${t}"`).join(', ')
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
