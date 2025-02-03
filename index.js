const { Telegraf, Markup, session } = require('telegraf');
const { ethers } = require('ethers');
const axios = require('axios');
const config = require('./config');
const commands = require('./commands');
const middlewares = require('./middlewares');
const { 
  scanToken,
  extractTokenData,
  formatPrice,
  formatNumberWithCommas,
  getTradeVolume,
  formatFindings,
  getDexScreenerUrl
} = require('./utils/tokenScanner');
const TradeExecutor = require('./tradeExecutor');
const BASE_URL = config.BASE_URL;

// ABIs
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)"
];

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Enable session handling
bot.use(session());

// Middlewares
bot.use(middlewares.logMiddleware);

// Basic Commands
bot.command('start', commands.startCommand);
bot.command('help', commands.helpCommand);
bot.command('wallet', commands.walletCommand);
bot.command('buy&sell', commands.buysellCommand);
bot.command('transfer', commands.transferCommand);
bot.command('scanner', commands.scanner);
bot.command('positions', commands.scanner);

// Get balances for both wallets
async function getWalletBalances(userId, chain) {
    try {
        const response = await axios.get(`${BASE_URL}/wallet/evm/${userId}`);
        const wallets = response.data;
        if (!wallets || wallets.length === 0) return [];

        const providers = {
            eth: new ethers.JsonRpcProvider(process.env.ETH_RPC_URL),
            bsc: new ethers.JsonRpcProvider(process.env.BSC_RPC_URL)
        };

        const provider = providers[chain.toLowerCase()];
        const balances = await Promise.all(wallets.map(async (wallet) => {
            try {
                const balance = await provider.getBalance(wallet.address);
                return {
                    name: wallet.name,
                    address: wallet.address,
                    balance: ethers.formatEther(balance).slice(0, 6)
                };
            } catch (error) {
                console.error(`Error fetching balance for wallet ${wallet.name}:`, error);
                return {
                    name: wallet.name,
                    address: wallet.address,
                    balance: '0.0000'
                };
            }
        }));

        return balances;
    } catch (error) {
        console.error('Error fetching wallet balances:', error);
        return [];
    }
}

// Get token balance for all wallets
async function getTokenBalances(userId, tokenAddress, chain) {
    try {
        const response = await axios.get(`${BASE_URL}/wallet/evm/${userId}`);
        const wallets = response.data;
        if (!wallets || wallets.length === 0) return [];

        const provider = new ethers.JsonRpcProvider(
            chain.toLowerCase() === 'eth' ? process.env.ETH_RPC_URL : process.env.BSC_RPC_URL
        );

        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([
            token.symbol(),
            token.decimals()
        ]);

        const balances = await Promise.all(wallets.map(async (wallet) => {
            try {
                const balance = await token.balanceOf(wallet.address);
                return {
                    name: wallet.name,
                    balance: ethers.formatUnits(balance, decimals),
                    symbol,
                    rawBalance: balance
                };
            } catch (error) {
                console.error(`Error fetching token balance for wallet ${wallet.name}:`, error);
                return {
                    name: wallet.name,
                    balance: '0.0000',
                    symbol,
                    rawBalance: BigInt(0)
                };
            }
        }));

        return balances;
    } catch (error) {
        console.error('Error fetching token balances:', error);
        return [];
    }
}

// Calculate price impact
function calculatePriceImpact(data, chainName) {
    try {
        const testAmount = 5;
        const liquidity = Number(data.liquidity?.quote) || 0;
        if (liquidity === 0) return 'N/A';
        
        const impact = (testAmount / liquidity) * 100;
        return impact.toFixed(2);
    } catch (error) {
        return 'N/A';
    }
}


