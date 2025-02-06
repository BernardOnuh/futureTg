const { Markup } = require('telegraf');
const axios = require('axios');

const BASE_URL = 'https://fets-database.onrender.com/api/future-edge';
const userStates = new Map();

const LIMITS = {
 gas: { min: 21000, max: 1000000 },
 slippage: { min: 0.1, max: 100 }
};

const commands = {
 handleText: async (ctx) => {
   const userState = userStates.get(ctx.from.id);
   if (!userState?.requestMessageId || 
       ctx.message.reply_to_message?.message_id !== userState.requestMessageId) return false;

   try {
     const telegramId = ctx.from.id.toString();
     const value = userState.action === 'set_gas' ? 
       parseInt(ctx.message.text) : parseFloat(ctx.message.text);
     const type = userState.action === 'set_gas' ? 'gas' : 'slippage';
     const settingKey = type === 'gas' ? 'gas_limit' : 'slippage';
     const { min, max } = LIMITS[type];

     console.log('Processing input:', { value, type, walletName: userState.walletName });

     if (isNaN(value) || value < min || value > max) {
       await ctx.reply(
         `❌ Invalid ${type}!\n` +
         `Range: ${min}${type === 'slippage' ? '%' : ''} - ${max}${type === 'slippage' ? '%' : ''}\n` +
         `Input: ${value}${type === 'slippage' ? '%' : ''}`
       );
       return true;
     }

     const response = await axios.put(
       `${BASE_URL}/wallet/evm/settings/${telegramId}/${userState.walletName}`,
       { settings: { [settingKey]: value } }
     );

     console.log('API Response:', response.data);

     if (response.data?.message) {
       await ctx.reply(
         `✅ Update Successful!\n` +
         `Wallet: ${userState.walletName}\n` +
         `New ${type === 'gas' ? 'Gas Limit' : 'Slippage'}: ${value}${type === 'slippage' ? '%' : ''}`
       );
       await commands.settings(ctx);
     }
   } catch (error) {
     console.error('Settings update error:', error);
     await ctx.reply(`❌ Error: ${error.message}`);
   } finally {
     userStates.delete(ctx.from.id);
   }
   return true;
 },

 async settings(ctx) {
    try {
        const telegramId = ctx.from.id.toString();
        const { data: wallets } = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
    
        if (!wallets?.length) return ctx.reply('❌ Please set up a wallet first using /wallet command');
    
        let message = '⚙️ *Settings Menu*\n\n*Current Settings:*\n\n';
        for (const wallet of wallets) {
          const { data } = await axios.get(`${BASE_URL}/wallet/evm/settings/${telegramId}/${wallet.name}`);
          message += `*${wallet.name}:*\n• Slippage: ${data.settings?.slippage}%\n• Gas Limit: ${data.settings?.gas_limit}\n\n`;
        }

     const keyboard = Markup.inlineKeyboard([
       [
         Markup.button.callback('⚙️ Gas Settings', 'gas_settings'),
         Markup.button.callback('↗️ Slippage Settings', 'slippage_settings')
       ],
       [Markup.button.callback('🌐 Language', 'language_settings')],
       [Markup.button.callback('🏠 Back to Home', 'home')]
     ]);

     await ctx.replyWithMarkdown(message, keyboard);
   } catch (error) {
     console.error('Settings Error:', error);
     await ctx.reply('❌ Error accessing settings. Please try again.');
   }
 },

 setupActions(bot) {
   const handleSettingsView = async (ctx, type) => {
     try {
       await ctx.answerCbQuery();
       const { data: wallets } = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
       if (!wallets?.length) return ctx.reply('❌ No wallets found');

       const currentValue = type === 'gas' ? 'gas_limit' : 'slippage';
       const formatValue = type === 'gas' ? '' : '%';

       const buttons = wallets.map(wallet => ([
         Markup.button.callback(
           `${wallet.name} (${wallet.settings?.[currentValue] || (type === 'gas' ? 300000 : 10)}${formatValue})`,
           `set_${type}_${wallet.name}`
         )
       ]));

       await ctx.reply(`Select wallet to modify ${type}:`,
         Markup.inlineKeyboard([
           ...buttons,
           [Markup.button.callback('🔙 Back to Settings', 'settings')]
         ])
       );
     } catch (error) {
       await ctx.reply(`❌ Error accessing ${type} settings. Please try again.`);
     }
   };

   // Settings handlers
   bot.action('gas_settings', ctx => handleSettingsView(ctx, 'gas'));
   bot.action('slippage_settings', ctx => handleSettingsView(ctx, 'slippage'));

   // Value input handlers
   const setupValueInput = (action, type) => {
     bot.action(new RegExp(`set_${type}_(.+)`), async (ctx) => {
       try {
         await ctx.answerCbQuery();
         const walletName = ctx.match[1];
         const { min, max } = LIMITS[type];
         const message = await ctx.reply(
           `Enter new ${type === 'gas' ? 'gas limit' : 'slippage percentage'} (${min}-${max}):`,
           { reply_markup: { force_reply: true, selective: true } }
         );

         userStates.set(ctx.from.id, {
           action,
           walletName,
           requestMessageId: message.message_id
         });
       } catch (error) {
         await ctx.reply(`❌ Error setting ${type}. Please try again.`);
       }
     });
   };

   setupValueInput('set_gas', 'gas');
   setupValueInput('set_slippage', 'slippage');

   // Navigation
   bot.action('settings', async (ctx) => {
     await ctx.answerCbQuery();
     await commands.settings(ctx);
   });

   // Language handler
   bot.action('language_settings', async (ctx) => {
     await ctx.answerCbQuery();
     await ctx.replyWithMarkdown(
       '🌐 *Select Language*\n\n*Note: More languages coming soon*',
       Markup.inlineKeyboard([
         [
           Markup.button.callback('🇺🇸 English', 'lang_en'),
           Markup.button.callback('🇨🇳 Chinese', 'lang_zh')
         ],
         [
           Markup.button.callback('🇯🇵 Japanese', 'lang_ja'),
           Markup.button.callback('🇰🇷 Korean', 'lang_ko')
         ],
         [
           Markup.button.callback('🇷🇺 Russian', 'lang_ru'),
           Markup.button.callback('🇪🇸 Spanish', 'lang_es')
         ],
         [Markup.button.callback('🔙 Back to Settings', 'settings')]
       ])
     );
   });

   // Language selection
   ['en', 'zh', 'ja', 'ko', 'ru', 'es'].forEach(lang => {
     bot.action(`lang_${lang}`, async (ctx) => {
       await ctx.answerCbQuery();
       await ctx.reply(lang === 'en' ? '✅ Language set to English' : '🔜 Available soon');
       await commands.settings(ctx);
     });
   });
 }
};

module.exports = commands;