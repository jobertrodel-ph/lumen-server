/**
 * Local test runner for the music game's round picker.
 *
 * Usage:
 *   npx ts-node src/music/test-cli.ts "Pop 2020"
 *   npx ts-node src/music/test-cli.ts "Taylor Swift"
 *
 * Requires GEMINI_API_KEY in environment (and optionally YOUTUBE_API_KEY
 * for the rare cases iTunes lacks a preview).
 *   export $(cat .env.local | xargs) && npx ts-node src/music/test-cli.ts "..."
 *
 * No Spotify credentials needed — iTunes is auth-free.
 */

import { pickRound } from './roundPicker';

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: npx ts-node src/music/test-cli.ts "<query>"');
    process.exit(1);
  }

  console.log(`\n→ Picking round for: "${query}"\n`);
  const start = Date.now();
  try {
    const round = await pickRound({
      query,
      playedTrackIds: [],
      market: 'US',
    });
    const elapsed = Date.now() - start;
    console.log(`✓ Round ready in ${elapsed}ms\n`);

    console.log('TRACK:');
    console.log(`  ${round.track.title} — ${round.track.artist}`);
    console.log(`  Year: ${round.track.year}`);
    console.log(`  Source: ${round.track.source}`);
    if (round.track.audioUrl) console.log(`  Audio: ${round.track.audioUrl}`);
    if (round.track.youtubeVideoId) {
      console.log(`  YouTube: ${round.track.youtubeVideoId} @ ${round.track.youtubeStartSec}s`);
    }

    console.log('\nOPTIONS:');
    for (const opt of round.options) {
      const marker = opt.id === round.correctOptionId ? '✓' : ' ';
      console.log(`  ${marker} [${opt.id}] ${opt.title} — ${opt.artist}`);
    }
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
