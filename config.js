require('dotenv').config();

// ABIs
const ROUTER_V2_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function WETH() external pure returns (address)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)"
];

// Network Configurations using your existing environment variables
const NETWORKS = {
    ETH: {
        name: 'Ethereum',
        rpc: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        chainId: 1,
        nativeCurrency: 'ETH',
        addresses: {
            EDGE_ROUTER: "0xDfB50fB4BE4A0F7E9A7e5641944471bB0D2902D9",
            V2: {
                ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router
                WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"  // WETH on Ethereum
            },
            V3: {
                ROUTER: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // Uniswap V3 Router
                QUOTER: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // Uniswap V3 Quoter
                WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"  // WETH on Ethereum
            }
        }
    },
    BSC: {
        name: 'BSC',
        rpc: process.env.QUICKNODE_BSC_URL,
        chainId: 56,
        nativeCurrency: 'BNB',
        addresses: {
            EDGE_ROUTER: "0xDfB50fB4BE4A0F7E9A7e5641944471bB0D2902D9",
            V2: {
                ROUTER: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap V2 Router
                WETH: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"  // WBNB on BSC
            },
            V3: {
                ROUTER: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", // PancakeSwap V3 Router
                QUOTER: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997", // PancakeSwap V3 Quoter
                WETH: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"  // WBNB on BSC
            }
        }
    }
};

module.exports = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    EVA_API_KEY: process.env.EVA_API_KEY,
    EVA_API_BASE_URL: process.env.EVA_API_BASE_URL,
    BASE_URL: process.env.BASE_URL,
    ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
    QUICKNODE_BSC_URL: process.env.QUICKNODE_BSC_URL,
    NETWORKS,
    ROUTER_V2_ABI,
    ERC20_ABI
};