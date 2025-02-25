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
      const telegramId = ctx.from.id.toString();
      const firstName = ctx.from.first_name || 'User';
      
      // Check if user already exists and has wallets
      let walletStatus = "Connected";
      let loadingMessage = null;
      let walletsCreated = false;
      
      try {
        // First check if user exists by trying to get their wallets
        const walletResponse = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
        const userWallets = walletResponse.data;
        
        // If we got an empty array, user exists but has no wallets
        // If we get no response or error, user might not exist
        if (!userWallets || userWallets.length === 0) {
          // Show loading message while setting up
          loadingMessage = await ctx.reply('🔄 Setting up your account...');
          
          // Create wallet 1
          const wallet1 = ethers.Wallet.createRandom();
          const wallet1Data = {
            telegram_id: telegramId,
            name: 'wallet1',
            address: wallet1.address,
            private_key: wallet1.privateKey,
            seed_phrase: wallet1.mnemonic?.phrase || 'No mnemonic available',
            settings: {
              slippage: 10,
              gas_limit: 500000
            }
          };
  
          // Create wallet 2
          const wallet2 = ethers.Wallet.createRandom();
          const wallet2Data = {
            telegram_id: telegramId,
            name: 'wallet2',
            address: wallet2.address,
            private_key: wallet2.privateKey,
            seed_phrase: wallet2.mnemonic?.phrase || 'No mnemonic available',
            settings: {
              slippage: 10,
              gas_limit: 500000
            }
          };
  
          // Create wallets - this will also create the user if they don't exist
          // The walletController.createEvmWallet handles user creation if needed
          await axios.post(`${BASE_URL}/wallet/evm`, wallet1Data);
          await axios.post(`${BASE_URL}/wallet/evm`, wallet2Data);
          
          // Generate and store a referral code for new users
          try {
            await axios.post(`${BASE_URL}/wallet/generateReferral/${telegramId}`);
          } catch (refError) {
            console.log('Error generating referral code:', refError);
            // Non-critical, continue without referral code
          }
          
          walletsCreated = true;
        }
      } catch (error) {
        // Check if this is a "user not found" error
        if (error.response && error.response.status === 404) {
          // User doesn't exist, we'll create them with wallets
          try {
            loadingMessage = await ctx.reply('🔄 Creating your account...');
            
            // Create wallet 1
            const wallet1 = ethers.Wallet.createRandom();
            const wallet1Data = {
              telegram_id: telegramId,
              name: 'wallet1',
              address: wallet1.address,
              private_key: wallet1.privateKey,
              seed_phrase: wallet1.mnemonic?.phrase || 'No mnemonic available',
              settings: {
                slippage: 10,
                gas_limit: 500000
              }
            };
  
            // Create wallet 2
            const wallet2 = ethers.Wallet.createRandom();
            const wallet2Data = {
              telegram_id: telegramId,
              name: 'wallet2',
              address: wallet2.address,
              private_key: wallet2.privateKey,
              seed_phrase: wallet2.mnemonic?.phrase || 'No mnemonic available',
              settings: {
                slippage: 10,
                gas_limit: 500000
              }
            };
  
            // First wallet creation will create the user
            await axios.post(`${BASE_URL}/wallet/evm`, wallet1Data);
            await axios.post(`${BASE_URL}/wallet/evm`, wallet2Data);
            
            walletsCreated = true;
          } catch (createError) {
            console.error('Error creating user with wallets:', createError);
            walletStatus = "Error ❌";
          }
        } else {
          console.error('Error checking user existence:', error);
          walletStatus = "Error ❌";
        }
      }
      
      // Delete loading message if it exists
      if (loadingMessage) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
      }
  
      const Homekeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`📈 Buy & Sell`, 'buy&sell'),
          Markup.button.callback(`👝 Wallet`, 'wallet'),
        ],
        [
          Markup.button.callback(`📊 Positions`, 'show_positions_message'),
          Markup.button.callback(`⚙️ Settings`, 'settings'),
        ],
        [
          Markup.button.callback(`🔍 Token Scanner`, 'scanner'),
          Markup.button.callback(`📤 Transfer`, 'transfer'),
        ],
      ]);
  
      // Fetch token prices for ETH and BNB
      const [ethPriceResponse, bscPriceResponse] = await Promise.all([
        api.getTokenDetails('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
        api.getTokenDetails('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
      ]).catch(error => {
        console.error('Error fetching token prices:', error);
        return [{ pairs: [] }, { pairs: [] }];
      });
  
      const ethPrice = ethPriceResponse.pairs?.length > 0 ? ethPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';
      const bscPrice = bscPriceResponse.pairs?.length > 0 ? bscPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';
  
      ctx.replyWithMarkdown(
        `👋 *Welcome ${firstName} to Future Edge Trading Bot!* \n\n` +
        `The *Fastest* ⚡ and most *Reliable* 🛡️ \n` +
        `🔍 Token Scanner \n` +
        `💱 Trading Bot \n\n` +
        `Paste 📝 any Token Contract Address on *ETH or BSC* to Scan & Trade\n\n` +
        `*Market Prices:*\n` +
        `- ETH: $${ethPrice}\n` +
        `- BNB: $${bscPrice}\n\n` +
        `*Wallet Status:* ${walletsCreated ? "Created ✅" : walletStatus}`,
        Homekeyboard
      );
      
      // If we just created wallets, add a short delay then show message
      if (walletsCreated) {
        setTimeout(async () => {
          await ctx.reply(
            "✅ Your wallets have been automatically created. Use the 👝 Wallet button to manage them and view your wallet addresses."
          );
        }, 2000);
      }
      
    } catch (error) {
      console.error('Error in start command:', error);
      ctx.reply('Error processing your request. Please try again later.');
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
      console.error('Error in scanner command:', error);
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
      const ethProvider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
      const bscProvider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);

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
    ['import_1', 'import_2'].forEach(action => {
      bot.action(action, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const walletNumber = action.endsWith('1') ? 1 : 2;
          
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
    });


// Transfer action handlers
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
      ? new ethers.JsonRpcProvider(process.env.ETH_RPC_URL)
      : new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);

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

    // Create wallet selection buttons with balances
    const walletButtons = walletsWithBalance.map(wallet => ([
      Markup.button.callback(
        `${wallet.name} (${Number(wallet.balance).toFixed(4)} ${coin})`,
        `wallet_transfer_${coin.toLowerCase()}_${wallet.name}`
      )
    ]));

    const keyboard = Markup.inlineKeyboard([
      ...walletButtons,
      [Markup.button.callback('❌ Cancel', 'cancel_transfer')]
    ]);

    await ctx.reply(
      `Select wallet to transfer ${coin} from:\n\n` +
      `Available Balances:\n` +
      walletsWithBalance.map(w => 
        `${w.name}: ${Number(w.balance).toFixed(4)} ${coin}`
      ).join('\n'),
      keyboard
    );

  } catch (error) {
    console.error('Error in transfer action:', error);
    await ctx.reply('❌ Error initiating transfer. Please try again.');
  }
});

