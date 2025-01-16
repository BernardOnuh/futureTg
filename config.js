require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  EVA_API_KEY: process.env.EVA_API_KEY,
  EVA_API_BASE_URL: process.env.EVA_API_BASE_URL,
  BASE_URL: process.env.BASE_URL,
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  QUICKNODE_BSC_URL: process.env.QUICKNODE_BSC_URL
};