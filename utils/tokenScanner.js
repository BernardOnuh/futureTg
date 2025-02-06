// tokenScanner.js
const axios = require('axios');

// Helper Functions
function formatPrice(price) {
  // Convert to number if it's a string
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;

  // Handle invalid cases
  if (typeof numPrice !== 'number' || isNaN(numPrice)) {
    return '0.00';
  }

  try {
    if (numPrice < 0.000001) {
      return numPrice.toExponential(4);
    }
    if (numPrice < 0.001) {
      return numPrice.toFixed(8);
    }
    if (numPrice < 1) {
      return numPrice.toFixed(6);
    }
    if (numPrice < 10) {
      return numPrice.toFixed(4);
    }
    if (numPrice < 1000) {
      return numPrice.toFixed(2);
    }
    return formatNumberWithCommas(numPrice);
  } catch (error) {
    console.error('Error formatting price:', error);
    return '0.00';
  }
}

// Format number with commas and handle edge cases
function formatNumberWithCommas(number) {
  try {
    // Convert to number if it's a string
    const num = typeof number === 'string' ? parseFloat(number) : number;
    
    // Handle invalid cases
    if (typeof num !== 'number' || isNaN(num)) {
      return '0';
    }

    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  } catch (error) {
    console.error('Error formatting number:', error);
    return '0';
  }
}

// Format token amount with appropriate decimals
function formatTokenAmount(amount, decimals = 18) {
  try {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (typeof num !== 'number' || isNaN(num)) {
      return '0';
    }

    if (num === 0) {
      return '0';
    }

    if (num < 0.000001) {
      return num.toExponential(4);
    }

    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    });
  } catch (error) {
    console.error('Error formatting token amount:', error);
    return '0';
  }
}
async function scanToken(address) {
  try {
    console.log(`Scanning token ${address} on all chains`);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    console.log('DexScreener API URL:', url);

    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.data || !response.data.pairs || !Array.isArray(response.data.pairs)) {
      console.log('Invalid response format from DexScreener');
      return { success: false, message: 'Invalid response format' };
    }

    const pairs = response.data.pairs;
    if (pairs.length === 0) {
      console.log('No pairs found on any chain');
      return { success: false, message: 'No liquidity pairs found' };
    }

    // Group pairs by chain
    const ethPairs = pairs.filter(pair => pair.chainId === 'ethereum');
    const bscPairs = pairs.filter(pair => pair.chainId === 'bsc');

    // Sort each chain's pairs by liquidity
    const sortByLiquidity = (pairs) => {
      return pairs.sort((a, b) => {
        const liquidityA = parseFloat(a.liquidity?.usd || 0);
        const liquidityB = parseFloat(b.liquidity?.usd || 0);
        return liquidityB - liquidityA;
      });
    };

    const sortedEthPairs = sortByLiquidity(ethPairs);
    const sortedBscPairs = sortByLiquidity(bscPairs);

    // Choose the chain with the highest liquidity
    let selectedChain;
    let selectedPairs;
    
    const ethLiquidity = sortedEthPairs[0]?.liquidity?.usd || 0;
    const bscLiquidity = sortedBscPairs[0]?.liquidity?.usd || 0;

    if (ethLiquidity > bscLiquidity) {
      selectedChain = 'eth';
      selectedPairs = sortedEthPairs;
    } else if (bscLiquidity > 0) {
      selectedChain = 'bsc';
      selectedPairs = sortedBscPairs;
    } else if (ethLiquidity > 0) {
      selectedChain = 'eth';
      selectedPairs = sortedEthPairs;
    } else {
      console.log('No significant liquidity found on any chain');
      return { success: false, message: 'No liquidity found' };
    }

    console.log(`Selected chain: ${selectedChain} with ${selectedPairs.length} pairs`);

    if (selectedPairs.length === 0) {
      return { success: false, message: 'No pairs found' };
    }

    return {
      success: true,
      chain: selectedChain,
      data: {
        pairs: selectedPairs,
        baseToken: selectedPairs[0].baseToken,
        quoteToken: selectedPairs[0].quoteToken,
        pairAddress: selectedPairs[0].pairAddress,
        dexId: selectedPairs[0].dexId
      }
    };

  } catch (error) {
    console.error('Error scanning token:', error.message);
    return {
      success: false,
      message: error.response?.data?.error || error.message,
      error: error
    };
  }
}


