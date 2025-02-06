const { Telegraf, Markup, session } = require('telegraf');
const { ethers } = require('ethers');
const axios = require('axios');
const config = require('./config');
const commands = require('./commands');
const middlewares = require('./middlewares');
const settingsCommands = require('./settings');

const { 
    scanToken,
    extractTokenData,
    formatPrice,
    formatNumberWithCommas,
    getTradeVolume,
    formatFindings,
    getDexScreenerUrl,
    fetchPositionTokenData
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
bot.command('settings', settingsCommands.settings);
bot.command('positions', async (ctx) => {
  try {
      const response = await axios.get(`${BASE_URL}/trade/positions/${ctx.from.id}?status=open`);
      const positions = response.data;

      if (!positions || positions.length === 0) {
          return ctx.reply('No open positions found. Use /scanner to find and buy tokens.');
      }

      if (!ctx.session) {
        ctx.session = {};
      }
      
      ctx.session.positions = positions;
      ctx.session.currentPositionIndex = 0;
      ctx.session.tradeMode = 'sell';

      await displayPosition(ctx);

  } catch (error) {
      console.error('Error fetching positions:', error);
      ctx.reply('❌ Error fetching positions. Please try again.');
  }
});



// Handle 'buy_position' action
bot.action('buy_position', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const position = ctx.session.positions[ctx.session.currentPositionIndex];

    // Trigger the buy flow for the current position
    ctx.session.lastScan = {
      result: { chain: position.chain },
      address: position.token_address,
      data: position
    };
    ctx.session.tradeMode = 'buy';

    await handleCustomAmount(ctx, 'buy', position.token_address, position.chain);

  } catch (error) {
    console.error('Error buying position:', error);
    ctx.reply('❌ Error buying position. Please try again.');
  }
});

// Handle 'sell_position' action
bot.action('sell_position', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const position = ctx.session.positions[ctx.session.currentPositionIndex];

    // Trigger the sell flow for the current position
    ctx.session.lastScan = {
      result: { chain: position.chain },
      address: position.token_address,
      data: position
    };
    ctx.session.tradeMode = 'sell';

    await handleCustomAmount(ctx, 'sell', position.token_address, position.chain);

  } catch (error) {
    console.error('Error selling position:', error);
    ctx.reply('❌ Error selling position. Please try again.');
  }
});


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




async function formatBriefResponse(data, address, chainName, userId, tradeMode = 'buy', currentWallet = 'wallet1') {
  try {
      const pairData = data.pairs[0];
      const tokenData = pairData.baseToken;
      const poolVersion = pairData.labels?.[0] || 'v2';
      
      // Fetch current wallet settings
      const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${userId}/${currentWallet}`);
      const { slippage = 10, gas_limit = 500000 } = settings.data.settings;
      
      // Safe number parsing
      const priceUsd = parseFloat(pairData.priceUsd || 0);
      const priceNative = parseFloat(pairData.priceNative || 0);
      const marketCap = parseFloat(pairData.marketCap || pairData.fdv || 0);
      const liquidityUsd = parseFloat(pairData.liquidity?.usd || 0);
      
      // Calculate ratios
      const mcLiqRatio = liquidityUsd > 0 ? (marketCap / liquidityUsd).toFixed(2) : '0.00';
      const liquidityPercent = marketCap > 0 ? ((liquidityUsd / marketCap) * 100).toFixed(2) : '0.00';

      // Transaction volume calculations
      const buys24h = pairData.txns?.h24?.buys || 0;
      const sells24h = pairData.txns?.h24?.sells || 0;
      const volume24h = parseFloat(pairData.volume?.h24 || 0);

      const scanBaseUrl = chainName === 'BSC' ? 'https://bscscan.com' : 'https://etherscan.io';
      const caLink = `${scanBaseUrl}/token/${tokenData.address}`;
      const lpLink = `${scanBaseUrl}/address/${pairData.pairAddress}`;
      
      // Build message parts in array
      const messageParts = [
          `*${tokenData.symbol}* 🔗 ${chainName} Token`,
          ` *${poolVersion.toUpperCase()}* Pool`,
          '',
          `*CA:*  \`${tokenData.address}\``,
          `*LP:* \`${pairData.pairAddress}\``,
          '',
          `*💰 Price:* $${formatPrice(priceUsd)}`,
          `${chainName === 'BSC' ? 'BNB' : 'ETH'} | ${formatPrice(priceNative)} ≈ $${formatPrice(priceUsd)}`,
          '',
          `*💧 Liquidity |* $${formatNumberWithCommas(liquidityUsd)} (${liquidityPercent}%)`,
          '',
          `*📈 MC/Liq:* ${mcLiqRatio}`,
          '',
          `*🌐 Market Cap* | $${formatNumberWithCommas(marketCap)}`,
          '',
          '*📊 Price Changes:*',
          `*5m:* ${pairData.priceChange?.m5?.toFixed(2) || '0.00'}%`,
          `*1h:* ${pairData.priceChange?.h1?.toFixed(2) || '0.00'}%`,
          `*6h:* ${pairData.priceChange?.h6?.toFixed(2) || '0.00'}%`,
          `*24h:* ${pairData.priceChange?.h24?.toFixed(2) || '0.00'}%`,
          '',
          '*📈 24h Activity*:',
          `*Volume:* $${formatNumberWithCommas(volume24h)}`,
          `*Buys:* ${buys24h}`,
          `*Sells:* ${sells24h}`,
          '',
          '⚙️ Trading Settings:',
          `*Current Wallet:* ${currentWallet}`,
          `*Slippage:* ${slippage}%`,
          `*Gas Limit:* ${formatNumberWithCommas(gas_limit)}`,
          ''
      ];

      // Add social links if available
      if (pairData.info?.socials?.length > 0) {
          messageParts.push('🔗 Links:');
          pairData.info.socials.forEach(social => {
              messageParts.push(`${social.type === 'telegram' ? '📱' : '🐦'} ${social.url}`);
          });
          messageParts.push('');
      }

      // Get wallet balances
      const walletBalances = await getWalletBalances(userId, chainName);
      if (walletBalances.length > 0) {
          messageParts.push('💰 Your Balances:');
          messageParts.push(...walletBalances.map(wallet => 
              `👛 ${wallet.name}: ${wallet.balance} ${chainName === 'BSC' ? 'BNB' : 'ETH'}`
          ));
      }

      // Get token balances
      const tokenBalances = await getTokenBalances(userId, address, chainName);
      if (tokenBalances.length > 0) {
          messageParts.push('');
          messageParts.push(...tokenBalances.map(balance => 
              `🪙 ${balance.name}: ${Number(balance.balance || 0).toFixed(4)} ${balance.symbol || tokenData.symbol}`
          ));
      }

      // Add trading instruction
      messageParts.push('', `To ${tradeMode}, press one of the buttons below:`);

      // Join all parts with newlines
      return messageParts.join('\n');

  } catch (error) {
      console.error('Error formatting token display:', error, error.stack);
      return 'Error formatting token information. Please try again.';
  }
}

