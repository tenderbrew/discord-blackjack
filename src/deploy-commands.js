import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const commands = [];
const commandsPath = join(__dirname, 'commands');
for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(commandsPath, file)).href);
  commands.push(mod.default.data.toJSON());
}

const rest = new REST().setToken(DISCORD_TOKEN);

console.log(`Deploying ${commands.length} command(s) to guild ${GUILD_ID}...`);
const data = await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands },
);
console.log(`Deployed ${data.length} command(s).`);
