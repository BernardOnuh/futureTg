const { ethers } = require('ethers');
const { ROUTER_V2_ABI, ERC20_ABI, NETWORKS } = require("./config");
const { QUOTER_ABI, SWAP_ROUTER_ABI, EDGE_ROUTER_ABI } = require("./abis");

class TradeExecutor {
    constructor(network, privateKey) {
        if (!network || !privateKey) {
            throw new Error('Network and private key are required');
        }

        console.log('\n=== Initializing TradeExecutor ===');
        console.log('Network:', network);
        
        this.network = NETWORKS[network];
        if (!this.network) {
            throw new Error(`Invalid network selected: ${network}`);
        }

        try {
            this.provider = new ethers.JsonRpcProvider(this.network.rpc);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            
            console.log('\n=== Network Configuration ===');
            console.log('RPC URL:', this.network.rpc);
            console.log('Chain ID:', this.network.chainId);
            console.log('Wallet Address:', this.wallet.address);
            
            this.initializeContracts();
        } catch (error) {
            console.error('Constructor error:', error);
            throw new Error(`Initialization failed: ${error.message}`);
        }
    }

    initializeContracts() {
        if (!this.network.addresses) {
            throw new Error('Network addresses not configured');
        }

        const { V2, V3, EDGE_ROUTER } = this.network.addresses;
        
        console.log('\n=== Contract Addresses ===');
        console.log('Edge Router:', EDGE_ROUTER);
        console.log('V2 Router:', V2.ROUTER);
        console.log('V2 WETH:', V2.WETH);
        console.log('V3 Router:', V3.ROUTER);
        console.log('V3 Quoter:', V3.QUOTER);
        console.log('V3 WETH:', V3.WETH);

        if (!V2?.ROUTER || !V2?.WETH || !V3?.ROUTER || !V3?.QUOTER || !V3?.WETH || !EDGE_ROUTER) {
            throw new Error('Missing required contract addresses');
        }

        try {
            this.routerV2 = new ethers.Contract(V2.ROUTER, ROUTER_V2_ABI, this.wallet);
            this.routerV3 = new ethers.Contract(V3.ROUTER, SWAP_ROUTER_ABI, this.wallet);
            this.quoterV3 = new ethers.Contract(V3.QUOTER, QUOTER_ABI, this.wallet);
            this.edgeRouter = new ethers.Contract(EDGE_ROUTER, EDGE_ROUTER_ABI, this.wallet);
            
            console.log('All contracts initialized successfully');
        } catch (error) {
            console.error('Contract initialization error:', error);
            throw new Error(`Contract initialization failed: ${error.message}`);
        }
    }

    async executeBuy(tokenAddress, amountNative) {
        console.log('\n=== Starting Buy Execution ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount Native:', amountNative);

        try {
            // Convert amount to BigInt safely
            const amountIn = ethers.parseEther(amountNative.toString());
            
            // Get token details
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            const [symbol, decimals] = await Promise.all([
                token.symbol().catch(() => 'UNKNOWN'),
                token.decimals().catch(() => 18)
            ]);

            // Check wallet balance
            const balance = await this.provider.getBalance(this.wallet.address);
            if (balance < amountIn) {
                throw new Error(`Insufficient ETH balance. Have: ${ethers.formatEther(balance)} ETH, Need: ${ethers.formatEther(amountIn)} ETH`);
            }

            // Get pool info and quote
            const poolInfo = await this.detectPool(tokenAddress, amountNative);
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

            // Get gas data
            const { gasPrice } = await this.provider.getFeeData();

            let tx;
            if (poolInfo.version === 2) {
                tx = await this.executeV2Buy(
                    tokenAddress,
                    amountIn,
                    poolInfo.amountOut,
                    deadline,
                    gasPrice
                );
            } else {
                tx = await this.executeV3Buy(
                    tokenAddress,
                    amountIn,
                    poolInfo,
                    deadline,
                    gasPrice
                );
            }

            return tx;

        } catch (error) {
            console.error('\n=== Buy Execution Error ===');
            console.error('Error type:', error.constructor.name);
            console.error('Error message:', error.message);
            throw error;
        }
    }

