// commands.js
const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const middlewares = require('./middlewares');
const api = require('./api/scanner');
const axios = require('axios');

const BASE_URL = 'https://fets-database.onrender.com/api/future-edge';
const userStates = new Map();
const importRequestMessages = new Map();

module.exports = {
  userStates,

  async startCommand(ctx) {
    try {
      const firstName = ctx.from.first_name || 'User';
      const Homekeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`🚨Token Scanner`, 'scanner'),
          Markup.button.callback(`👝Wallet`, 'wallet'),
        ],
        [
          Markup.button.callback(`📊Active Trades`, 'active'),
          Markup.button.callback(`⚙️Settings`, 'settings'),
        ],
        [
          Markup.button.callback(`🌉Bridge`, 'bridge'),
          Markup.button.callback(`📤Transfer`, 'transfer'),
        ],
        [
          Markup.button.callback(`🔫Snipe`, 'snipe'),
        ],
      ]);

      const ethPriceResponse = await api.getTokenDetails('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      const bscPriceResponse = await api.getTokenDetails('0xb8c77482e45f1f44de1745f52c74426c631bdd52');

      const ethPrice = ethPriceResponse.pairs.length > 0 ? ethPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';
      const bscPrice = bscPriceResponse.pairs.length > 0 ? bscPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';

      ctx.replyWithMarkdown(
        `👋*Welcome* ${firstName} to Future Edge Trading Bot! \n\n` +
        `The *Fastest*⚡ and most *Reliable*🛡️ \n` +
        `🥏 Token Scanner \n` +
        `🥏 Trade Bot \n\n` +
        `Paste📝 any Token Contract Address on *Eth || Bsc* on this bot to Scan & Trade \n\n` +
        `*Eth || Bsc* \n` +
        `Wallet:*Not Connected*\n \n` +
        `Price $${ethPrice}(ETH/USDT) \n` +
        `Price $${bscPrice}(BNB/USDT) \n\n` +
        `👁️ 0 Tracked Token(s) \n` +
        `🙈 0 Position(s)`,
        Homekeyboard,
        Markup.keyboard(['/help']).resize()
      );
    } catch (error) {
      console.error('Error:', error.message);
      ctx.reply('Error processing the request. Please try again later.');
    }
  },

  helpCommand(ctx) {
    ctx.reply('You asked for help!');
  },

  async scannerCommand(ctx) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }
      await ctx.reply('🔍 Drop your token address below so Future Edge would give it a quick Scan and Audit');
    } catch (error) {
      console.error('Error in scanner command:', error);
      await ctx.reply('Error processing the request. Please try again later.');
    }
  },

  async walletCommand(ctx) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }

      const telegramId = ctx.from.id.toString();
      let existingWallets = [];

      try {
        const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
        existingWallets = response.data;
      } catch (error) {
        console.log('No existing wallets found or other error:', error.message);
      }

      if (!existingWallets || existingWallets.length === 0) {
        try {
          // Create wallet 1
          const wallet1 = ethers.Wallet.createRandom();
          const wallet1Data = {
            telegram_id: telegramId,
            name: 'wallet1',
            address: wallet1.address,
            private_key: wallet1.privateKey,
            seed_phrase: wallet1.mnemonic?.phrase || 'No mnemonic available'
          };

          // Create wallet 2
          const wallet2 = ethers.Wallet.createRandom();
          const wallet2Data = {
            telegram_id: telegramId,
            name: 'wallet2',
            address: wallet2.address,
            private_key: wallet2.privateKey,
            seed_phrase: wallet2.mnemonic?.phrase || 'No mnemonic available'
          };

          // Save both wallets
          await axios.post(`${BASE_URL}/wallet/evm`, wallet1Data);
          await axios.post(`${BASE_URL}/wallet/evm`, wallet2Data);

          await ctx.replyWithMarkdown(
            `✨ *Your wallets have been created:*\n\n` +
            `*Wallet 1:*\n` +
            `Address: \`${wallet1.address}\`\n\n` +
            `*Wallet 2:*\n` +
            `Address: \`${wallet2.address}\`\n\n` +
            `🔒 *Secure Information will be sent in private message*`
          );

          await ctx.telegram.sendMessage(ctx.from.id,
            `🔐 *SECURE WALLET INFORMATION - SAVE THIS SAFELY!*\n\n` +
            `*Wallet 1:*\n` +
            `Private Key: \`${wallet1.privateKey}\`\n` +
            `Seed Phrase: \`${wallet1.mnemonic?.phrase || 'No mnemonic available'}\`\n\n` +
            `*Wallet 2:*\n` +
            `Private Key: \`${wallet2.privateKey}\`\n` +
            `Seed Phrase: \`${wallet2.mnemonic?.phrase || 'No mnemonic available'}\``,
            { parse_mode: 'Markdown' }
          );

          const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
          existingWallets = response.data;
        } catch (error) {
          console.error('Error creating wallets:', error);
          await ctx.reply('Error creating wallets. Please try again.');
          return;
        }
      }

      const walletKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Create New Wallet', 'create_new'),
          Markup.button.callback('📥 Import Wallet', 'import')
        ],
        [
          Markup.button.callback('📤 Export Private Key', 'export'),
          Markup.button.callback('💰 Balance', 'balance')
        ],
        [
          Markup.button.callback('🗑️ Delete Wallet', 'delete'),
          Markup.button.callback('🏠 Back to Home', 'home')
        ]
      ]);

      let message = '👝 *Your Wallets*\n\n';
      
      // Initialize providers
      const ethProvider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`);
      const bscProvider = new ethers.JsonRpcProvider('https://quaint-neat-cherry.bsc.quiknode.pro/6bca20cae39a942e13525f4048fc30211405a7b5/');

      for (const wallet of existingWallets) {
        message += `*${wallet.name}:*\n`;
        message += `Address: \`${wallet.address}\`\n`;
        
        try {
          // Get ETH balance
          const ethBalance = await ethProvider.getBalance(wallet.address);
          const ethBalanceInEther = ethers.formatEther(ethBalance);
          message += `ETH Balance: ${Number(ethBalanceInEther).toFixed(4)} ETH\n`;

          // Get BSC balance
          const bscBalance = await bscProvider.getBalance(wallet.address);
          const bscBalanceInBNB = ethers.formatEther(bscBalance);
          message += `BSC Balance: ${Number(bscBalanceInBNB).toFixed(4)} BNB\n`;
        } catch (error) {
          console.error('Error fetching balances:', error);
          message += `Balance: Error fetching balance\n`;
        }
        
        message += '\n';
      }

      await ctx.replyWithMarkdown(message, walletKeyboard);

    } catch (error) {
      console.error('Error in wallet command:', error);
      await ctx.reply('Error accessing wallet information. Please try again.');
    }
  },

  async handleReplaceWallet(ctx, walletNumber) {
    try {
      const telegramId = ctx.from.id.toString();
      const wallet = ethers.Wallet.createRandom();
      
      const walletData = {
        telegram_id: telegramId,
        name: `wallet${walletNumber}`,
        address: wallet.address,
        private_key: wallet.privateKey,
        seed_phrase: wallet.mnemonic?.phrase || 'No mnemonic available'
      };

      // Delete existing wallet if it exists
      try {
        await axios.delete(`${BASE_URL}/wallet/evm/${telegramId}/wallet${walletNumber}`);
      } catch (error) {
        console.log('No existing wallet to delete');
      }

      await axios.post(`${BASE_URL}/wallet/evm`, walletData);

      await ctx.replyWithMarkdown(
        `✅ *New Wallet ${walletNumber} Created:*\n\n` +
        `Address: \`${wallet.address}\`\n\n` +
        `🔐 *SECURE INFORMATION - SAVE THIS SAFELY!*\n` +
        `Private Key: \`${wallet.privateKey}\`\n` +
        `Seed Phrase: \`${wallet.mnemonic?.phrase || 'No mnemonic available'}\``
      );

      await this.walletCommand(ctx);
    } catch (error) {
      console.error('Error replacing wallet:', error);
      await ctx.reply('Error creating new wallet. Please try again.');
    }
  },

  async importWallet(ctx, privateKey, walletNumber) {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const telegramId = ctx.from.id.toString();

      const walletData = {
        telegram_id: telegramId,
        name: `wallet${walletNumber}`,
        address: wallet.address,
        private_key: privateKey,
        seed_phrase: 'Imported wallet - No seed phrase'
      };

      // Delete existing wallet if it exists
      try {
        await axios.delete(`${BASE_URL}/wallet/evm/${telegramId}/wallet${walletNumber}`);
      } catch (error) {
        console.log('No existing wallet to delete');
      }

      await axios.post(`${BASE_URL}/wallet/evm`, walletData);

      await ctx.replyWithMarkdown(
        `✅ *Wallet ${walletNumber} successfully imported!*\n\n` +
        `Address: \`${wallet.address}\`\n\n` +
        `Use the wallet menu to check your balance.`
      );

      await this.walletCommand(ctx);
    } catch (error) {
      console.error('Error importing wallet:', error);
      await ctx.reply('Invalid private key or error importing wallet. Please try again.');
    }
  },

  setupWalletActions(bot) {
    // Create new wallet action
    bot.action('create_new', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Select which wallet to create:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Create Wallet 1', 'create_1'),
            Markup.button.callback('Create Wallet 2', 'create_2')
          ],
          [Markup.button.callback('🔙 Back', 'wallet')]
        ])
      );
    });

    // Import wallet action
    bot.action('import', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Select which wallet slot to import to:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Import to Wallet 1', 'import_1'),
            Markup.button.callback('Import to Wallet 2', 'import_2')
          ],
          [Markup.button.callback('🔙 Back', 'wallet')]
        ])
      );
    });

    // Export private key action
    bot.action('export', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Select which wallet to export:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Export Wallet 1', 'export_1'),
            Markup.button.callback('Export Wallet 2', 'export_2')
          ],
          [Markup.button.callback('🔙 Back', 'wallet')]
        ])
      );
    });

    // Handle export wallet selection
    bot.action(['export_1', 'export_2'], async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const telegramId = ctx.from.id.toString();
        const walletNumber = ctx.callbackQuery.data.endsWith('1') ? '1' : '2';

        const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
        const wallets = response.data;
        const wallet = wallets.find(w => w.name === `wallet${walletNumber}`);

        if (!wallet) {
          await ctx.reply(`Wallet ${walletNumber} not found.`);
          return;
        }

        await ctx.telegram.sendMessage(ctx.from.id,
          `🔐 *SECURE INFORMATION - SAVE THIS SAFELY!*\n\n` +
          `*Wallet ${walletNumber} Private Key:*\n` +
          `\`${wallet.private_key}\`\n\n` +
          `*Seed Phrase:*\n` +
          `\`${wallet.seed_phrase}\``,
          { parse_mode: 'Markdown' }
        );

        await ctx.reply('Private key has been sent to you in a private message. Keep it safe!');
      } catch (error) {
        console.error('Error exporting wallet:', error);
        await ctx.reply('Error exporting wallet information. Please try again.');
      }
    });

    // Balance check action
    bot.action('balance', async (ctx) => {
      await ctx.answerCbQuery();
      await this.walletCommand(ctx);
    });

 // Delete wallet action (continued)
 bot.action('delete', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Select which wallet to delete:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Delete Wallet 1', 'delete_1'),
        Markup.button.callback('Delete Wallet 2', 'delete_2')
      ],
      [Markup.button.callback('🔙 Back', 'wallet')]
    ])
  );
});