// Handle position buy amounts
['buy_0.01', 'buy_0.05', 'buy_0.1', 'buy_0.2', 'buy_0.5', 'buy_1'].forEach(action => {
  // Register each action individually
  bot.action(action, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const position = ctx.session?.positions?.[ctx.session.currentPositionIndex];
      if (!position) {
        return ctx.reply('❌ Position not found');
      }

      const amount = action.replace('buy_', '');
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      
      // Get user settings
      const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
      const { slippage = 10, gas_limit = 500000 } = settings.data.settings;

      // Setup trade using position data
      ctx.session.pendingTrade = {
        tokenAddress: position.token_address,
        mode: 'buy',
        chain: position.chain,
        slippage: slippage,
        gasLimit: gas_limit
      };

      await executeTrade(ctx, amount, 'buy');

    } catch (error) {
      console.error('Error processing position buy:', error);
      ctx.reply('❌ Error processing buy. Please try again.');
    }
  });
});

// Handle percentage sells from positions
['sell_25', 'sell_50', 'sell_75', 'sell_100'].forEach(action => {
  bot.action(action, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const position = ctx.session?.positions?.[ctx.session.currentPositionIndex];
      if (!position) {
        return ctx.reply('❌ Position not found');
      }

      const percentage = parseInt(action.replace('sell_', ''));
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      
      // Get user settings
      const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
      const { slippage = 10, gas_limit = 500000 } = settings.data.settings;

      // Get token balance
      const tokenBalances = await getTokenBalances(ctx.from.id, position.token_address, position.chain);
      const balance = tokenBalances.find(b => b.rawBalance > 0);

      if (!balance || balance.rawBalance <= 0) {
        return ctx.reply('❌ No token balance found');
      }

      // Calculate sell amount based on percentage
      const sellAmount = (BigInt(balance.rawBalance.toString()) * BigInt(percentage)) / BigInt(100);

      ctx.session.pendingTrade = {
        tokenAddress: position.token_address,
        mode: 'sell',
        chain: position.chain,
        slippage: slippage,
        gasLimit: gas_limit,
        amount: sellAmount.toString()
      };

      await executeTrade(ctx, sellAmount.toString(), 'sell');

    } catch (error) {
      console.error('Error processing position sell:', error);
      ctx.reply('❌ Error processing sell. Please try again.');
    }
  });
});

function createTradingButtons(chainName, tradeMode = 'buy', currentWallet = 'wallet1') {
  const displayChainName = chainName === 'BSC' ? 'BNB' : 'ETH';
  
  const buttons = [
      [
         
          Markup.button.callback(`${displayChainName}`, 'switch_chain'),
         
      ]
  ];

  // Dynamic wallet switching button
  buttons.push([
      Markup.button.callback(`Switch to ${currentWallet === 'wallet1' ? 'Wallet 2 💼' : 'Wallet 1 💼'}`, 'switch_wallet'),
      Markup.button.callback(`${tradeMode === 'buy' ? 'Buy ↔ Sell' : 'Buy ↔ Sell'}`, 'toggle_mode')
  ]);

  if (tradeMode === 'buy') {
      buttons.push([
          Markup.button.callback(`Buy 0.01 ${displayChainName}`, 'buy_0.01'),
          Markup.button.callback(`Buy 0.05 ${displayChainName}`, 'buy_0.05')
      ]);
      buttons.push([
          Markup.button.callback(`Buy 0.1 ${displayChainName}`, 'buy_0.1'),
          Markup.button.callback(`Buy 0.2 ${displayChainName}`, 'buy_0.2')
      ]);
      buttons.push([
          Markup.button.callback(`Buy 0.5 ${displayChainName}`, 'buy_0.5'),
          Markup.button.callback(`Buy 1 ${displayChainName}`, 'buy_1')
      ]);
      buttons.push([
          Markup.button.callback(`Buy X ${displayChainName}`, 'buy_custom'),
          Markup.button.callback('Buy X Tokens', 'buy_tokens')
      ]);
      buttons.push([
          Markup.button.callback('Instant Buy', 'buy_instant'),
          Markup.button.callback('Ape Max', 'ape_max')
      ]);
  } else {
      // Enhanced sell options
      buttons.push([
          Markup.button.callback('💎 Sell Initial', 'sell_initial'),
          Markup.button.callback('📊 Sell X%', 'sell_x_percent')
      ]);
      buttons.push([
          Markup.button.callback('Sell 25%', 'sell_25'),
          Markup.button.callback('Sell 50%', 'sell_50')
      ]);
      buttons.push([
          Markup.button.callback('Sell 75%', 'sell_75'),
          Markup.button.callback('Sell 100%', 'sell_100')
      ]);
      buttons.push([
          Markup.button.callback('Sell X Tokens', 'sell_tokens'),
          Markup.button.callback('Sell Custom', 'sell_custom')
      ]);
      buttons.push([
          Markup.button.callback('⚡ Instant Sell', 'sell_instant'),
          Markup.button.callback('🚨 Emergency', 'sell_emergency')
      ]);
  }

  buttons.push([
      Markup.button.callback('🔄 Refresh', 'refresh'),
      Markup.button.callback('❌ Close', 'cancel')
  ]);

  return buttons;
}


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


// Add this to the bot action handlers
bot.action('ape_max', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    if (!ctx.session?.lastScan?.result) {
      return ctx.reply('❌ Please scan a token first.');
    }

    const scanResult = ctx.session.lastScan.result;
    const userId = ctx.from.id;

    // Get wallet balances
    const walletBalances = await getWalletBalances(userId, scanResult.chain);
    
    if (!walletBalances || walletBalances.length === 0) {
      return ctx.reply('❌ No wallets found. Please set up a wallet first.');
    }

    // Calculate 90% of the balance
    const selectedWallet = walletBalances[0]; // Assuming wallet 1 is selected
    const balance = parseFloat(selectedWallet.balance);
    const amount = balance * 0.9;

    ctx.session.pendingTrade = {
      tokenAddress: ctx.session.lastScan.address,
      mode: 'buy',
      chain: scanResult.chain.toUpperCase(),
      wallet: selectedWallet
    };

    // Get slippage and gas settings from the API
    const settings = await axios.get(`https://fets-database.onrender.com/api/future-edge/wallet/evm/settings/${userId}/wallet1`);
    const { slippage, gas_limit } = settings.data.settings;

    // Execute the trade with 90% of the balance
    await executeTrade(ctx, amount.toString(), 'buy', slippage, gas_limit);

  } catch (error) {
    console.error('Error processing ape max:', error);
    ctx.reply('❌ Error processing ape max. Please try again.');
  }
});


