// commands.js
const { Markup } = require('telegraf');
const ethers = require('ethers');
const middlewares = require('./middlewares');
const api = require('./api/scanner');

module.exports = {
  async startCommand(ctx) {
    try {
        const firstName = ctx.from.first_name || 'User';
        const Homekeyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback(`📈📉 Long/Short`, 'scanner'),
                Markup.button.callback(`👜Wallet`, 'wallet'),
            ],
            [
                Markup.button.callback(`📊Active Trades`, 'active'),
                Markup.button.callback(`⚙️Settings`, 'settings'),
            ],
            [
              Markup.button.callback(`📊Chart`, 'snipe'),
          ],
            [
                Markup.button.callback(`🚨Alert`, 'snipe'),
            ],
        ]);

        const ethPriceResponse = await api.getTokenDetails('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        const bscPriceResponse = await api.getTokenDetails('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');

        const ethPrice = ethPriceResponse.pairs.length > 0 ? ethPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';
        const bscPrice = bscPriceResponse.pairs.length > 0 ? bscPriceResponse.pairs[0].priceUsd.toFixed(2) : 'N/A';

        ctx.replyWithMarkdown(`👋*Welcome* ${firstName} to Infinity \n\nThe *Fastest*⚡ and most *Reliable*🛡️ bot for your perpetual trading \n➡️ Leverage Trading \n➡️ Earn Fees \n\n🔗Connect your Wallet and Leverage trade  \n📈📉 *ETH/USD*  \n*📈📉 BTC/USD*   \n\nWallet 👜:*Not Connected*\nPrice $${ethPrice}(ETH/USDT) \nPrice $${bscPrice}(BTC/USDT) \n\n👁️ 0 Tracked Token(s) \n🙈 0 Position(s)`, Homekeyboard, Markup.keyboard(['/help']).resize());
    } catch (error) {
        console.error('Error:', error.message);
        ctx.reply('Error processing the request. Please try again later.');
    }
},


  helpCommand(ctx) {
    ctx.reply('You asked for help!');
  },

  walletCommand(ctx) {
    const wallet = ethers.Wallet.createRandom();

    // Extract wallet details
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    const mnemonicPhrase = wallet.mnemonic.phrase;



    // Prepare the reply message with wallet details
    const walletInfoMessage = `
    👝👝👝👝👝👝👝👝👝👝
  
    ✨ NEW WALLET CREATED  ✨
  
    This is your new wallet:
    
    Address: 
    ${address}
  
    Private Key:
    ${privateKey}
  
    Mnemonic Phrase: 
    ${mnemonicPhrase}
  
    🚀 Keep your private key and mnemonic phrase safe!
    💼 You can also add it to any Ethereum wallet.
  
    ✨ Enjoy secure crypto transactions! ✨
  
    👝👝👝👝👝👝👝👝👝👝
  `;
  
  const walletManagementKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(` Balance`, 'balance'),
      Markup.button.callback(` Deposit`, 'deposit'),
    ],
  ]);


  ctx.reply(walletInfoMessage, walletManagementKeyboard);

  console.log('Response sent:', 'Create new wallet button clicked');
  },


  scannerCommand(ctx) {
    ctx.reply('Please input your ETH/BSC Contract Address')
  },

  async getAddressDetailsCommand(ctx) {
    try {
      const address = extractAddressFromMessage(ctx.message.text);

      if (address) {
        const details = await api.getAddressDetails(address);
        const prices = await api.getTokenDetails(address);
        console.log(details);
        const flagsMessage = details.flags.length ? `\n\n⚠️${details.flags}` : '';
        const honeypotStatus = details.honeypotResult.isHoneypot ? '\n\n⚠️HONEY POT' : '\n\nNO HONEY POT';
        const gasMessage = details.holderAnalysis.averageGas ? `⛽ Gas: ${details.holderAnalysis.averageGas.toFixed(2)}` : '';
        const createdAtTimestamp = details.pair.createdAtTimestamp;

const currentTimestamp = Math.floor(Date.now() / 1000); // Current time in seconds

const secondsDifference = currentTimestamp - createdAtTimestamp;
const daysDifference = Math.floor(secondsDifference / (60 * 60 * 24));

        ctx.reply(` 📌 ${details.token.name}(${details.token.symbol})${flagsMessage}${honeypotStatus}\n\n ⚠️️ Max Transaction | Set Tax | Max Wallet \n\n🔸 Chain: ${details.chain.currency}|| ⚖️ Age: ${daysDifference} Days \n\n👩‍👧‍👦 Total Holders: ${details.token.totalHolders} \n\n💳buyTax:${details.simulationResult.buyTax}||sellTax:${details.simulationResult.sellTax} \n\n ${gasMessage} \n\n💲 Price: $${prices.pairs[0].priceUsd.toFixed(6)} \n\n💰 MarketCap:${prices.pairs[0].fdv.toFixed(6)}\n\nDYOR/NFA: Automated report.\n\nWishing everyone a HAPPY NEW YEAR 🥂from the Future Edge FAM `);
      } else {
        ctx.reply('Not a valid address found in the message.');
      }
    } catch (error) {
      console.error('Error:', error.message);
      ctx.reply('Error processing the request. Please try again later.');
    }
  },
};

// Function to extract Ethereum address from a message
function extractAddressFromMessage(message) {
  const addressRegex = /(0x[a-fA-F0-9]{40})/;
  const match = message.match(addressRegex);
  return match ? match[0] : null;
}