    async executeSell(tokenAddress, amountTokens) {
        console.log('\n=== Starting Sell Execution ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount Tokens:', amountTokens);
    
        try {
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            const [symbol, decimals] = await Promise.all([
                token.symbol().catch(() => 'UNKNOWN'),
                token.decimals().catch(() => 18)
            ]);
    
            // Get current balance first
            const balance = await token.balanceOf(this.wallet.address);
            const formattedBalance = ethers.formatUnits(balance, decimals);
            console.log('Current balance:', formattedBalance, symbol);
    
            // If amount is a percentage, calculate the actual amount
            let sellAmount;
            if (typeof amountTokens === 'string' && amountTokens.endsWith('%')) {
                const percentage = parseFloat(amountTokens) / 100;
                sellAmount = (parseFloat(formattedBalance) * percentage).toString();
                console.log(`Selling ${amountTokens} = ${sellAmount} ${symbol}`);
            } else {
                // Check if amountTokens is already in wei format (big number)
                if (ethers.isHexString(amountTokens) || /^\d+$/.test(amountTokens)) {
                    sellAmount = ethers.formatUnits(amountTokens, decimals);
                    console.log(`Converting wei amount to decimal: ${sellAmount} ${symbol}`);
                } else {
                    sellAmount = amountTokens.toString();
                }
            }
    
            // Convert to token decimals
            const amountIn = ethers.parseUnits(sellAmount, decimals);
            console.log('Amount in wei:', amountIn.toString());
    
            // Verify balance is sufficient
            if (balance < amountIn) {
                throw new Error(`Insufficient token balance. Have: ${formattedBalance} ${symbol}, Need: ${sellAmount} ${symbol}`);
            }
    
            // Check and set allowance if needed
            const allowance = await token.allowance(this.wallet.address, this.edgeRouter.target);
            if (allowance < amountIn) {
                console.log('Setting token approval...');
                const approveTx = await token.approve(this.edgeRouter.target, ethers.MaxUint256);
                await approveTx.wait();
                console.log('Token approval set');
            }
    
            // Get pool info and quote
            const poolInfo = await this.detectPool(tokenAddress, sellAmount);
            const deadline = Math.floor(Date.now() / 1000) + 300;
    
            // Get gas data
            const { gasPrice } = await this.provider.getFeeData();
    
            let tx;
            if (poolInfo.version === 2) {
                tx = await this.executeV2Sell(
                    tokenAddress,
                    amountIn,
                    poolInfo.amountOut,
                    deadline,
                    gasPrice
                );
            } else {
                tx = await this.executeV3Sell(
                    tokenAddress,
                    amountIn,
                    poolInfo,
                    deadline,
                    gasPrice
                );
            }
    
            return tx;
    
        } catch (error) {
            console.error('\n=== Sell Execution Error ===');
            console.error('Error type:', error.constructor.name);
            console.error('Error message:', error.message);
            throw error;
        }
    }

    async detectPool(tokenAddress, amountNative) {
        console.log('\n=== Detecting Pool ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount Native:', amountNative);

        if (!tokenAddress || !amountNative) {
            throw new Error('Token address and amount required');
        }

        try {
            // Try V3 first
            try {
                const v3Pool = await this.tryV3FeeTiers(tokenAddress, amountNative);
                return { version: 3, ...v3Pool };
            } catch (v3Error) {
                console.log('\nNo V3 pool found, trying V2...');
            }

            // Try V2
            const amountIn = ethers.parseEther(amountNative.toString());
            const path = [this.network.addresses.V2.WETH, tokenAddress];
            
            console.log('\nV2 Pool Check:');
            console.log('Path:', path);
            console.log('Amount In:', amountIn.toString());
            
            const amounts = await this.routerV2.getAmountsOut(amountIn, path);
            
            if (!amounts || amounts.length < 2) {
                throw new Error('Invalid amounts returned from router');
            }

            return { 
                version: 2, 
                amountOut: amounts[1],
                amountIn: amountIn
            };

        } catch (error) {
            console.error('Pool detection error:', error);
            throw error;
        }
    }

    async tryV3FeeTiers(tokenAddress, amountNative) {
        console.log('\n=== Trying V3 Fee Tiers ===');

        if (!this.quoterV3 || !this.network.addresses.V3.WETH) {
            throw new Error('V3 contracts not properly initialized');
        }

        const feeTiers = [100, 500, 3000, 10000];
        
        for (const feeTier of feeTiers) {
            try {
                console.log(`\nChecking ${feeTier/10000}% fee tier`);
                const amountIn = ethers.parseEther(amountNative.toString());

                const params = {
                    tokenIn: this.network.addresses.V3.WETH,
                    tokenOut: tokenAddress,
                    fee: feeTier,
                    amountIn: amountIn,
                    sqrtPriceLimitX96: 0
                };

                const quotedAmountOut = await this.quoterV3.quoteExactInputSingle(params);
                
                console.log('Quote Results:');
                console.log('Amount Out:', quotedAmountOut.toString());

                if (quotedAmountOut > 0) {
                    return { feeTier, amountOut: quotedAmountOut };
                }
            } catch (error) {
                console.log(`Error with ${feeTier/10000}% fee tier:`, error.message);
            }
        }
        
        throw new Error("No viable V3 fee tier found");
    }