async function createPositionButtons(ctx, position, currentWallet = 'wallet1') {
  const displayChainName = position.chain === 'BSC' ? 'BNB' : 'ETH';
  const tradeMode = ctx.session?.tradeMode || 'sell';
  
  // Get wallet balances for validation
  const walletBalances = await getWalletBalances(ctx.from.id, position.chain);
  const currentWalletBalance = walletBalances.find(w => w.name === currentWallet);
  const walletBalance = parseFloat(currentWalletBalance?.balance || '0');

  // Get token balances for validation
  const tokenBalances = await getTokenBalances(ctx.from.id, position.token_address, position.chain);
  const currentTokenBalance = tokenBalances.find(b => b.rawBalance > 0);
  const hasTokenBalance = currentTokenBalance && currentTokenBalance.rawBalance > 0;

  const buttons = [
      [
          Markup.button.callback('⬅️ Previous', 'previous_position'),
          Markup.button.callback('➡️ Next', 'next_position')
      ],
      [
          Markup.button.callback(`Switch to ${currentWallet === 'wallet1' ? 'Wallet 2 💼' : 'Wallet 1 💼'}`, 'switch_wallet_p'),
          Markup.button.callback(`${tradeMode === 'buy' ? 'Switch to Sell 💸' : 'Switch to Buy 💰'}`, 'toggle_mode')
      ],
      [Markup.button.callback('🔄 Refresh', 'refresh_position')]
  ];

  if (tradeMode === 'buy') {
      // Only show buy buttons if wallet has enough balance
      const buyButtons = [
          ['buy_0.01', 'buy_0.05'],
          ['buy_0.1', 'buy_0.2'],
          ['buy_0.5', 'buy_1']
      ];

      buyButtons.forEach(([amount1, amount2]) => {
          const amt1 = parseFloat(amount1.replace('buy_', ''));
          const amt2 = parseFloat(amount2.replace('buy_', ''));
          
          if (walletBalance >= amt1 || walletBalance >= amt2) {
              const buttons = [];
              if (walletBalance >= amt1) {
                  buttons.push(Markup.button.callback(`Buy ${amt1} ${displayChainName}`, amount1));
              }
              if (walletBalance >= amt2) {
                  buttons.push(Markup.button.callback(`Buy ${amt2} ${displayChainName}`, amount2));
              }
              if (buttons.length > 0) {
                  buttons.push(buttons);
              }
          }
      });

      // Add custom buy options if any balance available
      if (walletBalance > 0) {
          buttons.push([
              Markup.button.callback(`Buy X ${displayChainName}`, 'buy_custom'),
              Markup.button.callback('Buy X Tokens', 'buy_tokens')
          ]);
          buttons.push([
              Markup.button.callback('Instant Buy', 'buy_instant'),
              Markup.button.callback('Ape Max', 'ape_max')
          ]);
      }
  } else {
      // Only show sell buttons if user has token balance
      if (hasTokenBalance) {
          buttons.push(
              [
                  Markup.button.callback('💎 Sell Initial', 'sell_initial'),
                  Markup.button.callback('📊 Sell X%', 'sell_x_percent')
              ],
              [
                  Markup.button.callback('Sell 25%', 'sell_25'),
                  Markup.button.callback('Sell 50%', 'sell_50')
              ],
              [
                  Markup.button.callback('Sell 75%', 'sell_75'),
                  Markup.button.callback('Sell 100%', 'sell_100')
              ],
              [
                  Markup.button.callback('Sell X Tokens', 'sell_tokens'),
                  Markup.button.callback('Sell Custom', 'sell_custom')
              ],
              [
                  Markup.button.callback('⚡ Instant Sell', 'sell_instant'),
                  Markup.button.callback('🚨 Sell Emergency', 'sell_emergency')
              ]
          );
      } else {
          buttons.push([Markup.button.callback('❌ No tokens to sell', 'no_action')]);
      } 
  }

  buttons.push([Markup.button.callback('❌ Close', 'cancel')]);
  return buttons;
}


// Updated token data fetching function
async function fetchTokenData(address, chain = 'eth') {
  try {
    const chainPath = chain.toLowerCase() === 'eth' ? 'ethereum' : 'bsc';
    console.log(`Fetching token data for ${address} on ${chainPath}`);
    
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    console.log('DexScreener API URL:', url);

    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    if (response.status !== 200) {
      console.log(`DexScreener API returned status ${response.status}`);
      return { success: false };
    }

    if (!response.data || !response.data.pairs || !Array.isArray(response.data.pairs)) {
      console.log('Invalid response format from DexScreener');
      return { success: false };
    }

    // Filter pairs for the specified chain
    const chainPairs = response.data.pairs.filter(pair => 
      pair.chainId === (chain.toLowerCase() === 'eth' ? 'ethereum' : 'bsc')
    );

    if (chainPairs.length === 0) {
      console.log('No pairs found for specified chain');
      return { success: false };
    }

    // Sort pairs by liquidity
    const sortedPairs = chainPairs.sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || 0);
      const liquidityB = parseFloat(b.liquidity?.usd || 0);
      return liquidityB - liquidityA;
    });

    return {
      success: true,
      data: {
        pairs: sortedPairs
      }
    };

  } catch (error) {
    console.error('Error fetching token data:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    return { success: false };
  }
}

async function fetchCurrentTokenData(chain, tokenAddress) {
  try {
    const chainPath = chain.toLowerCase() === 'eth' ? 'ethereum' : 'bsc';
    console.log(`Fetching token data for ${tokenAddress} on ${chainPath}`);
    
    const url = `https://api.dexscreener.com/tokens/v1/${chainPath}/${tokenAddress}`;
    console.log('API URL:', url);

    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    console.log('API Response:', JSON.stringify(response.data, null, 2));

    // The response data is directly an array
    if (!Array.isArray(response.data) || response.data.length === 0) {
      console.log('No pairs found in response');
      return null;
    }

    // Sort pairs by liquidity
    const sortedPairs = response.data.sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || 0);
      const liquidityB = parseFloat(b.liquidity?.usd || 0);
      return liquidityB - liquidityA;
    });

    // Return the most liquid pair
    return sortedPairs[0];
  } catch (error) {
    console.error('Error fetching token data:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    return null;
  }
}