async function formatBriefResponse(data, address, chainName, userId, tradeMode = 'buy') {
  try {
      const tokenData = extractTokenData(data);
      const tokenName = tokenData.name?.length > 20 ? tokenData.name.slice(0, 17) + '...' : tokenData.name;
      
      // Modify chainName to BNB if it's BSC
      const displayChainName = chainName === 'BSC' ? 'BNB' : chainName;

      // Get wallet balances
      const walletBalances = await getWalletBalances(userId, chainName);
      const tokenBalances = await getTokenBalances(userId, address, chainName);
       
      // Format balances text
      const walletBalanceText = walletBalances.map(wallet =>
           `👛 ${wallet.name}: ${wallet.balance} ${displayChainName}`
      ).join('\n');
       
      const tokenBalanceText = tokenBalances.map(balance =>
           `🪙 ${balance.name}: ${Number(balance.balance).toFixed(4)} ${balance.symbol}`
      ).join('\n');
       
      // Get 24h trading activity
      const volume24h = tokenData.volume.h24;
      const trades24h = tokenData.transactions.h24;
      const totalTrades = trades24h.buys + trades24h.sells;
       
      // Format the message
      return `${tokenName} | ${tokenData.symbol} |

${address}

💰 Price: $${formatPrice(tokenData.priceUsd)}
📊 5m: ${tokenData.priceChange.m5.toFixed(2)}%, 1h: ${tokenData.priceChange.h1.toFixed(2)}%, 6h: ${tokenData.priceChange.h6.toFixed(2)}%, 24h: ${tokenData.priceChange.h24.toFixed(2)}%
💎 Market Cap: $${formatNumberWithCommas(tokenData.marketCap)}
💧 Liquidity: $${formatNumberWithCommas(tokenData.liquidity.usd)}
📈 24h Volume: $${formatNumberWithCommas(volume24h)}
🔄 24h Trades: ${trades24h.buys} buys, ${trades24h.sells} sells

⚖️ Price Impact (5.0000 ${displayChainName}): ${calculatePriceImpact(tokenData, chainName)}%

${displayChainName} Balances:
${walletBalanceText}

Token Balances:
${tokenBalanceText}

To ${tradeMode}, press one of the buttons below:`;

  } catch (error) {
      console.error('Error formatting brief response:', error);
      return 'Error formatting token information. Please try again.';
  }
}

// Updated createTradingButtons function with new sell options
function createTradingButtons(chainName, tradeMode = 'buy') {
  const displayChainName = chainName === 'BSC' ? 'BNB' : chainName;

  const buttons = [
      [Markup.button.callback('❌ Cancel', 'cancel')],
  ];
  
  if (tradeMode === 'buy') {
      buttons.push([
          Markup.button.callback(`Buy 0.1 ${displayChainName}`, `buy_0.1`),
          Markup.button.callback(`Buy 0.5 ${displayChainName}`, `buy_0.5`),
          Markup.button.callback(`Buy X ${displayChainName}`, `buy_custom`)
      ]);
  } else {
      buttons.push([
          Markup.button.callback('Sell 100%', `sell_all`),
          Markup.button.callback('Sell 50%', `sell_50`),
          Markup.button.callback('Sell X%', `sell_custom`)
      ]);
  }
  
  buttons.push([
      Markup.button.callback('🔄 Toggle Buy/Sell', 'toggle_mode'),
      Markup.button.callback('🔄 Refresh', 'refresh')
  ]);
  
  return buttons;
}

// Handle sell 50% action
bot.action('sell_50', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      // Get available wallets
      const response = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
      const wallets = response.data;
      
      if (!wallets || wallets.length === 0) {
          return ctx.reply('❌ Please set up a wallet first using the /wallet command');
      }

      const scanResult = ctx.session.lastScan.result;
      
      ctx.session.pendingTrade = {
          tokenAddress: ctx.session.lastScan.address,
          mode: 'sell',
          chain: scanResult.chain.toUpperCase(),
          amount: '50%'
      };

      const walletButtons = wallets.map(wallet => ([
          Markup.button.callback(
              `👛 ${wallet.name}`, 
              `select_wallet_sell_${wallet.name}`
          )
      ]));

      const keyboard = Markup.inlineKeyboard([
          ...walletButtons,
          [Markup.button.callback('❌ Cancel', 'cancel')]
      ]);

      await ctx.reply('👛 Select wallet to sell from:', keyboard);

  } catch (error) {
      console.error('Error processing sell 50%:', error);
      ctx.reply('❌ Error processing sell. Please try again.');
  }
});