    async executeV2Buy(tokenAddress, amountIn, amountOut, deadline, gasPrice) {
        console.log('\n=== Executing V2 Buy ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount In:', amountIn.toString());
        console.log('Expected Out:', amountOut?.toString() || '0');
        
        try {
            if (!amountIn || amountIn === BigInt(0)) {
                throw new Error('Invalid input amount');
            }

            const path = [this.network.addresses.V2.WETH, tokenAddress];
            const amountOutMin = BigInt(0); // No slippage for now

            // Create transaction options
            const options = {
                value: amountIn,
                gasLimit: BigInt(500000)
            };

            if (gasPrice) {
                options.gasPrice = gasPrice;
            }

            const tx = await this.edgeRouter.swapExactETHForTokensSupportingFeeOnTransferTokens(
                this.network.addresses.V2.ROUTER,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                options
            );

            console.log('Transaction Hash:', tx.hash);
            
            // Ensure we always return an object with at least a hash
            return {
                hash: tx.hash,
                wait: async () => {
                    try {
                        return await tx.wait();
                    } catch (waitError) {
                        console.error('Error waiting for transaction:', waitError);
                        return { hash: tx.hash };
                    }
                }
            };

        } catch (error) {
            console.error('V2 Buy Execution Error:', error);
            throw new Error(`Buy execution failed: ${error.message}`);
        }
    }