// Handle wallet selection for transfer
bot.action(/wallet_transfer_(eth|bnb)_wallet(\d)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const [, coin, walletNum] = ctx.match;
    const upperCoin = coin.toUpperCase();

    const telegramId = ctx.from.id.toString();
    const response = await axios.get(`${BASE_URL}/wallet/evm/${telegramId}`);
    const wallet = response.data.find(w => w.name === `wallet${walletNum}`);

    if (!wallet) {
      return ctx.reply('❌ Wallet not found. Please try again.');
    }

    // Get current balance
    const provider = upperCoin === 'ETH'
      ? new ethers.JsonRpcProvider(process.env.ETH_RPC_URL)
      : new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);

    const balance = await provider.getBalance(wallet.address);
    const formattedBalance = ethers.formatEther(balance);

    // Prompt for recipient address
    const message = await ctx.reply(
      `📍 Enter the recipient address:\n\n` +
      `Selected: wallet${walletNum}\n` +
      `Available Balance: ${Number(formattedBalance).toFixed(4)} ${upperCoin}`,
      {
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }
    );

    // Store transfer state in bot's user state
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

// Cancel transfer
bot.action('cancel_transfer', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    userStates.delete(ctx.from.id);
  } catch (error) {
    console.error('Error cancelling transfer:', error);
  }
});

    // Handle export wallet selection
    ['export_1', 'export_2'].forEach(action => {
      bot.action(action, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const telegramId = ctx.from.id.toString();
          const walletNumber = action.endsWith('1') ? '1' : '2';

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
    ['delete_1', 'delete_2'].forEach(action => {
      bot.action(action, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const telegramId = ctx.from.id.toString();
          const walletNumber = action.endsWith('1') ? '1' : '2';
          
          const confirmKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Yes, Delete', `confirm_delete_${walletNumber}`),
              Markup.button.callback('❌ No, Cancel', 'wallet')
            ]
          ]);

          await ctx.reply(
            `⚠️ Are you sure you want to delete Wallet ${walletNumber}?\n` +
            'This action cannot be undone.',
            confirmKeyboard
          );
        } catch (error) {
          console.error(`Error in delete wallet selection:`, error);
          await ctx.reply('Error processing delete request. Please try again.');
        }
      });
    });

    // Handle delete confirmation
    ['confirm_delete_1', 'confirm_delete_2'].forEach(action => {
      bot.action(action, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const telegramId = ctx.from.id.toString();
          const walletNumber = action.endsWith('1') ? '1' : '2';
          
          await axios.delete(`${BASE_URL}/wallet/evm/${telegramId}/wallet${walletNumber}`);
          await ctx.reply(`✅ Wallet ${walletNumber} successfully deleted`);
          await this.walletCommand(ctx);
        } catch (error) {
          console.error(`Error deleting wallet ${walletNumber}:`, error);
          await ctx.reply('Error deleting wallet. Please try again.');
        }
      });
    });

    // Create wallet handlers
    ['create_1', 'create_2'].forEach(action => {
      bot.action(action, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const walletNumber = action.endsWith('1') ? 1 : 2;
          await this.handleReplaceWallet(ctx, walletNumber);
        } catch (error) {
          console.error('Error creating wallet:', error);
          await ctx.reply('Error creating new wallet. Please try again.');
        }
      });
    });

    // Navigation actions
    bot.action('home', async (ctx) => {
      await ctx.answerCbQuery();
      await this.startCommand(ctx);
    });

    bot.action('wallet', async (ctx) => {
      await ctx.answerCbQuery();
      await this.walletCommand(ctx);
    });

    // Buy & Sell action
    bot.action('buy&sell', async (ctx) => {
      await ctx.answerCbQuery();
      await this.buysellCommand(ctx);
    });

    // Scanner action
    bot.action('scanner', async (ctx) => {
      await ctx.answerCbQuery();
      await this.scanner(ctx);
    });

    // Transfer action
    bot.action('transfer', async (ctx) => {
      await ctx.answerCbQuery();
      await this.transferCommand(ctx);
    });

    // Positions action
    bot.action('show_positions_message', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('use command /positions to view your positions');
    });

    // Settings action
    bot.action('settings', async (ctx) => {
      await ctx.answerCbQuery();
      await settingsHandler.settings(ctx);
    });
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
      if (!privateKey.startsWith('0x')) {
        privateKey = `0x${privateKey}`;
      }
      new ethers.Wallet(privateKey);
      return true;
    } catch (error) {
      return false;
    }
  },

  async clearUserState(ctx) {
    try {
      const userId = ctx.from.id;
      userStates.delete(userId);
      if (importRequestMessages.has(userId)) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, importRequestMessages.get(userId));
        } catch (error) {
          console.log('Could not delete import request message:', error);
        }
        importRequestMessages.delete(userId);
      }
    } catch (error) {
      console.error('Error clearing user state:', error);
    }
  },

  // Helper function to format wallet display
  async getWalletDisplay(wallet, ethProvider, bscProvider) {
    try {
      const ethBalance = await ethProvider.getBalance(wallet.address);
      const bscBalance = await bscProvider.getBalance(wallet.address);
      
      return {
        name: wallet.name,
        address: wallet.address,
        ethBalance: ethers.formatEther(ethBalance),
        bscBalance: ethers.formatEther(bscBalance)
      };
    } catch (error) {
      console.error('Error getting wallet display:', error);
      return {
        name: wallet.name,
        address: wallet.address,
        ethBalance: '0.0000',
        bscBalance: '0.0000'
      };
    }
  }
};