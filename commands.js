const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const middlewares = require('./middlewares');
const api = require('./api/scanner');
const axios = require('axios');

const BASE_URL = 'https://fets-database.onrender.com/api/future-edge';
const userStates = new Map();
const settingsHandler = require('./settings');
const importRequestMessages = new Map();



module.exports = {
  userStates,

  async startCommand(ctx) {
    try {
      const firstName = ctx.from.first_name || 'User';
      const Homekeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`📈Buy&Sell`, 'buy&sell'),
          Markup.button.callback(`👝Wallet`, 'wallet'),
        ],
        [
          Markup.button.callback(`📊Positions`, 'show_positions_message'),
          Markup.button.callback(`⚙️Settings`, 'settings'),
        ],
        [
          Markup.button.callback(`🚨Token Scanner`, 'scanner'),
          Markup.button.callback(`📤Transfer`, 'transfer'),
        ],
      ]);

      const ethPriceResponse = await api.getTokenDetails('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      const bscPriceResponse = await api.getTokenDetails('9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa');

      const ethPrice = ethPriceResponse.pairs.length > 0 ? ethPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';
      const bscPrice = bscPriceResponse.pairs.length > 0 ? bscPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';

      ctx.replyWithMarkdown(
        `👋*Welcome* ${firstName} to Future Edge Trading Bot! \n\n` +
        `The *Fastest*⚡ and most *Reliable*🛡️ \n` +

        `🥏 Token Scanner \n\n` +
        
        `🥏 Trade Bot \n\n` +

        `Paste📝 any Token Contract Address on *Eth || Bsc* on this bot to Scan & Trade \n\n` +

        `*Eth || Bsc* \n\n` +
        `Wallet:*Connected*\n\n` +

        `Price $${ethPrice}(ETH/USDT) \n\n` +

        `Price $${bscPrice}(BNB/USDT) \n\n`,
        Homekeyboard
      );
    } catch (error) {
      console.error('Error:', error.message);
      ctx.reply('Error processing the request. Please try again later.');
    }
  },

  helpCommand(ctx) {
    ctx.reply('You asked for help!');
  },


  
  async buysellCommand(ctx) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }
      await ctx.reply('🔍 Paste token address to begin buy & sell ↔️');
    } catch (error) {
      console.error('Error in buy&sell command:', error);
      await ctx.reply('Error processing the request. Please try again later.');
    }
  },

  async scanner(ctx) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }
      await ctx.reply('🔍 Paste token address to scan');
    } catch (error) {
      console.error('Error in buy&sell command:', error);
      await ctx.reply('Error processing the request. Please try again later.');
    }
  },

  async transferCommand(ctx) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }

      const telegramId = ctx.from.id.toString();
      const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
      const wallets = response.data;

      if (!wallets || wallets.length === 0) {
        return ctx.reply('❌ Please set up a wallet first using the /wallet command');
      }

      const transferKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('Transfer ETH', 'transfer_eth'),
          Markup.button.callback('Transfer BNB', 'transfer_bnb')
        ],
        [Markup.button.callback('🔙 Back to Home', 'home')]
      ]);

      await ctx.reply('Select which coin to transfer:', transferKeyboard);
    } catch (error) {
      console.error('Error in transfer command:', error);
      await ctx.reply('Error accessing wallet information. Please try again.');
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
      const bscProvider = new ethers.JsonRpcProvider('https://bnb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi');

      for (const wallet of existingWallets) {
        message += `*${wallet.name}:*\n`;
        message += `Address: \`${wallet.address}\`\n`;
        
        try {
          // Get ETH balance
          const ethBalance = await ethProvider.getBalance(wallet.address);
          const ethBalanceInEther = ethers.formatEther(ethBalance);
          message += `ETH Balance: ${Number(ethBalanceInEther).toFixed(4)} ETH\n`;

          // Get BNB balance
          const bscBalance = await bscProvider.getBalance(wallet.address);
          const bscBalanceInBNB = ethers.formatEther(bscBalance);
          message += `BNB Balance: ${Number(bscBalanceInBNB).toFixed(4)} BNB\n`;
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

    // Handle wallet actions
    bot.action(['import_1', 'import_2'], async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const walletNumber = ctx.match[0].endsWith('1') ? 1 : 2;
        
        // Send message with force reply for private key
        const message = await ctx.reply(
          '🔐 Please send your private key:',
          {
            reply_markup: {
              force_reply: true,
              selective: true
            }
          }
        );

        userStates.set(ctx.from.id, {
          action: 'import',
          walletNumber,
          requestMessageId: message.message_id
        });

      } catch (error) {
        console.error('Error initiating wallet import:', error);
        await ctx.reply('❌ Error starting import process. Please try again.');
      }
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

    // Delete wallet action
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

    // Handle delete wallet selection
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

   bot.action('show_positions_message', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('use command /positions to view your positions');
    });

// Handle transfer actions
bot.action(['transfer_eth', 'transfer_bnb'], async (ctx) => {
  try {
      await ctx.answerCbQuery();
      const coin = ctx.match[0].includes('eth') ? 'ETH' : 'BNB';
      
      const telegramId = ctx.from.id.toString();
      const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
      const wallets = response.data;

      if (!wallets || wallets.length === 0) {
          return ctx.reply('❌ No wallets found. Please set up a wallet first.');
      }

      // Initialize provider based on coin
      const provider = coin === 'ETH'
          ? new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`)
          : new ethers.JsonRpcProvider('https://bnb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi');

      // Get balances for all wallets
      const walletsWithBalance = await Promise.all(wallets.map(async (wallet) => {
          try {
              const balance = await provider.getBalance(wallet.address);
              return {
                  ...wallet,
                  balance: ethers.formatEther(balance)
              };
          } catch (error) {
              console.error(`Error fetching balance for ${wallet.name}:`, error);
              return {
                  ...wallet,
                  balance: '0.0000'
              };
          }
      }));

      // Create message with balances
      let message = `Select wallet to transfer ${coin} from:\n\nAvailable Balances:\n`;
      walletsWithBalance.forEach(wallet => {
          message += `👛 Wallet ${wallet.name.slice(-1)}: ${Number(wallet.balance).toFixed(4)} ${coin}\n`;
      });

      const walletButtons = walletsWithBalance.map(wallet => ([
          Markup.button.callback(
              `Select Wallet ${wallet.name.slice(-1)} (${Number(wallet.balance).toFixed(4)} ${coin})`,
              `select_transfer_${coin.toLowerCase()}_${wallet.name}`
          )
      ]));

      const keyboard = Markup.inlineKeyboard([
          ...walletButtons,
          [Markup.button.callback('❌ Cancel', 'cancel_transfer')]
      ]);

      await ctx.reply(message, keyboard);
  } catch (error) {
      console.error('Error in transfer action:', error);
      await ctx.reply('❌ Error initiating transfer. Please try again.');
  }
});

// Handle wallet selection for transfer
bot.action(/select_transfer_(eth|bnb)_wallet(\d)/, async (ctx) => {
  try {
      await ctx.answerCbQuery();
      const [, coin, walletNum] = ctx.match;
      const upperCoin = coin.toUpperCase();

      // Get wallet balance before proceeding
      const telegramId = ctx.from.id.toString();
      const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
      const wallet = response.data.find(w => w.name === `wallet${walletNum}`);

      if (!wallet) {
          throw new Error('Wallet not found');
      }

      // Get current balance
      const provider = upperCoin === 'ETH'
          ? new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`)
          : new ethers.JsonRpcProvider('https://bnb-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi');

      const balance = await provider.getBalance(wallet.address);
      const formattedBalance = ethers.formatEther(balance);

      // Send message with force reply for recipient address
      const message = await ctx.reply(
          `📍 Enter the recipient address:\n\n` +
          `Selected: Wallet ${walletNum}\n` +
          `Available Balance: ${Number(formattedBalance).toFixed(4)} ${upperCoin}`,
          {
              reply_markup: {
                  force_reply: true,
                  selective: true
              }
          }
      );

      // Store wallet info in state
      userStates.set(ctx.from.id, {
          action: 'transfer_address',
          coin: upperCoin,
          sourceWallet: `wallet${walletNum}`,
          balance: formattedBalance,
          requestMessageId: message.message_id
      });

  } catch (error) {
      console.error('Error in transfer wallet selection:', error);
      await ctx.reply('❌ Error processing selection. Please try again.');
  }
});

    // Cancel transfer action
    bot.action('cancel_transfer', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        await ctx.deleteMessage();
        userStates.delete(ctx.from.id);
      } catch (error) {
        console.error('Error cancelling transfer:', error);
      }
    });

    // Create wallet handlers
    bot.action(['create_1', 'create_2'], async (ctx) => {
      await ctx.answerCbQuery();
      const walletNumber = ctx.callbackQuery.data.endsWith('1') ? 1 : 2;
      await this.handleReplaceWallet(ctx, walletNumber);
    });

    // Home action
    bot.action('home', async (ctx) => {
      await ctx.answerCbQuery();
      await this.startCommand(ctx);
    });

    bot.action('positions', async (ctx) => {
      await ctx.answerCbQuery();
      await positionHandler.positions(ctx);
    });
  
    bot.action('settings', async (ctx) => {
      await ctx.answerCbQuery();
      await settingsHandler.settings(ctx);
    });
  

    // General wallet menu action
    bot.action('wallet', async (ctx) => {
      await ctx.answerCbQuery();
      await this.walletCommand(ctx);
    });



    // Handle text messages
    bot.on('text', async (ctx) => {
      const userId = ctx.from.id;
      const userState = userStates.get(userId);

      // Only process messages that are replies to our requests
      if (!userState || !ctx.message.reply_to_message || 
          ctx.message.reply_to_message.message_id !== userState.requestMessageId) {
        return;
      }

      try {
        switch (userState.action) {
          case 'import':
            await handleImportReply(ctx, userState);
            break;
          case 'transfer_address':
            await handleTransferAddressReply(ctx, userState);
            break;
          case 'transfer_amount':
            await handleTransferAmountReply(ctx, userState);
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
        await ctx.reply('❌ Error processing your request. Please try again.');
        userStates.delete(userId);
      }
    });

      // Scanner action
      bot.action('buy&sell', async (ctx) => {
        await ctx.answerCbQuery();
        await this.buysellCommand(ctx);
      });
  
      // Wallet action
      bot.action('wallet', async (ctx) => {
        await ctx.answerCbQuery();
        await this.walletCommand(ctx);
      });
  
      // Transfer action
      bot.action('transfer', async (ctx) => {
        await ctx.answerCbQuery();
        await this.transferCommand(ctx);
      });
  
      bot.action('positions', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply('use command /positions to view your positions');
      });
  
  
  
      // Snipe action
      bot.action('scanner', async (ctx) => {
        await ctx.answerCbQuery();
        await this.scanner(ctx);
      });
  
      // Home action
      bot.action('home', async (ctx) => {
        await ctx.answerCbQuery();
        await this.startCommand(ctx);
      });
  },

  

  // Helper functions for handling replies
  async handleImportReply(ctx, userState) {
    try {
      const privateKey = ctx.message.text.trim();
      
      // Delete private key message
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.log('Could not delete private key message:', error);
      }
      
      await this.importWallet(ctx, privateKey, userState.walletNumber);

      // Delete request message
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, userState.requestMessageId);
      } catch (error) {
        console.log('Could not delete request message:', error);
      }
    } catch (error) {
      throw new Error('Invalid private key format');
    } finally {
      userStates.delete(ctx.from.id);
    }
  },

  async handleTransferAddressReply(ctx, userState) {
    try {
      const address = ctx.message.text.trim();
      
      if (!this.isValidAddress(address)) {
        throw new Error('Invalid address format');
      }

      // Send message with force reply for amount
      const message = await ctx.reply(
        `💰 Enter the amount of ${userState.coin} to transfer:`,
        {
          reply_markup: {
            force_reply: true,
            selective: true
          }
        }
      );

      userStates.set(ctx.from.id, {
        ...userState,
        action: 'transfer_amount',
        destinationAddress: address,
        requestMessageId: message.message_id
      });

    } catch (error) {
      throw new Error('Invalid address format');
    }
  },

  async handleTransferAmountReply(ctx, userState) {
    try {
      const amount = parseFloat(ctx.message.text.trim());
      
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount');
      }

      const telegramId = ctx.from.id.toString();
      const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
      const wallet = response.data.find(w => w.name === userState.sourceWallet);

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const provider = userState.coin === 'ETH'
        ? new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/nRKZNN7FV_lFECaCuzF1jGPPkcCD8ogi`)
        : new ethers.JsonRpcProvider('https://quaint-neat-cherry.bsc.quiknode.pro/6bca20cae39a942e13525f4048fc30211405a7b5/');

      const walletSigner = new ethers.Wallet(wallet.private_key, provider);
      
      const balance = await provider.getBalance(wallet.address);
      const formattedBalance = ethers.formatEther(balance);

      if (amount > parseFloat(formattedBalance)) {
        throw new Error(`Insufficient balance. Available: ${formattedBalance} ${userState.coin}`);
      }

      const tx = await walletSigner.sendTransaction({
        to: userState.destinationAddress,
        value: ethers.parseEther(amount.toString())
      });

      const explorerUrl = userState.coin === 'ETH'
        ? `https://etherscan.io/tx/${tx.hash}`
        : `https://bscscan.com/tx/${tx.hash}`;

      await ctx.reply(
        `✅ Transfer initiated!\n\n` +
        `Amount: ${amount} ${userState.coin}\n` +
        `To: ${userState.destinationAddress}\n\n` +
        `🔗 [View on Explorer](${explorerUrl})`,
        { parse_mode: 'Markdown' }
      );

    } catch (error) {
      throw new Error(error.message);
    } finally {
      userStates.delete(ctx.from.id);
    }
  },

  // Utility functions
  isValidAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  },

  isValidPrivateKey(privateKey) {
    try {
      new ethers.Wallet(privateKey);
      return true;
    } catch (error) {
      return false;
    }
  }
};