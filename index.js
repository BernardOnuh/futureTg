// index.js
const { Telegraf } = require('telegraf');
const config = require('./config');
const commands = require('./commands');
const middlewares = require('./middlewares');

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Middlewares
bot.use(middlewares.logMiddleware);

// Commands
bot.command('start', commands.startCommand);

bot.action('wallet', commands.walletCommand);

bot.help(commands.helpCommand);


// Start the bot
bot.launch().then(() => console.log('Bot is running'));