// Position-specific scanner for fetching current token data for positions
async function fetchPositionTokenData(chain, tokenAddress) {
  try {
    const chainPath = chain.toLowerCase() === 'eth' ? 'ethereum' : 'bsc';
    console.log(`Fetching position data for ${tokenAddress} on ${chainPath}`);
    
    // Use the latest API endpoint for positions as well
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    console.log('Position Scanner URL:', url);

    const response = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.data || !response.data.pairs || !Array.isArray(response.data.pairs)) {
      console.log('Invalid response format from DexScreener');
      return null;
    }

    // Filter for the correct chain
    const chainPairs = response.data.pairs.filter(pair => 
      pair.chainId === (chain.toLowerCase() === 'eth' ? 'ethereum' : 'bsc')
    );

    if (chainPairs.length === 0) {
      console.log('No pairs found for position');
      return null;
    }

    // Sort by liquidity and get the most liquid pair
    const sortedPairs = chainPairs.sort((a, b) => {
      const liquidityA = parseFloat(a.liquidity?.usd || 0);
      const liquidityB = parseFloat(b.liquidity?.usd || 0);
      return liquidityB - liquidityA;
    });

    // Return position-specific data structure
    const mainPair = sortedPairs[0];
    return {
      priceUsd: parseFloat(mainPair.priceUsd || 0),
      priceNative: parseFloat(mainPair.priceNative || 0),
      marketCap: parseFloat(mainPair.marketCap || mainPair.fdv || 0),
      liquidity: {
        usd: parseFloat(mainPair.liquidity?.usd || 0),
        base: parseFloat(mainPair.liquidity?.base || 0),
        quote: parseFloat(mainPair.liquidity?.quote || 0)
      },
      volume: mainPair.volume || {},
      txns: mainPair.txns || {},
      dexId: mainPair.dexId,
      pairAddress: mainPair.pairAddress,
      baseToken: mainPair.baseToken,
      quoteToken: mainPair.quoteToken,
      priceChange: mainPair.priceChange || {},
      labels: mainPair.labels || [],
      info: mainPair.info || {},
      tax: mainPair.tax || { buy: 3, sell: 3 }
    };

  } catch (error) {
    console.error('Error fetching position token data:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    return null;
  }
}

// Helper function to extract token data
function extractTokenData(scanData) {
  try {
    const mainPair = scanData.pairs[0];
    return {
      symbol: mainPair.baseToken.symbol,
      name: mainPair.baseToken.name,
      address: mainPair.baseToken.address,
      marketCap: parseFloat(mainPair.marketCap || mainPair.fdv || 0),
      price: parseFloat(mainPair.priceUsd || 0),
      priceNative: parseFloat(mainPair.priceNative || 0),
      liquidity: {
        usd: parseFloat(mainPair.liquidity?.usd || 0),
        base: parseFloat(mainPair.liquidity?.base || 0),
        quote: parseFloat(mainPair.liquidity?.quote || 0)
      },
      volume24h: parseFloat(mainPair.volume?.h24 || 0),
      priceChange: mainPair.priceChange || {},
      txns24h: mainPair.txns?.h24 || {}
    };
  } catch (error) {
    console.error('Error extracting token data:', error);
    return null;
  }
}

// Format number with commas
function formatNumberWithCommas(number) {
  try {
    return number.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  } catch (error) {
    return '0';
  }
}

// Format price with appropriate decimals
function formatPrice(price) {
  if (!price || isNaN(price)) return '0.00';
  
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 10) return price.toFixed(4);
  if (price < 1000) return price.toFixed(2);
  return formatNumberWithCommas(price);
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

module.exports = {
  scanToken,
  fetchPositionTokenData,
  extractTokenData,
  formatNumberWithCommas,
  formatPrice,
  formatTokenAmount
};