async function formatPositionMessage(ctx, position, walletText) {
    try {
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      const tradeMode = ctx.session?.tradeMode || 'sell';
  
      // Get wallet balance
      const walletBalances = await getWalletBalances(ctx.from.id, position.chain);
      const currentWalletBalance = walletBalances.find(w => w.name === currentWallet);
      const walletBalance = parseFloat(currentWalletBalance?.balance || '0');
  
      // Get token balance
      const tokenBalances = await getTokenBalances(ctx.from.id, position.token_address, position.chain);
      const currentTokenBalance = tokenBalances.find(b => b.rawBalance > 0);
  
      // Initial investment details
      const initialValue = Number(position.transactions[0]?.total_value_usd || 0);
  
      console.log('Fetching current token data...');
      const pair = await fetchCurrentTokenData(position.chain, position.token_address);
  
      if (!pair) {
        console.log('No pair data found, showing basic info');
        return [
          `${position.token_symbol} (${position.chain})`,
          `💰 Token Amount: ${formatNumberWithCommas(position.amount)}`,
          '',
          '⚠️ Current market data unavailable',
          `Initial Value: $${formatNumberWithCommas(initialValue)}`,
          '',
          `${walletText}\n`,
          `💼 ${currentWallet} Balance: ${walletBalance.toFixed(4)} ${position.chain === 'BSC' ? 'BNB' : 'ETH'}`,
          `🪙 Token Balance: ${currentTokenBalance ? formatNumberWithCommas(currentTokenBalance.balance) : '0'} ${currentTokenBalance?.symbol || position.token_symbol}`,
          `\nMode: ${tradeMode === 'buy' ? '💰 Buying' : '💸 Selling'}`
        ].join('\n');
      }
  
      // Safely parse numeric values
      const currentPrice = typeof pair.priceUsd === 'string' ? parseFloat(pair.priceUsd) : pair.priceUsd || 0;
      const priceNative = typeof pair.priceNative === 'string' ? parseFloat(pair.priceNative) : pair.priceNative || 0;
      const currentValue = Number(position.amount || 0) * currentPrice;
      const pl = currentValue - initialValue;
      const plPercentage = initialValue > 0 ? ((currentValue / initialValue) - 1) * 100 : 0;
  
      // Format market cap and liquidity safely
      const marketCap = parseFloat(pair.marketCap || pair.fdv || 0);
      const liquidityUsd = parseFloat(pair.liquidity?.usd || 0);
      const volume24h = parseFloat(pair.volume?.h24 || 0);
  
      const message = [
        `📊 Position Details (#${ctx.session.positions.length - ctx.session.currentPositionIndex} of ${ctx.session.positions.length}):\n`,
        `${position.token_symbol} (${position.chain}) ${pair.dexId ? `on ${pair.dexId}` : ''} ${pair.labels?.[0] || ''}`,
        `💰 Token Amount: ${formatNumberWithCommas(position.amount)}`,
        '',
        '📈 Token Price:',
        `USD: $${formatPrice(currentPrice)}`,
        `${position.chain === 'BSC' ? 'BNB' : 'ETH'}: ${formatPrice(priceNative)}`,
        '',
        '💰 Value:',
        `Initial: $${formatNumberWithCommas(initialValue)}`,
        `Current: $${formatNumberWithCommas(currentValue)}`,
        `P/L: ${pl >= 0 ? '+' : ''}$${formatNumberWithCommas(pl)} (${plPercentage >= 0 ? '+' : ''}${plPercentage.toFixed(2)}%)`,
        '',
        '📊 Market Info:',
        `Market Cap: $${formatNumberWithCommas(marketCap)}`,
        `Liquidity: $${formatNumberWithCommas(liquidityUsd)}`,
        `24h Volume: $${formatNumberWithCommas(volume24h)}`,
        '',
        '📈 24h Activity:',
        `Buys: ${pair.txns?.h24?.buys || 0}`,
        `Sells: ${pair.txns?.h24?.sells || 0}`,
        '',
        `${walletText}`,
        `💼 ${currentWallet} Balance: ${walletBalance.toFixed(4)} ${position.chain === 'BSC' ? 'BNB' : 'ETH'}`,
        `🪙 Token Balance: ${currentTokenBalance ? formatNumberWithCommas(currentTokenBalance.balance) : '0'} ${currentTokenBalance?.symbol || position.token_symbol}`,
        `\nMode: ${tradeMode === 'buy' ? '💰 Buying' : '💸 Selling'}`
      ];
  
      return message.join('\n');
  
    } catch (error) {
      console.error('Error formatting position message:', error);
      throw error;
    }
  }

async function filterPositions(ctx, currentWallet) {
  try {
    // Get open positions from API
    const response = await axios.get(`${BASE_URL}/trade/positions/${ctx.from.id}?status=open`);
    let allPositions = response.data;

    // Get wallet balances from BaseUrl
    const walletResponse = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
    const walletData = walletResponse.data.find(w => w.name === currentWallet);
    
    if (!walletData) {
      console.log('Wallet not found:', currentWallet);
      return [];
    }

    // Filter positions based on wallet balance
    const validPositions = allPositions.filter(position => {
      // Check if the position belongs to the current wallet
      const isCurrentWallet = position.transactions.some(tx => 
        tx.wallet_address.toLowerCase() === walletData.address.toLowerCase()
      );

      if (!isCurrentWallet) {
        return false;
      }

      // Check if amount is greater than zero
      const amount = Number(position.amount || 0);
      return amount > 0;
    });

    console.log(`Found ${validPositions.length} valid positions for ${currentWallet}`);
    return validPositions;

  } catch (error) {
    console.error('Error filtering positions:', error);
    return [];
  }
}



async function displayPosition(ctx) {
  try {
    const currentWallet = ctx.session?.currentWallet || 'wallet1';
    console.log('Displaying positions for wallet:', currentWallet);

    const basicButtons = [
      [
        Markup.button.callback(
          `Switch to ${currentWallet === 'wallet1' ? 'Wallet 2 💼' : 'Wallet 1 💼'}`,
          'switch_wallet_p'
        )
      ]
    ];

    // Get positions for current wallet
    let positions = await filterPositions(ctx, currentWallet);
    
    if (!positions || positions.length === 0) {
      return ctx.reply(
        `No positions found for ${currentWallet}`, 
        Markup.inlineKeyboard(basicButtons)
      );
    }

    // Sort positions by timestamp in descending order (newest first)
    positions = positions.sort((a, b) => {
      const dateB = new Date(b.opened_at || b.createdAt);
      const dateA = new Date(a.opened_at || a.createdAt);
      return dateB - dateA;
    });

    // Store sorted positions in session
    ctx.session.positions = positions;
    
    // If no current index, start with newest position (last position)
    if (typeof ctx.session.currentPositionIndex === 'undefined') {
      ctx.session.currentPositionIndex = positions.length - 1;
    }

    const position = positions[ctx.session.currentPositionIndex];
    if (!position) {
      return ctx.reply(
        'Position not found',
        Markup.inlineKeyboard(basicButtons)
      );
    }

    // Get token balances
    const tokenBalances = await getTokenBalances(ctx.from.id, position.token_address, position.chain);
    const currentTokenBalance = tokenBalances.find(b => b.rawBalance > 0);
    
    const walletText = currentTokenBalance ? 
      `👛 ${currentWallet}: ${formatNumberWithCommas(currentTokenBalance.balance)} ${currentTokenBalance.symbol}` : 
      `👛 ${currentWallet}: No balance`;

    // Display position number (current/total)
    // Display position number (current/total)
    const displayPositionNumber = positions.length - ctx.session.currentPositionIndex;

    // Format message with correct position numbering
    const message = await formatPositionMessage(ctx, position, walletText);
    const updatedMessage = message.replace(
    `(#${ctx.session.currentPositionIndex + 1} of ${positions.length})`,
    `(#${displayPositionNumber} of ${positions.length})`
    );

    const buttons = await createPositionButtons(ctx, position, currentWallet);
    const keyboard = Markup.inlineKeyboard(buttons);

    try {
      if (ctx.session.positionMessageId) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.session.positionMessageId,
          null,
          updatedMessage,
          {
            parse_mode: 'Markdown',
            ...keyboard
          }
        );
      } else {
        const sentMessage = await ctx.reply(updatedMessage, keyboard);
        ctx.session.positionMessageId = sentMessage.message_id;
      }
    } catch (error) {
      if (error.description?.includes('message is not modified')) {
        await ctx.answerCbQuery('Position data is up to date');
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error('Error displaying position:', error);
    if (!error.description?.includes('message is not modified')) {
      ctx.reply('❌ Error displaying position. Please try again.');
    }
  }
}

// Modified navigation handlers for reverse order
bot.action('next_position', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    if (!ctx.session?.positions?.length) {
      return ctx.reply('❌ No positions to navigate');
    }

    // Move to older position (decrease index)
    ctx.session.currentPositionIndex--;
    if (ctx.session.currentPositionIndex < 0) {
      ctx.session.currentPositionIndex = ctx.session.positions.length - 1;
    }

    await displayPosition(ctx);

  } catch (error) {
    console.error('Error navigating to next position:', error);
    if (!error.description?.includes('message is not modified')) {
      ctx.reply('❌ Error navigating positions. Please try again.');
    }
  }
});

