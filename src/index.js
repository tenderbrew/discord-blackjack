import 'dotenv/config';
import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accrueAll } from './db.js';

const ACCRUAL_TICK_MS = 60 * 1000;

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

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('bj:')) {
        const command = client.commands.get('blackjack');
        if (command?.handleButton) await command.handleButton(interaction);
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
