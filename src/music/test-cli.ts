/**
 * Local test runner for the whole-game preparer.
 *
 * Usage:
 *   npx ts-node src/music/test-cli.ts "Pop 2020"
 *   npx ts-node src/music/test-cli.ts "Taylor Swift"
 *   npx ts-node src/music/test-cli.ts "OPM 2010s"
 *
 * Prints all 10 rounds with their correct answers + distractors so you
 * can spot-check setlist quality and distractor plausibility.
 */

import { prepareGame } from './roundPicker';

async function main() {
  const theme = process.argv[2];
  if (!theme) {
    console.error('Usage: npx ts-node src/music/test-cli.ts "<theme>"');
    process.exit(1);
  }

  console.log(`\n→ Preparing game for: "${theme}"\n`);
  const start = Date.now();
  try {
    const game = await prepareGame({ theme, market: 'US' });
    const elapsed = Date.now() - start;
    console.log(`✓ Game prepared in ${elapsed}ms — ${game.rounds.length} rounds\n`);

    for (const round of game.rounds) {
      console.log(`Round ${round.index + 1}: ${round.track.title} — ${round.track.artist} (${round.track.year})`);
      console.log(`  Source: ${round.track.source}`);
      if (round.track.audioUrl) console.log(`  Audio: ${round.track.audioUrl.slice(0, 80)}...`);
      console.log('  Options:');
      for (const opt of round.options) {
        const marker = opt.id === round.correctOptionId ? '✓' : ' ';
        console.log(`    ${marker} [${opt.id}] ${opt.title} — ${opt.artist}`);
      }
      console.log();
    }

    if (game.unverifiedSuggestions.length > 0) {
      console.log(`(${game.unverifiedSuggestions.length} suggestions failed iTunes lookup):`);
      for (const s of game.unverifiedSuggestions) {
        console.log(`  ✗ ${s.title} — ${s.artist}`);
      }
    }
  } catch (err) {
    console.error('✗ Failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