bot.action('previous_position', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    if (!ctx.session?.positions?.length) {
      return ctx.reply('❌ No positions to navigate');
    }

    // Move to newer position (increase index)
    ctx.session.currentPositionIndex++;
    if (ctx.session.currentPositionIndex >= ctx.session.positions.length) {
      ctx.session.currentPositionIndex = 0;
    }

    await displayPosition(ctx);

  } catch (error) {
    console.error('Error navigating to previous position:', error);
    if (!error.description?.includes('message is not modified')) {
      ctx.reply('❌ Error navigating positions. Please try again.');
    }
  }
});

// Updated refresh handler for positions
bot.action('refresh_position', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const currentWallet = ctx.session?.currentWallet || 'wallet1';
    
    // Create basic buttons with proper Markup formatting
    const basicButtons = [
      [
        Markup.button.callback(
          `Switch to ${currentWallet === 'wallet1' ? 'Wallet 2 💼' : 'Wallet 1 💼'}`,
          'switch_wallet_p'
        )
      ]
    ];

    // Check if we have valid position data
    if (!ctx.session?.positions || !ctx.session?.positions[ctx.session.currentPositionIndex]) {
      return ctx.reply(
        '❌ No position data to refresh. Please view positions again.',
        Markup.inlineKeyboard(basicButtons)
      );
    }

    const position = ctx.session.positions[ctx.session.currentPositionIndex];
    
    // Fetch fresh token data from DexScreener
    const freshPairData = await fetchCurrentTokenData(position.chain, position.token_address);
    if (!freshPairData) {
      return ctx.reply(
        '❌ Unable to fetch current market data. Please try again.',
        Markup.inlineKeyboard(basicButtons)
      );
    }

    // Update the position's current market data
    position.currentMarketData = freshPairData;

    // Re-display the position with updated data
    await displayPosition(ctx);

    await ctx.answerCbQuery('✅ Position data refreshed');

  } catch (error) {
    console.error('Error in refresh position handler:', error);
    const currentWallet = ctx.session?.currentWallet || 'wallet1';
    
    const errorButtons = [
      [
        Markup.button.callback(
          `Switch to ${currentWallet === 'wallet1' ? 'Wallet 2 💼' : 'Wallet 1 💼'}`,
          'switch_wallet_p'
        )
      ],
      [
        Markup.button.callback('🔄 Try Again', 'refresh_position'),
        Markup.button.callback('❌ Close', 'cancel')
      ]
    ];

    await ctx.reply(
      '❌ Error refreshing position data. Please try again.',
      Markup.inlineKeyboard(errorButtons)
    );
  }
});

// Handle wallet switching
bot.action('switch_wallet_p', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Toggle wallet
    const newWallet = ctx.session.currentWallet === 'wallet1' ? 'wallet2' : 'wallet1';
    ctx.session.currentWallet = newWallet;
    
    // Reset position index
    delete ctx.session.currentPositionIndex;
    
    // Display positions for new wallet
    await displayPosition(ctx);

  } catch (error) {
    console.error('Error switching wallet:', error);
    ctx.reply('❌ Error switching wallet. Please try again.');
  }
});

async function executeTrade(ctx, amount, action = 'buy') {
  try {
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
      const walletResponse = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
      const wallets = walletResponse.data;
      
      const selectedWallet = wallets.find(w => w.name === currentWallet);
      if (!selectedWallet) {
          throw new Error('Selected wallet not found');
      }

      const pendingTrade = ctx.session.pendingTrade;
      const progressMsg = await ctx.reply(`🔄 Processing ${action} transaction...`);

      let privateKey = selectedWallet.private_key;
      if (!privateKey.startsWith('0x')) {
          privateKey = `0x${privateKey}`;
      }

      const networkKey = pendingTrade.chain === 'ETH' ? 'ETH' : 'BSC';
      const executor = new TradeExecutor(networkKey, privateKey);
      
      // Get token details
      const token = new ethers.Contract(pendingTrade.tokenAddress, ERC20_ABI, executor.provider);
      const [symbol, name, decimals] = await Promise.all([
          token.symbol(),
          token.name(),
          token.decimals()
      ]);

      // Execute the trade
      const result = await executor[action === 'buy' ? 'executeBuy' : 'executeSell'](
          pendingTrade.tokenAddress,
          amount.toString(),
          pendingTrade.slippage || 10,
          pendingTrade.gasLimit || 500000
      );

      // Get fresh market data
      const scanResult = await scanToken(pendingTrade.tokenAddress, networkKey.toLowerCase());
      const tokenData = extractTokenData(scanResult.data);
      const pairData = scanResult.data.pairs[0];
      const currentPrice = parseFloat(pairData.priceUsd);

      // Calculate trade metrics
      const tokenAmount = action === 'buy' ? result.tokenAmount : ethers.formatUnits(amount, decimals);
      const totalValue = parseFloat(tokenAmount) * currentPrice;

      try {
          const tradeData = {
              token_address: pendingTrade.tokenAddress,
              chain: pendingTrade.chain,
              token_symbol: symbol,
              token_name: name,
              action: action,
              amount: tokenAmount,
              price_per_token: currentPrice.toString(),
              mcap: tokenData.marketCap.toString(),
              total_value_usd: totalValue.toString(),
              transaction_hash: result.hash,
              wallet_address: selectedWallet.address
          };

          // Update position and get new position data
          const positionResponse = await axios.post(
              `${BASE_URL}/trade/position/${ctx.from.id}`,
              tradeData
          );

          // Show brief success message
          await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMsg.message_id,
              null,
              `✅ ${action.toUpperCase()} Transaction Successful!\n` +
              `🔗 [View Transaction](${networkKey === 'ETH' ? 'https://etherscan.io/tx/' : 'https://bscscan.com/tx/'}${result.hash})`,
              {
                  parse_mode: 'Markdown',
                  disable_web_page_preview: true
              }
          );

          // Wait a brief moment for the blockchain to update
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Reset position index to show the latest position
          ctx.session.currentPositionIndex = 0; // Set to 0 to show the most recent position
        delete ctx.session.positionMessageId;

          // Display the updated position list
          await displayPosition(ctx);

          return {
              hash: result.hash,
              success: true
          };

      } catch (error) {
          console.error('Error updating position:', error);
          await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMsg.message_id,
              null,
              `✅ Transaction successful!\n\n` +
              `🔗 [View on ${networkKey === 'ETH' ? 'Etherscan' : 'BSCScan'}](${networkKey === 'ETH' ? 'https://etherscan.io/tx/' : 'https://bscscan.com/tx/'}${result.hash})\n\n` +
              `⚠️ Position tracking update failed. Please use /positions to check your positions.`,
              {
                  parse_mode: 'Markdown',
                  disable_web_page_preview: true
              }
          );
          return { hash: result.hash };
      }

  } catch (error) {
      console.error(`Error executing ${action}:`, error);
      const errorMessage = error.response?.data?.error || error.message;
      await ctx.reply(`❌ Error: ${errorMessage}`);
      // Wait a brief moment for the blockchain to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Reset position index to show the latest position
      ctx.session.currentPositionIndex = 0; // Set to 0 to show the most recent position
      delete ctx.session.positionMessageId;

      // Display the updated position list
      await displayPosition(ctx);

      return null;
  }
}