// Handle custom amount input
async function handleCustomAmount(ctx, mode, token, chain) {
    try {
        const response = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
        const wallets = response.data;
        
        if (!wallets || wallets.length === 0) {
            return ctx.reply('❌ Please set up a wallet first using the /wallet command');
        }

        ctx.session.pendingTrade = {
            tokenAddress: token,
            mode: mode,
            chain: chain
        };

        if (mode === 'sell') {
            const tokenBalances = await getTokenBalances(ctx.from.id, token, chain);
            ctx.session.pendingTrade.tokenBalance = tokenBalances[0]?.balance || '0';
            ctx.session.pendingTrade.tokenSymbol = tokenBalances[0]?.symbol || '';
        }

        const walletButtons = wallets.map(wallet => ([
            Markup.button.callback(
                `👛 ${wallet.name}`, 
                `select_wallet_${mode}_${wallet.name}`
            )
        ]));

        const keyboard = Markup.inlineKeyboard([
            ...walletButtons,
            [Markup.button.callback('❌ Cancel', 'cancel')]
        ]);

        const message = mode === 'sell' 
            ? `👛 Select wallet to sell from:`
            : '👛 Select wallet to use:';

        await ctx.reply(message, keyboard);
    } catch (error) {
        console.error('Error handling custom amount:', error);
        ctx.reply('❌ Error processing request. Please try again.');
    }
}

async function executeTrade(ctx, amount, action = 'buy') {
  try {
      const selectedWallet = ctx.session.selectedWallet;
      const pendingTrade = ctx.session.pendingTrade;

      if (!selectedWallet || !pendingTrade) {
          return ctx.reply('❌ Invalid trade setup. Please try again.');
      }

      if (!pendingTrade.tokenAddress || !ethers.isAddress(pendingTrade.tokenAddress)) {
          return ctx.reply('❌ Invalid token address. Please try again.');
      }

      const progressMsg = await ctx.reply(`🔄 Processing ${action} transaction...`);
      
      let privateKey = selectedWallet.private_key;
      if (!privateKey.startsWith('0x')) {
          privateKey = `0x${privateKey}`;
      }

      const networkKey = pendingTrade.chain === 'ETH' || pendingTrade.chain === 'ETHEREUM' ? 'ETH' : 'BSC';
      const executor = new TradeExecutor(networkKey, privateKey);
      
      // Determine explorer URL based on network
      const explorerUrl = networkKey === 'ETH' 
          ? 'https://etherscan.io/tx/' 
          : 'https://bscscan.com/tx/';

      let txHash;
      if (action === 'buy') {
          const result = await executor.executeBuy(pendingTrade.tokenAddress, amount.toString());
          txHash = result.hash;
      } else {
          const tokenBalance = await executor.getTokenBalance(pendingTrade.tokenAddress);
          
          let sellAmount;
          if (typeof amount === 'string' && amount.endsWith('%')) {
              const percentage = parseFloat(amount) / 100;
              const rawBalance = tokenBalance.balance.toString();
              sellAmount = (BigInt(rawBalance) * BigInt(Math.floor(percentage * 100000))) / BigInt(100000);
          } else {
              sellAmount = ethers.parseUnits(amount.toString(), tokenBalance.decimals);
          }

          // Check balance and allowance
          if (BigInt(tokenBalance.balance.toString()) < BigInt(sellAmount.toString())) {
              return ctx.reply(`❌ Insufficient token balance. Available: ${tokenBalance.formatted} ${tokenBalance.symbol}`);
          }

          const needsApproval = !(await executor.checkAllowance(pendingTrade.tokenAddress, sellAmount));
          if (needsApproval) {
              await ctx.reply('🔄 Setting token approval...');
              await executor.approveToken(pendingTrade.tokenAddress);
          }

          const result = await executor.executeSell(pendingTrade.tokenAddress, sellAmount.toString());
          txHash = result.hash;
      }

      // Delete session data
      delete ctx.session.selectedWallet;
      delete ctx.session.pendingTrade;

      // Edit progress message with transaction link
      await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          `✅ ${action.charAt(0).toUpperCase() + action.slice(1)} transaction successful!\n\n` +
          `🔗 Transaction: [View on Explorer](${explorerUrl}${txHash})`
      );

      return txHash;

  } catch (error) {
      console.error(`Error executing ${action}:`, error);
      await ctx.reply(`❌ Error: ${error.message}`);
      return null;
  }
}

