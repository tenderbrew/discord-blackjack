import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PNG_DIR = join(__dirname, '..', 'assets', 'cards');
const MANIFEST_PATH = join(__dirname, '..', 'data', 'card-emojis.json');

const { DISCORD_TOKEN, CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

console.log(`Fetching existing application emojis for ${CLIENT_ID}...`);
const existingResp = await rest.get(Routes.applicationEmojis(CLIENT_ID));
const existingList = Array.isArray(existingResp) ? existingResp : (existingResp.items ?? []);
const existingByName = new Map(existingList.map(e => [e.name, e]));
console.log(`  found ${existingByName.size} existing.`);

const files = readdirSync(PNG_DIR).filter(f => f.endsWith('.png')).sort();
console.log(`Uploading ${files.length} card emojis...`);

const manifest = {};
for (const file of files) {
  const name = basename(file, extname(file));
  if (existingByName.has(name)) {
    const e = existingByName.get(name);
    console.log(`  = ${name} (already exists, id=${e.id})`);
    manifest[name] = e.id;
    continue;
  }
  const data = readFileSync(join(PNG_DIR, file));
  const dataUri = `data:image/png;base64,${data.toString('base64')}`;
  try {
    const created = await rest.post(Routes.applicationEmojis(CLIENT_ID), {
      body: { name, image: dataUri },
    });
    console.log(`  + ${name} (id=${created.id})`);
    manifest[name] = created.id;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${Object.keys(manifest).length} entries to ${MANIFEST_PATH}`);
console.log('Restart the bot (npm start) to pick up the new manifest.');