['buy_custom', 'sell_custom'].forEach(action => {
    bot.action(action, async (ctx) => {
      try {
        await ctx.answerCbQuery();
        
        const mode = action.split('_')[0]; // 'buy' or 'sell'
        const currentWallet = ctx.session?.currentWallet || 'wallet1';
        
        // Check if we're in position view or regular token view
        let tokenAddress, chain;
        if (ctx.session?.positions) {
          // Position mode
          const position = ctx.session.positions[ctx.session.currentPositionIndex];
          if (!position) {
            return ctx.reply('❌ Position not found');
          }
          tokenAddress = position.token_address;
          chain = position.chain;
        } else if (ctx.session?.lastScan?.result) {
          // Regular token mode
          tokenAddress = ctx.session.lastScan.address;
          chain = ctx.session.lastScan.result.chain;
        } else {
          return ctx.reply('❌ Please scan a token first');
        }
  
        // Get wallet balance for validation
        const walletBalances = await getWalletBalances(ctx.from.id, chain);
        const currentWalletBalance = walletBalances.find(w => w.name === currentWallet);
        const walletBalance = parseFloat(currentWalletBalance?.balance || '0');
  
        // If selling, check token balance
        if (mode === 'sell') {
          const tokenBalances = await getTokenBalances(ctx.from.id, tokenAddress, chain);
          const tokenBalance = tokenBalances.find(b => b.rawBalance > 0);
          if (!tokenBalance || tokenBalance.rawBalance <= 0) {
            return ctx.reply('❌ No token balance found');
          }
          ctx.session.tokenBalance = tokenBalance;
        }
  
        // Store data for the trade
        ctx.session.pendingTrade = {
          tokenAddress: tokenAddress,
          mode: mode,
          chain: chain
        };
  
        // Create appropriate prompt message
        const displayChainName = chain.toLowerCase() === 'bsc' ? 'BNB' : 'ETH';
        let promptMessage;
        
        if (mode === 'buy') {
          promptMessage = `💰 Enter amount of ${displayChainName} to buy (max ${walletBalance}):\n` +
                         `Example: 0.1 for 0.1 ${displayChainName}`;
        } else {
          const tokenSymbol = ctx.session.tokenBalance.symbol;
          promptMessage = `💰 Enter amount of ${tokenSymbol} to sell or use percentage (e.g., "50%"):\n` +
                         `Available: ${formatNumberWithCommas(ctx.session.tokenBalance.balance)} ${tokenSymbol}`;
        }
  
        // Send prompt with forced reply
        const message = await ctx.reply(promptMessage, {
          reply_markup: { force_reply: true, selective: true }
        });
  
        // Set up trade state
        ctx.session.tradeState = {
          waitingForAmount: true,
          action: mode,
          messageId: message.message_id,
          wallet: currentWallet,
          maxBalance: mode === 'buy' ? walletBalance : ctx.session.tokenBalance.balance
        };
  
      } catch (error) {
        console.error(`Error processing custom ${action.split('_')[0]}:`, error);
        ctx.reply('❌ Error processing request. Please try again.');
      }
    });
  });



// Handle sell initial
bot.action('sell_initial', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const position = ctx.session?.positions?.[ctx.session.currentPositionIndex];
    if (!position) {
      return ctx.reply('❌ No position found. Please try again.');
    }

    const currentWallet = ctx.session?.currentWallet || 'wallet1';
    
    // Get initial investment details
    const initialTransaction = position.transactions.find(tx => tx.action === 'buy');
    if (!initialTransaction) {
      return ctx.reply('❌ No initial buy transaction found for this position.');
    }

    const initialValue = Number(initialTransaction.total_value_usd);
    const initialAmount = Number(initialTransaction.amount);

    // Get current token price from DexScreener
    const pair = await fetchCurrentTokenData(position.chain, position.token_address);
    if (!pair) {
      return ctx.reply('❌ Unable to fetch current market data. Please try again.');
    }

    const currentPrice = parseFloat(pair.priceUsd);
    const currentTokenValue = currentPrice * initialAmount;

    // Get user's current token balance
    const tokenBalances = await getTokenBalances(ctx.from.id, position.token_address, position.chain);
    const currentBalance = tokenBalances.find(b => b.rawBalance > 0);

    if (!currentBalance || currentBalance.rawBalance <= 0) {
      return ctx.reply('❌ No token balance found.');
    }

    // Get user settings
    const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
    const { slippage = 10, gas_limit = 500000 } = settings.data.settings;

    // Calculate fees and minimum required value
    const estimatedFees = currentTokenValue * (pair.tax?.sell || 3) / 100;
    const minRequiredValue = initialValue + estimatedFees;

    if (currentTokenValue < minRequiredValue) {
      const deficit = minRequiredValue - currentTokenValue;
      const message = [
        '❌ Cannot sell initial investment at current price.',
        '',
        '📊 Analysis:',
        `Initial Investment: $${formatNumberWithCommas(initialValue)}`,
        `Current Value: $${formatNumberWithCommas(currentTokenValue)}`,
        `Estimated Fees: $${formatNumberWithCommas(estimatedFees)}`,
        `Minimum Required Value: $${formatNumberWithCommas(minRequiredValue)}`,
        `Deficit: $${formatNumberWithCommas(deficit)}`,
        '',
        `Current Price: $${formatPrice(currentPrice)}`,
        `Required Price: $${formatPrice(minRequiredValue / initialAmount)}`,
        '',
        '⚠️ Selling now would result in a loss. Please wait for a higher price.'
      ].join('\n');

      return ctx.reply(message);
    }

    // Proceed with sell if value is sufficient
    ctx.session.pendingTrade = {
      tokenAddress: position.token_address,
      mode: 'sell',
      chain: position.chain.toUpperCase(),
      slippage: slippage,
      gasLimit: gas_limit,
      amount: initialAmount.toString(),
      isInitialSell: true
    };

    // Prepare confirmation message
    const confirmMessage = [
      '🔄 Initial Investment Sell Confirmation',
      '',
      `Token: ${position.token_symbol}`,
      `Amount: ${formatNumberWithCommas(initialAmount)} tokens`,
      `Initial Value: $${formatNumberWithCommas(initialValue)}`,
      `Current Value: $${formatNumberWithCommas(currentTokenValue)}`,
      `Estimated Profit: $${formatNumberWithCommas(currentTokenValue - initialValue - estimatedFees)}`,
      `Estimated Fees: $${formatNumberWithCommas(estimatedFees)}`,
      '',
      'Do you want to proceed with the sell?'
    ].join('\n');

    const confirmKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Confirm Sell', 'confirm_sell_initial'),
        Markup.button.callback('❌ Cancel', 'cancel')
      ]
    ]);

    await ctx.reply(confirmMessage, confirmKeyboard);

  } catch (error) {
    console.error('Error in sell initial:', error);
    ctx.reply('❌ Error processing sell initial. Please try again.');
  }
});

