import 'dotenv/config';
import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accrueAll, sweepStaleLiveGames } from './db.js';
import { preloadCards } from './game/imageRender.js';

const ACCRUAL_TICK_MS = 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = join(__dirname, 'commands');
for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(commandsPath, file)).href);
  const command = mod.default;
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const n = await preloadCards();
    console.log(`Pre-warmed ${n} card images.`);
  } catch (err) {
    console.error('Card preload failed:', err);
  }
  for (const command of client.commands.values()) {
    if (typeof command.restore === 'function') {
      try {
        const count = await command.restore();
        if (count > 0) {
          console.log(`Restored ${count} live ${command.data.name} game(s).`);
        }
      } catch (err) {
        console.error(`Restore failed for ${command.data.name}:`, err);
      }
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
    } else if (interaction.isButton()) {
      const ns = interaction.customId.split(':')[0];
      const cmdName = ns === 'bj' ? 'blackjack'
        : ns === 'run' ? 'run'
        : ns === 'prestige' ? 'prestige'
        : null;
      if (cmdName) {
        const command = client.commands.get(cmdName);
        if (command?.handleButton) await command.handleButton(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      const ns = interaction.customId.split(':')[0];
      const cmdName = ns === 'run' ? 'run' : null;
      if (cmdName) {
        const command = client.commands.get(cmdName);
        if (command?.handleModal) await command.handleModal(interaction);
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);

setInterval(() => {
  try {
    accrueAll();
  } catch (err) {
    console.error('Accrual tick error:', err);
  }
}, ACCRUAL_TICK_MS);

setInterval(() => {
  try {
    const swept = sweepStaleLiveGames(STALE_TTL_MS);
    if (swept.length === 0) return;
    for (const row of swept) {
      const cmd = client.commands.get(row.kind);
      cmd?.dropFromMemory?.(row.message_id);
    }
    console.log(`Swept ${swept.length} stale live game(s).`);
  } catch (err) {
    console.error('Sweep error:', err);
  }
}, SWEEP_INTERVAL_MS);