// Update wallet selection handler for sells
bot.action(/select_wallet_(\w+)_(\w+)/, async (ctx) => {
  try {
      await ctx.answerCbQuery();
      const [, mode, walletName] = ctx.match;
      
      const userId = ctx.from.id;
      const response = await axios.get(`${BASE_URL}/wallet/evm/${userId}`);
      const wallets = response.data;
      const selectedWallet = wallets.find(w => w.name === walletName);

      if (!selectedWallet) {
          return ctx.reply('❌ Wallet not found. Please try again.');
      }

      ctx.session.selectedWallet = selectedWallet;

      // Check if this is a percentage-based sell
      if (mode === 'sell' && ctx.session.pendingTrade?.amount?.endsWith('%')) {
          // Execute trade directly with stored percentage
          await executeTrade(ctx, ctx.session.pendingTrade.amount, mode);
      } else {
          // For custom amounts, prompt with forced reply
          const message = await ctx.reply(
              mode === 'sell'
                  ? `💱 Enter the amount of ${ctx.session.pendingTrade.tokenSymbol} to sell (or percentage, e.g., "50%"):`
                  : `💱 Enter the amount of ${ctx.session.pendingTrade.chain} to buy:`,
              {
                  reply_markup: {
                      force_reply: true,
                      selective: true
                  }
              }
          );

          ctx.session.tradeState = {
              waitingForAmount: true,
              action: mode,
              messageId: message.message_id
          };
      }

  } catch (error) {
      console.error('Error in wallet selection:', error);
      ctx.reply('❌ Error selecting wallet. Please try again.');
  }
});


// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageHasReply = ctx.message.reply_to_message;
  const userState = commands.userStates.get(userId);

  // Handle wallet import with forced reply
  if (userState?.action === 'import' && messageHasReply) {
      if (messageHasReply.message_id !== userState.requestMessageId) {
          return; // Not a reply to our import request
      }

      try {
          const privateKey = ctx.message.text.trim();
          
          // Delete the private key message
          try {
              await ctx.deleteMessage();
          } catch (error) {
              console.log('Could not delete message:', error);
          }
          
          await commands.importWallet(ctx, privateKey, userState.walletNumber);
          commands.userStates.delete(userId);

          // Delete the original request message
          try {
              await ctx.telegram.deleteMessage(ctx.chat.id, userState.requestMessageId);
          } catch (error) {
              console.log('Could not delete request message:', error);
          }
      } catch (error) {
          console.error('Error processing private key:', error);
          await ctx.reply('❌ Invalid private key format. Please try again.');
          commands.userStates.delete(userId);
      }
      return;
  }

  // Handle trading amounts with forced reply
  if (ctx.session?.tradeState?.waitingForAmount && messageHasReply) {
      // Verify this is a reply to our amount request
      if (messageHasReply.message_id !== ctx.session.tradeState.messageId) {
          return; // Not a reply to our amount request
      }

      try {
          let amount;
          const input = ctx.message.text.trim();
          const action = ctx.session.tradeState.action;
          
          // Handle pending amount from predefined buttons
          if (ctx.session.pendingAmount) {
              amount = ctx.session.pendingAmount;
              delete ctx.session.pendingAmount;
          } else {
              if (action === 'sell') {
                  if (input.endsWith('%')) {
                      const percentage = parseFloat(input);
                      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                          return ctx.reply('❌ Please enter a valid percentage between 0 and 100');
                      }
                      amount = input;
                  } else {
                      amount = parseFloat(input);
                      if (isNaN(amount) || amount <= 0) {
                          return ctx.reply('❌ Please enter a valid token amount');
                      }
                      if (ctx.session.tokenBalance && amount > parseFloat(ctx.session.tokenBalance)) {
                          return ctx.reply(`❌ Insufficient token balance. Available: ${ctx.session.tokenBalance}`);
                      }
                  }
              } else {
                  amount = parseFloat(input);
                  if (isNaN(amount) || amount <= 0) {
                      return ctx.reply('❌ Please enter a valid coin amount');
                  }
              }
          }

          // Execute the trade
          await executeTrade(ctx, amount, ctx.session.tradeState.action);
          
          // Clean up session
          delete ctx.session.tradeState;
          delete ctx.session.tokenBalance;

      } catch (error) {
          console.error('Error processing amount:', error);
          await ctx.reply('❌ Error processing amount. Please try again.');
      }
      return;
  }

  // Handle token address scanning
  const addressRegex = /(0x[a-fA-F0-9]{40})/;
  const match = ctx.message.text.match(addressRegex);
  
  if (match) {
      const address = match[0];
      let scanningMsg;
  
      try {
          scanningMsg = await ctx.reply('🔍 Scanning token...');
          
          // First try ETH
          let ethResult = await scanToken(address, 'eth');
          
          // If not found on ETH, try BSC
          let bscResult;
          if (!ethResult.success) {
              bscResult = await scanToken(address, 'bsc');
          }
  
          if (!ethResult.success && !bscResult?.success) {
              await ctx.telegram.deleteMessage(ctx.chat.id, scanningMsg.message_id);
              return ctx.reply('⚠️ Token not found on ETH and BSC');
          }
  
          // Use whichever result was successful
          const scanResult = ethResult.success ? ethResult : bscResult;
          const chainName = scanResult.chain.toUpperCase();
  
          const briefMessage = await formatBriefResponse(
              scanResult.data,
              address,
              chainName,
              userId,
              'buy'
          );
  
          const buttons = createTradingButtons(chainName, 'buy');
          const inlineKeyboard = Markup.inlineKeyboard(buttons);
  
          await ctx.telegram.deleteMessage(ctx.chat.id, scanningMsg.message_id);
          
          ctx.session = {
              lastScan: {
                  result: scanResult,
                  address: address,
                  data: scanResult.data
              },
              tradeMode: 'buy'
          };
  
          await ctx.reply(briefMessage, {
              parse_mode: 'Markdown',
              ...inlineKeyboard
          });
  
      } catch (error) {
          console.error('Critical error in scanning process:', error);
          if (scanningMsg) {
              await ctx.telegram.deleteMessage(ctx.chat.id, scanningMsg.message_id)
                  .catch(err => console.error('Error deleting scanning message:', err));
          }
          ctx.reply('❌ Error scanning token. Please try again later.');
      }
  }
});
  
  // Handle mode toggle
  bot.action('toggle_mode', async (ctx) => {
      try {
          await ctx.answerCbQuery();
          
          if (!ctx.session?.lastScan?.result) {
              return ctx.reply('❌ Please scan a token first.');
          }
  
          const currentMode = ctx.session.tradeMode || 'buy';
          const newMode = currentMode === 'buy' ? 'sell' : 'buy';
          ctx.session.tradeMode = newMode;
  
          const scanResult = ctx.session.lastScan.result;
          const address = ctx.session.lastScan.address;
          const chainName = scanResult.chain.toUpperCase();
          const userId = ctx.from.id;
  
          const updatedMessage = await formatBriefResponse(
              scanResult.data,
              address,
              chainName,
              userId,
              newMode
          );
  
          const buttons = createTradingButtons(chainName, newMode);
          const inlineKeyboard = Markup.inlineKeyboard(buttons);
  
          await ctx.editMessageText(updatedMessage, {
              parse_mode: 'Markdown',
              ...inlineKeyboard
          });
  
      } catch (error) {
          console.error('Error toggling trade mode:', error);
          await ctx.reply('❌ Error changing trade mode. Please try again.');
      }
  });
  
  bot.action('refresh', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        
        if (!ctx.session?.lastScan?.result) {
            return ctx.reply('❌ No token data to refresh. Please scan again.');
        }

        const scanResult = ctx.session.lastScan.result;
        const address = ctx.session.lastScan.address;
        const chainName = scanResult.chain.toUpperCase();
        const userId = ctx.from.id;

        // Get fresh data
        const freshResult = await scanToken(address, scanResult.chain);
        if (!freshResult.success) {
            return ctx.reply('❌ Error refreshing token data. Please try again.');
        }

        const updatedMessage = await formatBriefResponse(
            freshResult.data,
            address,
            chainName,
            userId,
            ctx.session.tradeMode || 'buy'
        );

        const buttons = createTradingButtons(chainName, ctx.session.tradeMode || 'buy');
        const inlineKeyboard = Markup.inlineKeyboard(buttons);

        try {
            // Try to update the message
            await ctx.editMessageText(updatedMessage, {
                parse_mode: 'Markdown',
                ...inlineKeyboard
            });
        } catch (editError) {
            if (editError.description?.includes('message is not modified')) {
                // If data hasn't changed, just acknowledge the refresh
                await ctx.answerCbQuery('✅ Data is up to date');
            } else {
                // For other errors, throw to be caught by outer catch
                throw editError;
            }
        }

        // Update stored data regardless
        ctx.session.lastScan.result = freshResult;
        ctx.session.lastScan.data = freshResult.data;

    } catch (error) {
        console.error('Error in refresh handler:', error);
        // Only show error message for non-"message not modified" errors
        if (!error.description?.includes('message is not modified')) {
            await ctx.reply('❌ Error refreshing data. Please try again.');
        }
    }
});
  
  // Handle trading mode actions (DCA, Swap, Limit)
  ['dca', 'swap', 'limit'].forEach(mode => {
      bot.action(mode, async (ctx) => {
          try {
              await ctx.answerCbQuery();
              
              if (!ctx.session?.lastScan?.result) {
                  return ctx.reply('❌ Please scan a token first.');
              }
  
              const scanResult = ctx.session.lastScan.result;
              const chainName = scanResult.chain.toUpperCase();
  
              const settingsKeyboard = Markup.inlineKeyboard([
                  [
                      Markup.button.callback('💰 Set Amount', `set_${mode}_amount`),
                      Markup.button.callback('💵 Set Price', `set_${mode}_price`)
                  ],
                  [Markup.button.callback('❌ Cancel', 'cancel')]
              ]);
  
              await ctx.reply(
                  `⚙️ Configure ${mode.toUpperCase()} Settings for ${scanResult.data.symbol}`,
                  settingsKeyboard
              );
  
          } catch (error) {
              console.error(`Error in ${mode} mode:`, error);
              ctx.reply('❌ Error setting up trade mode. Please try again.');
          }
      });
  });
  
  // Cancel action
  bot.action('cancel', async (ctx) => {
      try {
          await ctx.answerCbQuery();
          await ctx.deleteMessage();
          // Clean up any pending operations
          delete ctx.session.pendingTrade;
          delete ctx.session.tradeState;
          delete ctx.session.tokenBalance;
      } catch (error) {
          console.error('Error in cancel action:', error);
      }
  });
  
  // Handle predefined buy amounts
  ['buy_0.5', 'buy_1'].forEach(amount => {
      bot.action(amount, async (ctx) => {
          try {
              await ctx.answerCbQuery();
              const amountValue = amount === 'buy_1' ? 0.5 : 0.1;
              
              if (!ctx.session?.lastScan?.result) {
                  return ctx.reply('❌ Please scan a token first.');
              }
  
              const scanResult = ctx.session.lastScan.result;
              ctx.session.pendingAmount = amountValue;
              
              await handleCustomAmount(
                  ctx,
                  'buy',
                  ctx.session.lastScan.address,
                  scanResult.chain.toUpperCase()
              );
  
          } catch (error) {
              console.error('Error processing predefined buy:', error);
              ctx.reply('❌ Error processing buy. Please try again.');
          }
      });
  });
  
  // Handle custom trading actions
  ['buy_custom', 'sell_custom'].forEach(action => {
      bot.action(action, async (ctx) => {
          try {
              await ctx.answerCbQuery();
              
              if (!ctx.session?.lastScan?.result) {
                  return ctx.reply('❌ Please scan a token first.');
              }
  
              const mode = action.startsWith('buy') ? 'buy' : 'sell';
              const scanResult = ctx.session.lastScan.result;
              
              await handleCustomAmount(
                  ctx,
                  mode,
                  ctx.session.lastScan.address,
                  scanResult.chain.toUpperCase()
              );
  
          } catch (error) {
              console.error('Error processing custom trade:', error);
              ctx.reply('❌ Error processing request. Please try again.');
          }
      });
  });
  
