// commands.js
const { Markup } = require('telegraf');
const ethers = require('ethers');
module.exports = {
  startCommand(ctx) {
    const firstName = ctx.from.first_name || 'User';
    const Homekeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🚨Token Scanner`, 'home'),
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
    
    

    ctx.replyWithMarkdown(`👋*Welcome* ${firstName} to Future Edge Trading Bot! \n\nThe *Fastest*⚡ and most *Reliable*🛡️ \n🥏 Token Scanner \n🥏 Trade Bot \n\nPaste📝 any Token Contract Address on *Eth || Bsc*  on this bot to Scan & Trade \n\n*Eth || Bsc* \nWallet:*Not Connected*\nPrice $2230(ETH) \nPrice $315(BSC) \n\n👁️ 0 Tracked Token(s) \n🙈 0 Position(s)`,Homekeyboard, Markup.keyboard(['/help']).resize());
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
    👝
  
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
  
    ♦️♠️♥️♣️♦️♠️♥️♣️
  `;
  
  const walletManagementKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(` Balance`, 'balance'),
      Markup.button.callback(` Deposit`, 'deposit'),
    ],
  ]);

  // Send the wallet details as a reply with Markdown formatting
  ctx.reply(walletInfoMessage, walletManagementKeyboard);

  console.log('Response sent:', 'Create new wallet button clicked');
  }
};


/////////////////////////////
////////////////////////////
///////////////////////////