// Handle sell initial confirmation
bot.action('confirm_sell_initial', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    if (!ctx.session?.pendingTrade?.isInitialSell) {
      return ctx.reply('❌ No pending initial sell transaction.');
    }

    await executeTrade(ctx, ctx.session.pendingTrade.amount, 'sell');

  } catch (error) {
    console.error('Error confirming sell initial:', error);
    ctx.reply('❌ Error processing sell. Please try again.');
  }
});

// Handle emergency sell
bot.action('sell_emergency', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      const scanResult = ctx.session.lastScan.result;
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      
      ctx.session.pendingTrade = {
          tokenAddress: ctx.session.lastScan.address,
          mode: 'sell',
          chain: scanResult.chain.toUpperCase(),
          slippage: 100, // High slippage for emergency
          gasLimit: 1000000 // Higher gas limit for emergency
      };

      await executeInstantTrade(ctx, 'sell');

  } catch (error) {
      console.error('Error processing emergency sell:', error);
      ctx.reply('❌ Error processing emergency sell. Please try again.');
  }
});

// Handle token amount buttons
['buy_tokens', 'sell_tokens'].forEach(action => {
  bot.action(action, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const position = ctx.session?.positions?.[ctx.session.currentPositionIndex];
      if (!position) {
        return ctx.reply('❌ Position not found');
      }

      const mode = action.split('_')[0];
      const message = await ctx.reply(
        `Enter the amount of tokens to ${mode}:`,
        { reply_markup: { force_reply: true, selective: true } }
      );

      ctx.session.tradeState = {
        waitingForAmount: true,
        action: `${mode}_tokens`,
        messageId: message.message_id,
        positionId: position._id
      };

    } catch (error) {
      console.error(`Error processing token ${action.split('_')[0]}:`, error);
      ctx.reply('❌ Error processing request. Please try again.');
    }
  });
});





async function executeInstantTrade(ctx, action) {
  try {
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
      const walletResponse = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
      const wallets = walletResponse.data;
      
      const selectedWallet = wallets.find(w => w.name === currentWallet);
      if (!selectedWallet) {
          throw new Error('Selected wallet not found');
      }

      ctx.session.selectedWallet = selectedWallet;
      const pendingTrade = ctx.session.pendingTrade;

      // For instant trades, we'll use higher gas to ensure execution
      const gasLimit = action === 'sell' ? 1000000 : 500000;

      if (action === 'sell') {
          // Get token balance for sell
          const tokenBalances = await getTokenBalances(ctx.from.id, pendingTrade.tokenAddress, pendingTrade.chain);
          const balance = tokenBalances.find(b => b.rawBalance > 0);
          
          if (!balance) {
              throw new Error('No token balance found');
          }

          // Sell entire balance
          await executeTrade(ctx, balance.rawBalance.toString(), 'sell', 0, gasLimit);
      } else {
          // For buying, we'll use a default amount (can be modified based on your needs)
          const amount = '0.1'; // Default to 0.1 ETH/BNB for instant buys
          await executeTrade(ctx, amount, 'buy', 0, gasLimit);
      }

  } catch (error) {
      console.error(`Error executing instant ${action}:`, error);
      throw error;
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


// Handle sell initial
bot.action('sell_initial', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      const userId = ctx.from.id;
      const currentWallet = ctx.session?.currentWallet || 'wallet1';
      const tokenAddress = ctx.session.lastScan.address;
      const chain = ctx.session.lastScan.result.chain;

      // Here you would fetch the initial investment data from your database
      // For now, we'll use a placeholder implementation
      try {
          const response = await axios.get(`${BASE_URL}/trade/position/${userId}/${tokenAddress}/${chain}`);
          const position = response.data;

          if (!position || !position.initial_amount) {
              return ctx.reply('❌ No initial investment found for this token.');
          }

          ctx.session.pendingTrade = {
              tokenAddress: tokenAddress,
              mode: 'sell',
              chain: chain.toUpperCase(),
              amount: position.initial_amount,
              isInitialSell: true
          };

          await executeTrade(ctx, position.initial_amount, 'sell');

      } catch (error) {
          console.error('Error fetching initial position:', error);
          ctx.reply('❌ Error retrieving initial investment data.');
      }

  } catch (error) {
      console.error('Error in sell initial:', error);
      ctx.reply('❌ Error processing sell initial. Please try again.');
  }
});

// Handle sell X%
bot.action('sell_x_percent', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      const message = await ctx.reply(
          '📊 Enter the percentage to sell (e.g., 35.5 for 35.5%):',
          { reply_markup: { force_reply: true, selective: true } }
      );

      ctx.session.tradeState = {
          waitingForAmount: true,
          action: 'sell_percent',
          messageId: message.message_id
      };

  } catch (error) {
      console.error('Error in sell X%:', error);
      ctx.reply('❌ Error processing sell percentage. Please try again.');
  }
});

// Update wallet switching handler to be more dynamic
bot.action('switch_wallet', async (ctx) => {
  try {
      await ctx.answerCbQuery();
      
      if (!ctx.session?.lastScan?.result) {
          return ctx.reply('❌ Please scan a token first.');
      }

      // Toggle wallet and update session
      const newWallet = ctx.session.currentWallet === 'wallet1' ? 'wallet2' : 'wallet1';
      ctx.session.currentWallet = newWallet;

      // Get fresh wallet data
      const walletResponse = await axios.get(`${BASE_URL}/wallet/evm/${ctx.from.id}`);
      const walletData = walletResponse.data.find(w => w.name === newWallet);

      if (!walletData) {
          return ctx.reply(`❌ ${newWallet} not found. Please set up the wallet first.`);
      }

      const scanResult = ctx.session.lastScan.result;
      const address = ctx.session.lastScan.address;
      const chainName = scanResult.chain.toUpperCase();

      // Update display with new wallet info
      const updatedMessage = await formatBriefResponse(
          scanResult.data,
          address,
          chainName,
          ctx.from.id,
          ctx.session.tradeMode || 'buy'
      );

      const buttons = createTradingButtons(chainName, ctx.session.tradeMode || 'buy', newWallet);
      const inlineKeyboard = Markup.inlineKeyboard(buttons);

      await ctx.editMessageText(updatedMessage, {
          parse_mode: 'Markdown',
          ...inlineKeyboard
      });

  } catch (error) {
      console.error('Error switching wallet:', error);
      await ctx.reply('❌ Error switching wallet. Please try again.');
  }
});


