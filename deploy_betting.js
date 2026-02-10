const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const solc = require('solc');
const readline = require('readline');

// Config
const CONTRACT_FILE = 'SnakeArenaBetting.sol';
const NETWORK_RPC = 'https://sepolia.base.org';
const CHAIN_ID = 84532;

async function main() {
    console.log(`Compiling ${CONTRACT_FILE}...`);
    
    const source = fs.readFileSync(path.join(__dirname, CONTRACT_FILE), 'utf8');
    const input = {
        language: 'Solidity',
        sources: {
            [CONTRACT_FILE]: { content: source }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*']
                }
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        let hasError = false;
        output.errors.forEach(err => {
            console.error(err.formattedMessage);
            if (err.severity === 'error') hasError = true;
        });
        if (hasError) process.exit(1);
    }

    const contract = output.contracts[CONTRACT_FILE]['SnakeArenaBetting'];
    const abi = contract.abi;
    const bytecode = contract.evm.bytecode.object;
    
    console.log('Compilation successful!');

    // Get Private Key
    let privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        await new Promise(resolve => {
            rl.question('Enter Private Key (will not be saved): ', (ans) => {
                privateKey = ans.trim();
                rl.close();
                resolve();
            });
        });
    }

    if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;

    const provider = new ethers.JsonRpcProvider(NETWORK_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`Deploying with account: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const deployTx = await factory.deploy();
    
    console.log('Waiting for deployment transaction...');
    await deployTx.waitForDeployment();
    
    const address = await deployTx.getAddress();
    console.log(`\n✅ Contract Deployed to: ${address}`);
    console.log(`View on Blockscout: https://base-sepolia.blockscout.com/address/${address}`);

    // Save deployment info
    const deployInfo = {
        address,
        abi,
        network: 'base-sepolia',
        deployedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(path.join(__dirname, 'deployment.json'), JSON.stringify(deployInfo, null, 2));
    console.log('Deployment info saved to deployment.json');
}

main().catch(console.error);
