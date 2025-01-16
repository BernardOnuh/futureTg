// utils/tokenScanner.js
const axios = require('axios');
const config = require('../config');

function getDexScreenerUrl(chain, address) {
  const chainPath = chain === 'eth' ? 'ethereum' : 'bsc';
  return `https://dexscreener.com/${chainPath}/${address}`;
}

async function scanToken(address, chain = 'eth') {
  console.log(`Attempting to scan token ${address} on ${chain} chain`);
  try {
    const url = `${config.EVA_API_BASE_URL}/getAuditbyToken/${chain}/${address}`;
    console.log('Making API request to:', url);
    
    const response = await axios.get(url, {
      headers: {
        'x-api-key': config.EVA_API_KEY
      },
      timeout: 30000 // 30 seconds timeout
    });
    
    console.log(`Successfully received response for ${chain} chain`);
    return { success: true, data: response.data, chain };
  } catch (error) {
    console.error(`Error scanning token on ${chain} chain:`, {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    return { success: false, error: error.message, chain };
  }
}

function formatFindings(findings) {
  if (!Array.isArray(findings)) {
    console.error('Invalid findings format:', findings);
    return 'No findings available';
  }
  return findings.map((finding, index, array) => {
    const prefix = index === array.length - 1 ? '└' : '├';
    return `${prefix} ${finding.rating || '⚪'} ${finding.issue || 'No issue description'}`
  }).join('\n');
}

module.exports = {
  getDexScreenerUrl,
  scanToken,
  formatFindings
};