bot.on('text', async (ctx) => {
    try {
      if (!ctx.session) {
        ctx.session = {};
      }
  
      if (settingsCommands.handleText) {
        const handled = await settingsCommands.handleText(ctx);
        if (handled) return;
      }
  
      const userId = ctx.from.id;
      const messageHasReply = ctx.message.reply_to_message;
      const userState = commands.userStates.get(userId);
  
      // Handle wallet import
      if (userState?.action === 'import' && messageHasReply) {
        if (messageHasReply.message_id !== userState.requestMessageId) return;
        try {
          const privateKey = ctx.message.text.trim();
          await ctx.deleteMessage().catch(e => console.log('Could not delete message:', e));
          await commands.importWallet(ctx, privateKey, userState.walletNumber);
          commands.userStates.delete(userId);
          await ctx.telegram.deleteMessage(ctx.chat.id, userState.requestMessageId)
            .catch(e => console.log('Could not delete request message:', e));
        } catch (error) {
          console.error('Error processing private key:', error);
          await ctx.reply('❌ Invalid private key format. Please try again.');
          commands.userStates.delete(userId);
        }
        return;
      }
  
      // Handle trade amount input
      if (ctx.session?.tradeState?.waitingForAmount && messageHasReply) {
        if (messageHasReply.message_id !== ctx.session.tradeState.messageId) return;
  
        try {
          const input = ctx.message.text.trim();
          const mode = ctx.session.tradeState.action;
          const currentWallet = ctx.session?.currentWallet || 'wallet1';
  
          // Get user settings
          const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${userId}/${currentWallet}`);
          const { slippage = 10, gas_limit = 500000 } = settings.data.settings;
  
          let amount;
          // Handle percentage for sells
          if (mode === 'sell' && input.endsWith('%')) {
            const percentage = parseFloat(input);
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
              return ctx.reply('❌ Please enter a valid percentage between 0 and 100');
            }
            const tokenBalances = await getTokenBalances(userId, ctx.session.pendingTrade.tokenAddress, ctx.session.pendingTrade.chain);
            const balance = tokenBalances.find(b => b.rawBalance > 0);
            if (!balance || balance.rawBalance <= 0) {
              return ctx.reply('❌ No token balance found');
            }
            amount = (BigInt(balance.rawBalance.toString()) * BigInt(Math.floor(percentage * 100))) / BigInt(10000);
          } else {
            amount = parseFloat(input);
            if (isNaN(amount) || amount <= 0) {
              return ctx.reply('❌ Please enter a valid amount');
            }
  
            // Validate amount against balance for buys
            if (mode === 'buy') {
              const walletBalances = await getWalletBalances(userId, ctx.session.pendingTrade.chain);
              const currentBalance = walletBalances.find(w => w.name === currentWallet);
              if (!currentBalance || parseFloat(currentBalance.balance) < amount) {
                return ctx.reply('❌ Insufficient balance');
              }
            }
          }
  
          // Update pending trade
          ctx.session.pendingTrade = {
            ...ctx.session.pendingTrade,
            amount: amount.toString(),
            slippage: slippage,
            gasLimit: gas_limit
          };
  
          // Execute trade directly
          await executeTrade(ctx, amount.toString(), mode);
  
          // Clean up trade state
          delete ctx.session.tradeState;
  
        } catch (error) {
          console.error('Error processing trade amount:', error);
          await ctx.reply('❌ Error processing amount. Please try again.');
        }
        return;
      }
  
      // Handle token scanning
      const addressRegex = /(0x[a-fA-F0-9]{40})/;
      const match = ctx.message.text.match(addressRegex);
      
      if (match) {
        const address = match[1];
  
        try {
          const scanningMsg = await ctx.reply('🔍 Scanning token on all chains...', {
            reply_to_message_id: ctx.message.message_id
          });
  
          const scanResult = await scanToken(address);
          
          if (!scanResult.success) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              scanningMsg.message_id,
              null,
              '❌ Token not found or has no liquidity. Please check the address and try again.'
            );
            return;
          }
  
          ctx.session.lastScan = {
            result: {
              chain: scanResult.chain,
              data: scanResult.data
            },
            address: address,
            data: scanResult.data
          };
  
          const chainName = scanResult.chain.toUpperCase();
          const message = await formatBriefResponse(
            scanResult.data,
            address,
            chainName,
            ctx.from.id,
            'buy',
            ctx.session?.currentWallet || 'wallet1'
          );
  
          const buttons = createTradingButtons(chainName);
          const inlineKeyboard = Markup.inlineKeyboard(buttons);
  
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            scanningMsg.message_id,
            null,
            message,
            {
              parse_mode: 'Markdown',
              ...inlineKeyboard
            }
          );
  
        } catch (error) {
          console.error('Error scanning token:', error);
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            scanningMsg.message_id,
            null,
            '❌ Error scanning token. Please try again later.'
          );
        }
      }
    } catch (error) {
      console.error('Error in text handler:', error);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  });


// Helper function to handle trade amount input
async function handleTradeAmountInput(ctx) {
  const messageHasReply = ctx.message.reply_to_message;
  if (!messageHasReply || messageHasReply.message_id !== ctx.session.tradeState.messageId) {
    return;
  }

  try {
    const input = ctx.message.text.trim();
    const tradeState = ctx.session.tradeState;
    const currentWallet = ctx.session?.currentWallet || 'wallet1';

    // Validate input and prepare trade data
    const tradeData = await validateAndPrepareTrade(ctx, input, tradeState, currentWallet);
    if (!tradeData) return;

    // Show confirmation message
    const confirmMessage = formatTradeConfirmation(tradeData);
    const confirmKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Confirm', 'confirm_trade'),
        Markup.button.callback('❌ Cancel', 'cancel')
      ]
    ]);

    await ctx.reply(confirmMessage, confirmKeyboard);

  } catch (error) {
    console.error('Error handling trade amount:', error);
    ctx.reply('❌ Error processing amount. Please try again.');
  }
}

// Helper function to validate and prepare trade data
async function validateAndPrepareTrade(ctx, input, tradeState, currentWallet) {
  const settings = await axios.get(`${BASE_URL}/wallet/evm/settings/${ctx.from.id}/${currentWallet}`);
  const { slippage = 10, gas_limit = 500000 } = settings.data.settings;

  // Parse amount and validate
  const amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Please enter a valid amount');
    return null;
  }

  // Get token data
  const tokenData = await scanToken(ctx.session.lastScan.address, ctx.session.lastScan.result.chain);
  if (!tokenData.success) {
    await ctx.reply('❌ Unable to fetch current token data');
    return null;
  }

  return {
    amount,
    slippage,
    gasLimit: gas_limit,
    tokenData,
    mode: tradeState.action
  };
}

// Helper function to format trade confirmation message
function formatTradeConfirmation(tradeData) {
  const { amount, tokenData, mode } = tradeData;
  const mainPair = tokenData.data.pairs[0];
  const price = parseFloat(mainPair.priceUsd);
  const value = amount * price;

  return [
    `🔄 ${mode.toUpperCase()} Confirmation`,
    '',
    `Amount: ${formatNumberWithCommas(amount)}`,
    `Value: $${formatNumberWithCommas(value)}`,
    `Price: $${formatPrice(price)}`,
    '',
    '📊 Market Stats:',
    `24h Volume: $${formatNumberWithCommas(mainPair.volume?.h24 || 0)}`,
    `Liquidity: $${formatNumberWithCommas(mainPair.liquidity?.usd || 0)}`,
    '',
    'Do you want to proceed?'
  ].join('\n');
}

// Handle trade confirmation
bot.action('confirm_trade', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    if (!ctx.session?.pendingTrade) {
      return ctx.reply('❌ No pending trade found.');
    }

    await executeTrade(ctx, ctx.session.pendingTrade.amount, ctx.session.pendingTrade.mode);

    // Clean up session
    delete ctx.session.pendingTrade;
    delete ctx.session.tradeState;
    delete ctx.session.tokenBalance;

  } catch (error) {
    console.error('Error confirming trade:', error);
    ctx.reply('❌ Error processing trade. Please try again.');
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


  
  settingsCommands.setupActions(bot);
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