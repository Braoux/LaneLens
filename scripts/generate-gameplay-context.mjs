import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requestedVersion = process.argv[2];
if (!requestedVersion || !/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
  throw new Error('Usage: node scripts/generate-gameplay-context.mjs <data-dragon-version>');
}

const sourceUrl = `https://ddragon.leagueoflegends.com/cdn/${requestedVersion}/data/en_US/championFull.json`;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Data Dragon returned HTTP ${response.status}`);
const payload = await response.json();
if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
  throw new Error('Invalid Data Dragon championFull payload');
}

const slots = ['Q', 'W', 'E', 'R'];
const cleanFact = (value) => value
  .replace(/<[^>]+>/g, ' ')
  .replaceAll('&nbsp;', ' ')
  .replaceAll('&amp;', '&')
  .replaceAll(/\s+/g, ' ')
  .trim();
const champions = Object.values(payload.data)
  .map((champion) => ({
    champion: champion.name,
    abilities: [
      {
        slot: 'P',
        name: champion.passive.name,
        cooldowns: [],
        facts: [cleanFact(champion.passive.description)],
      },
      ...champion.spells.map((spell, index) => ({
        slot: slots[index],
        name: spell.name,
        cooldowns: spell.cooldown.filter((value) => Number.isFinite(value)),
        facts: [cleanFact(spell.description)],
      })),
    ],
  }))
  .sort((left, right) => left.champion.localeCompare(right.champion, 'en-US'));

const output = `// Generated from ${sourceUrl}. Do not edit by hand.\n`
  + `export const DATA_DRAGON_GAMEPLAY_VERSION = ${JSON.stringify(requestedVersion)};\n\n`
  + `export const DATA_DRAGON_CHAMPION_ABILITIES = ${JSON.stringify(champions, null, 2)} as const;\n`;

await writeFile(
  resolve('server/gameplay-context/data/data-dragon-champions.ts'),
  output,
  'utf8',
);