    async executeV2Sell(tokenAddress, amountIn, amountOut, deadline, gasPrice) {
        console.log('\n=== Executing V2 Sell ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount In:', amountIn.toString());

        try {
            if (!amountIn || amountIn === BigInt(0)) {
                throw new Error('Invalid sell amount');
            }

            const path = [tokenAddress, this.network.addresses.V2.WETH];
            const amountOutMin = BigInt(0); // No slippage for tax tokens

            // Create transaction options
            const options = {
                gasLimit: BigInt(500000)
            };

            if (gasPrice) {
                options.gasPrice = gasPrice;
            }

            const tx = await this.edgeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
                this.network.addresses.V2.ROUTER,
                amountIn,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                options
            );

            console.log('Transaction Hash:', tx.hash);
            
            // Ensure we always return an object with at least a hash
            return {
                hash: tx.hash,
                wait: async () => {
                    try {
                        return await tx.wait();
                    } catch (waitError) {
                        console.error('Error waiting for transaction:', waitError);
                        return { hash: tx.hash };
                    }
                }
            };

        } catch (error) {
            console.error('V2 Sell Execution Error:', error);
            throw new Error(`Sell execution failed: ${error.message}`);
        }
    }

    async executeV3Buy(tokenAddress, amountIn, poolInfo, deadline, gasPrice) {
        console.log('\n=== Executing V3 Buy ===');
        console.log('Token Address:', tokenAddress);
        console.log('Amount In:', amountIn.toString());
        console.log('Fee Tier:', poolInfo.feeTier);
        
        const amountOutMin = BigInt(0); // No slippage for now

        const params = {
            tokenIn: this.network.addresses.V3.WETH,
            tokenOut: tokenAddress,
            fee: poolInfo.feeTier,
            recipient: this.wallet.address,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        };

        const options = {
            value: amountIn,
            gasLimit: BigInt(500000)
        };

        if (gasPrice) {
            options.gasPrice = gasPrice;
        }

        const tx = await this.edgeRouter.exactInputSingle(
            this.network.addresses.V3.ROUTER,
            params,
            options
        );

        console.log('Transaction Hash:', tx.hash);
        
        // Ensure we always return an object with at least a hash
        return {
            hash: tx.hash,
            wait: async () => {
                try {
                    return await tx.wait();
                } catch (waitError) {
                    console.error('Error waiting for transaction:', waitError);
                    return { hash: tx.hash };
                }
            }
        };
    }

    async executeV3Sell(tokenAddress, amountIn, poolInfo, deadline, gasPrice) {
        console.log('\n=== Executing V3 Sell ===');
        const amountOutMin = BigInt(0);

        const params = {
            tokenIn: tokenAddress,
            tokenOut: this.network.addresses.V3.WETH,
            fee: poolInfo.feeTier,
            recipient: this.wallet.address,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        };

        const options = {
            gasLimit: BigInt(500000)
        };

        if (gasPrice) {
            options.gasPrice = gasPrice;
        }

        const tx = await this.edgeRouter.exactInputSingle(
            this.network.addresses.V3.ROUTER,
            params,
            options
        );

        console.log('Transaction Hash:', tx.hash);
        
        // Ensure we always return an object with at least a hash
        return {
            hash: tx.hash,
            wait: async () => {
                try {
                    return await tx.wait();
                } catch (waitError) {
                    console.error('Error waiting for transaction:', waitError);
                    return { hash: tx.hash };
                }
            }
        };
    }

    async getTokenBalance(tokenAddress) {
        try {
            console.log('\n=== Checking Token Balance ===');
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            
            const [balance, symbol, decimals] = await Promise.all([
                token.balanceOf(this.wallet.address),
                token.symbol().catch(() => 'UNKNOWN'),
                token.decimals().catch(() => 18)
            ]);
            
            console.log('Token Address:', tokenAddress);
            console.log('Symbol:', symbol);
            console.log('Decimals:', decimals);
            console.log('Raw Balance:', balance.toString());
            console.log('Formatted Balance:', ethers.formatUnits(balance, decimals));
            
            return {
                balance,
                symbol,
                decimals,
                formatted: ethers.formatUnits(balance, decimals)
            };
        } catch (error) {
            console.error('Error checking token balance:', error);
            throw error;
        }
    }

    async estimateGas(tokenAddress, amountIn, isV2 = true) {
        try {
            console.log('\n=== Estimating Gas ===');
            const deadline = Math.floor(Date.now() / 1000) + 300;
            
            if (isV2) {
                const path = [this.network.addresses.V2.WETH, tokenAddress];
                const amountOutMin = BigInt(0);
                
                return await this.edgeRouter.estimateGas.swapExactETHForTokensSupportingFeeOnTransferTokens(
                    this.network.addresses.V2.ROUTER,
                    amountOutMin,
                    path,
                    this.wallet.address,
                    deadline,
                    { value: amountIn }
                );
            } else {
                const params = {
                    tokenIn: this.network.addresses.V3.WETH,
                    tokenOut: tokenAddress,
                    fee: 3000,
                    recipient: this.wallet.address,
                    deadline: deadline,
                    amountIn: amountIn,
                    amountOutMinimum: BigInt(0),
                    sqrtPriceLimitX96: 0
                };

                return await this.edgeRouter.estimateGas.exactInputSingle(
                    this.network.addresses.V3.ROUTER,
                    params,
                    { value: amountIn }
                );
            }
        } catch (error) {
            console.error('Error estimating gas:', error);
            throw error;
        }
    }

    async checkAllowance(tokenAddress, amount) {
        try {
            console.log('\n=== Checking Token Allowance ===');
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            
            const allowance = await token.allowance(
                this.wallet.address,
                this.edgeRouter.target
            );
            
            console.log('Current Allowance:', allowance.toString());
            return allowance >= amount;
        } catch (error) {
            console.error('Error checking allowance:', error);
            throw error;
        }
    }

    async approveToken(tokenAddress, amount = ethers.MaxUint256) {
        try {
            console.log('\n=== Approving Token ===');
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            
            const tx = await token.approve(this.edgeRouter.target, amount, {
                gasLimit: BigInt(100000)
            });
            const receipt = await tx.wait();
            
            console.log('Approval Transaction:', receipt.hash);
            return receipt;
        } catch (error) {
            console.error('Error approving token:', error);
            throw error;
        }
    }

    async getTokenInfo(tokenAddress) {
        try {
            console.log('\n=== Getting Token Info ===');
            const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            
            const [name, symbol, decimals, totalSupply] = await Promise.all([
                token.name().catch(() => 'UNKNOWN'),
                token.symbol().catch(() => 'UNKNOWN'),
                token.decimals().catch(() => 18),
                token.totalSupply().catch(() => BigInt(0))
            ]);
            
            return {
                address: tokenAddress,
                name,
                symbol,
                decimals,
                totalSupply,
                formattedSupply: ethers.formatUnits(totalSupply, decimals)
            };
        } catch (error) {
            console.error('Error getting token info:', error);
            throw error;
        }
    }

    async getTokenPrice(tokenAddress, amount = '1') {
        try {
            console.log('\n=== Getting Token Price ===');
            const amountIn = ethers.parseEther(amount);
            
            // Try V3 first
            try {
                const v3Price = await this.tryV3FeeTiers(tokenAddress, amount);
                return {
                    version: 3,
                    amountIn: amountIn,
                    amountOut: v3Price.amountOut,
                    price: ethers.formatEther(v3Price.amountOut)
                };
            } catch (v3Error) {
                console.log('V3 price check failed, trying V2...');
            }

            // Fallback to V2
            const path = [this.network.addresses.V2.WETH, tokenAddress];
            const amounts = await this.routerV2.getAmountsOut(amountIn, path);
            
            return {
                version: 2,
                amountIn: amountIn,
                amountOut: amounts[1],
                price: ethers.formatEther(amounts[1])
            };
        } catch (error) {
            console.error('Error getting token price:', error);
            throw error;
        }
    }
}

module.exports = TradeExecutor;