// Handle sell all (100%) action
bot.action('sell_all', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      // Get available wallets
      const response = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
      const wallets = response.data;
      
      if (!wallets || wallets.length === 0) {
          return ctx.reply('❌ Please set up a wallet first using the /wallet command');
      }

      const scanResult = ctx.session.lastScan.result;
      
      ctx.session.pendingTrade = {
          tokenAddress: ctx.session.lastScan.address,
          mode: 'sell',
          chain: scanResult.chain.toUpperCase(),
          amount: '100%'
      };

      const walletButtons = wallets.map(wallet => ([
          Markup.button.callback(
              `👛 ${wallet.name}`, 
              `select_wallet_sell_${wallet.name}`
          )
      ]));

      const keyboard = Markup.inlineKeyboard([
          ...walletButtons,
          [Markup.button.callback('❌ Cancel', 'cancel')]
      ]);

      await ctx.reply('👛 Select wallet to sell from:', keyboard);

  } catch (error) {
      console.error('Error processing sell all:', error);
      ctx.reply('❌ Error processing sell. Please try again.');
  }
});

  // Add the audit action handler
bot.action('audit', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      const loadingMsg = await ctx.reply('🔍 Analyzing contract...');
      const address = ctx.session.lastScan.address;
      const chain = ctx.session.lastScan.result.chain;
      const auditData = ctx.session.lastScan.result.data.audit;

      if (!auditData) {
          await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
          return ctx.reply('❌ No audit data available for this token.');
      }

      // Parse the audit data
      const aiAudit = auditData.AIaudit.executiveSummary;
      const taxStructure = aiAudit.TaxStructure;

      // Format the audit message
      const auditMessage = `🛡 Future Edge Analysis:
├ Name: ${ctx.session.lastScan.result.data.pairs[0].baseToken.name} (${ctx.session.lastScan.result.data.pairs[0].baseToken.symbol})
├ Chain: ${chain}
└ Renounced: ${auditData.renounced ? '✅' : '❌'}

🔘 Token Info:
├ Supply: ${formatNumberWithCommas(ctx.session.lastScan.result.data.pairs[0].baseToken.totalSupply || 0)}
├ Top Holder: ${formatNumberWithCommas(ctx.session.lastScan.result.data.topHolder_perc || 0)}%
└ Contract Lock: ${formatNumberWithCommas(ctx.session.lastScan.result.data.clog_perc || 0)}%

🤖 AI Contract Score:
├ ${aiAudit.Privileges === 'Safe' ? '🟢' : '🔴'} Privileges
└ ${aiAudit.MaliciousCode === 'Safe' ? '🟢' : '🔴'} Malicious Code

📄 CA Info:
├ Initial Taxes: ${taxStructure['Initial Taxes'] || 'N/A'}
├ Final Taxes: ${taxStructure['Final Taxes'] || 'N/A'}
├ Reduced after: ${taxStructure['Reduced after'] || 'N/A'}
├ Transaction Limit: ${aiAudit.TransactionLimit || 'N/A'}
└ Enforced For: ${aiAudit.EnforcedFor || 'N/A'}

⚠️ Findings:
${formatFindings(aiAudit.findings)}

Generated by Future Edge Bot 🤖`;

      // Delete loading message and send audit result
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      await ctx.reply(auditMessage);

      // Add audit-specific buttons
      const auditButtons = Markup.inlineKeyboard([
          [
              Markup.button.callback('🔍 View Contract', `view_contract_${address}`),
              Markup.button.callback('🔄 Refresh Audit', `refresh_audit`)
          ],
          [Markup.button.callback('❌ Close', 'cancel')]
      ]);

      await ctx.reply('Contract Actions:', auditButtons);

  } catch (error) {
      console.error('Error in audit action:', error);
      ctx.reply('❌ Error analyzing contract. Please try again later.');
  }
});