// Delete wallet handlers
bot.action(['delete_1', 'delete_2'], async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const walletNumber = ctx.callbackQuery.data.endsWith('1') ? '1' : '2';
  
  try {
    await axios.delete(`${BASE_URL}/wallet/evm/${telegramId}/wallet${walletNumber}`);
    await ctx.reply(`Wallet ${walletNumber} deleted successfully`);
    await this.walletCommand(ctx);
  } catch (error) {
    console.error(`Error deleting wallet ${walletNumber}:`, error);
    await ctx.reply('Error deleting wallet. Please try again.');
  }
});

// Create wallet handlers
bot.action(['create_1', 'create_2'], async (ctx) => {
  await ctx.answerCbQuery();
  const walletNumber = ctx.callbackQuery.data.endsWith('1') ? 1 : 2;
  await this.handleReplaceWallet(ctx, walletNumber);
});

// Import wallet handlers
bot.action(['import_1', 'import_2'], async (ctx) => {
  await ctx.answerCbQuery();
  const walletNumber = ctx.callbackQuery.data.endsWith('1') ? 1 : 2;
  
  // Send message with force reply
  const message = await ctx.reply('Please send me the private key for the wallet:', {
    reply_markup: {
      force_reply: true,
      selective: true
    },
    reply_to_message_id: ctx.callbackQuery.message.message_id
  });

  // Store the message ID and wallet number for this import request
  userStates.set(ctx.from.id, { 
    action: 'import', 
    walletNumber,
    requestMessageId: message.message_id 
  });
});

