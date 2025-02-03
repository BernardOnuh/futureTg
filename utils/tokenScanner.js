const axios = require('axios');
const config = require('../config');

// Helper functions
function getDexScreenerUrl(chain, address) {
    const chainPath = chain === 'eth' ? 'ethereum' : 'bsc';
    return `https://dexscreener.com/${chainPath}/${address}`;
}

function formatNumberWithCommas(num) {
    if (!num || isNaN(num)) return '0';
    
    try {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(2);
    } catch (error) {
        console.error('Error formatting number:', error);
        return '0';
    }
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '0.00';
    
    try {
        if (price < 0.0001) {
            return price.toExponential(4);
        } else if (price < 1) {
            return price.toFixed(8);
        } else {
            return price.toFixed(4);
        }
    } catch (error) {
        console.error('Error formatting price:', error);
        return '0.00';
    }
}

// Extract token data from DexScreener response
function extractTokenData(data) {
    try {
        if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
            throw new Error('No pairs found');
        }

        const validPairs = data.pairs
            .filter(pair => pair.liquidity?.usd && pair.priceUsd)
            .sort((a, b) => 
                (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0)
            );

        if (validPairs.length === 0) {
            throw new Error('No valid pairs found');
        }

        const mainPair = validPairs[0];
        
        return {
            name: mainPair.baseToken.name,
            symbol: mainPair.baseToken.symbol,
            priceUsd: parseFloat(mainPair.priceUsd || 0),
            priceNative: parseFloat(mainPair.priceNative || 0),
            priceChange: {
                m5: parseFloat(mainPair.priceChange?.m5 || 0),
                h1: parseFloat(mainPair.priceChange?.h1 || 0),
                h6: parseFloat(mainPair.priceChange?.h6 || 0),
                h24: parseFloat(mainPair.priceChange?.h24 || 0)
            },
            transactions: mainPair.txns || {
                m5: { buys: 0, sells: 0 },
                h1: { buys: 0, sells: 0 },
                h6: { buys: 0, sells: 0 },
                h24: { buys: 0, sells: 0 }
            },
            marketCap: parseFloat(mainPair.fdv || mainPair.marketCap || 0),
            liquidity: {
                usd: parseFloat(mainPair.liquidity?.usd || 0),
                base: parseFloat(mainPair.liquidity?.base || 0),
                quote: parseFloat(mainPair.liquidity?.quote || 0)
            },
            volume: {
                h24: parseFloat(mainPair.volume?.h24 || 0),
                h6: parseFloat(mainPair.volume?.h6 || 0),
                h1: parseFloat(mainPair.volume?.h1 || 0),
                m5: parseFloat(mainPair.volume?.m5 || 0)
            },
            pairs: validPairs,
            dexId: mainPair.dexId,
            chainId: mainPair.chainId,
            pairCreated: mainPair.pairCreatedAt
        };
    } catch (error) {
        console.error('Error extracting token data:', error);
        throw error;
    }
}

// Calculate price impact
function calculatePriceImpact(tokenData, chainName) {
    try {
        if (!tokenData || !tokenData.liquidity) return 'N/A';

        const testAmount = 5;
        let quoteLiquidity = 0;

        const quoteSymbol = chainName.toLowerCase() === 'eth' ? 'WETH' : 'WBNB';
        const liquidPools = tokenData.pairs.filter(pair => 
            pair.quoteToken.symbol === quoteSymbol &&
            pair.liquidity?.quote
        );

        if (liquidPools.length > 0) {
            quoteLiquidity = parseFloat(liquidPools[0].liquidity.quote);
        }

        if (!quoteLiquidity || quoteLiquidity === 0) return 'N/A';
        
        const impact = (testAmount / quoteLiquidity) * 100;
        return impact.toFixed(2);
    } catch (error) {
        console.error('Error calculating price impact:', error);
        return 'N/A';
    }
}

// Scan token using DexScreener
async function getDexScreenerData(address, chain = 'eth') {
    try {
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/search?q=${address}`,
            { timeout: 10000 }
        );

        if (!response.data.pairs || response.data.pairs.length === 0) {
            return null;
        }

        const chainId = chain === 'eth' ? 'ethereum' : 'bsc';
        const chainPairs = response.data.pairs.filter(p => p.chainId === chainId);

        if (chainPairs.length === 0) return null;

        return { ...response.data, pairs: chainPairs };
    } catch (error) {
        console.error('DexScreener fetch error:', error);
        return null;
    }
}

// Get audit data from EVA API
async function getAuditData(address, chain = 'eth') {
    try {
        const url = `${config.EVA_API_BASE_URL}/getAuditbyToken/${chain}/${address}`;
        const response = await axios.get(url, {
            headers: {
                'x-api-key': config.EVA_API_KEY
            },
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error('EVA API error:', error);
        return null;
    }
}

// Main scan function that combines both APIs
async function scanToken(address, chain = 'eth') {
    console.log(`Scanning token ${address} on ${chain} chain`);

    try {
        // Get DexScreener data first
        const dexData = await getDexScreenerData(address, chain);
        if (!dexData) {
            return {
                success: false,
                error: 'Token not found on DexScreener',
                chain
            };
        }

        // Try to get audit data
        const auditData = await getAuditData(address, chain);
        
        // Combine the data
        const combinedData = {
            ...dexData,
            audit: auditData ? {
                renounced: auditData.renounced || false,
                AIaudit: auditData.AIaudit || {
                    executiveSummary: {
                        Privileges: 'N/A',
                        MaliciousCode: 'N/A',
                        TaxStructure: {
                            'Initial Taxes': 'N/A',
                            'Final Taxes': 'N/A',
                            'Reduced after': 'N/A'
                        },
                        TransactionLimit: 'N/A',
                        EnforcedFor: 'N/A',
                        findings: []
                    }
                }
            } : null
        };

        return {
            success: true,
            data: combinedData,
            chain: chain
        };

    } catch (error) {
        console.error('Scan error:', error);
        return {
            success: false,
            error: error.message,
            chain
        };
    }
}

function formatFindings(findings) {
    if (!Array.isArray(findings)) {
        return 'No findings available';
    }
    
    return findings.map((finding, index, array) => {
        const prefix = index === array.length - 1 ? '└' : '├';
        return `${prefix} ${finding.rating || '⚪'} ${finding.issue || 'No issue description'}`
    }).join('\n');
}

function getTradeVolume(transactions, period = 'h24') {
    if (!transactions || !transactions[period]) return { buys: 0, sells: 0 };
    return transactions[period];
}

module.exports = {
    getDexScreenerUrl,
    scanToken,
    formatFindings,
    extractTokenData,
    calculatePriceImpact,
    formatNumberWithCommas,
    formatPrice,
    getTradeVolume
};