// Handle contract view action
bot.action(/view_contract_(.+)/, async (ctx) => {
  try {
      await ctx.answerCbQuery();
      const address = ctx.match[1];
      const chain = ctx.session?.lastScan?.result?.chain || 'eth';
      const explorerUrl = chain === 'eth' 
          ? `https://etherscan.io/address/${address}#code`
          : `https://bscscan.com/address/${address}#code`;
      
      await ctx.reply(`🔍 View contract on ${chain === 'eth' ? 'Etherscan' : 'BSCScan'}:\n${explorerUrl}`);
  } catch (error) {
      console.error('Error in view contract action:', error);
      ctx.reply('❌ Error opening contract. Please try again.');
  }
});

// Handle audit refresh
bot.action('refresh_audit', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      // Trigger a fresh scan
      const address = ctx.session.lastScan.address;
      const chain = ctx.session.lastScan.result.chain;
      
      const freshResult = await scanToken(address, chain);
      
      if (!freshResult.success) {
          return ctx.reply('❌ Error refreshing audit data. Please try again.');
      }

      // Update session data
      ctx.session.lastScan.result = freshResult;
      
      // Trigger the audit action again
      await ctx.deleteMessage();
      await bot.action('audit')(ctx);

  } catch (error) {
      console.error('Error refreshing audit:', error);
      await ctx.reply('❌ Error refreshing audit data. Please try again.');
  }
});
  
  // Setup wallet actions
  commands.setupWalletActions(bot);
  
  // Error Handler
  bot.catch((err, ctx) => {
      console.error('Bot error:', {
          error: err,
          updateType: ctx.updateType,
          userData: ctx.from,
          messageText: ctx.message?.text
      });
  
      if (err.code === 'ETIMEDOUT') {
          ctx.reply('⌛ Request timed out. Please try again.');
      } else if (err.response && err.response.status === 429) {
          ctx.reply('⚠️ Too many requests. Please try again later.');
      } else {
          ctx.reply('❌ An error occurred. Please try again later.');
      }
  });
  
  // Start bot
  bot.launch()
      .then(() => {
          console.log('🤖 Future Edge Bot is running');
          console.log('✅ Token scanner is active on ETH and BSC chains');
          console.log('📡 Connected to EVA API');
      })
      .catch(err => {
          console.error('Bot failed to start:', err);
          process.exit(1);
      });
  
  // Graceful shutdown
  process.once('SIGINT', () => {
      console.log('Bot is shutting down...');
      bot.stop('SIGINT');
  });
  
  process.once('SIGTERM', () => {
      console.log('Bot is shutting down...');
      bot.stop('SIGTERM');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection:', {
          reason: reason,
          promise: promise
      });
  });
  
  module.exports = bot;