// Home action
bot.action('home', async (ctx) => {
  await ctx.answerCbQuery();
  await this.startCommand(ctx);
});

// General wallet menu action
bot.action('wallet', async (ctx) => {
  await ctx.answerCbQuery();
  await this.walletCommand(ctx);
});

// Buy action handler
bot.action('buy', async (ctx) => {
  await ctx.answerCbQuery();
  // Implement buy functionality here
  await ctx.reply('Buy functionality coming soon!');
});

// Handle text messages for wallet import
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  // Check if this is an active import request
  if (userState && userState.action === 'import') {
    // Check if this message is a reply to our import request
    if (!ctx.message.reply_to_message || 
        ctx.message.reply_to_message.message_id !== userState.requestMessageId) {
      // Ignore messages that aren't proper replies
      return;
    }

    try {
      const privateKey = ctx.message.text.trim();
      
      // Delete the message containing the private key for security
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.log('Could not delete message:', error);
      }
      
      await importWallet(ctx, privateKey, userState.walletNumber);
      userStates.delete(userId);

      // Also delete the original request message for security
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, userState.requestMessageId);
      } catch (error) {
        console.log('Could not delete request message:', error);
      }
    } catch (error) {
      console.error('Error processing private key:', error);
      await ctx.reply('Invalid private key format. Please try again.');
      userStates.delete(userId);
    }
  }
});
},

// Additional utility functions
async getTokenBalances(address, providers) {
const balances = {
  eth: '0',
  bsc: '0'
};

try {
  // Get ETH balance
  const ethBalance = await providers.eth.getBalance(address);
  balances.eth = ethers.formatEther(ethBalance);

  // Get BSC balance
  const bscBalance = await providers.bsc.getBalance(address);
  balances.bsc = ethers.formatEther(bscBalance);
} catch (error) {
  console.error('Error fetching balances:', error);
}

return balances;
},

// Function to validate Ethereum address
isValidAddress(address) {
try {
  return ethers.isAddress(address);
} catch (error) {
  return false;
}
},

// Function to validate private key
isValidPrivateKey(privateKey) {
try {
  new ethers.Wallet(privateKey);
  return true;
} catch (error) {
  return false;
}
}
};