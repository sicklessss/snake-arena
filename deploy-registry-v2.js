// Deploy new BotRegistry v2:
// - setBackendWallet support
// - fixed botExists (uses botId != 0 instead of owner != 0)
// - After deploy: setBackendWallet, setNFTContract, transferOwnership to user wallet
const { ethers } = require('ethers');
const fs = require('fs');

const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
const provider = new ethers.JsonRpcProvider(RPC_URL);
const BACKEND_KEY = '0x3feb90e0fa194ff67a24602d2758bb389faa2aa593047765e8fa408f6ee608a2';
const wallet = new ethers.Wallet(BACKEND_KEY, provider);

const NFT_CONTRACT   = '0xF269b84543041EA350921E3e3A2Da0B14B85453C';
const OWNER_WALLET   = '0xBa379b9AaF5eac6eCF9B532cb6563390De6edfEe'; // user's MetaMask

const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/BotRegistry.sol/BotRegistry.json', 'utf8'));

async function main() {
    console.log('Deployer (backend):', wallet.address);
    console.log('Balance:', ethers.formatEther(await provider.getBalance(wallet.address)), 'ETH');

    let nonce = await provider.getTransactionCount(wallet.address, 'pending');

    // 1. Deploy BotRegistry
    console.log('\n[1] Deploying BotRegistry...');
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const deployTx = await factory.getDeployTransaction();
    const sent = await wallet.sendTransaction({ ...deployTx, nonce: nonce++, gasLimit: 3_000_000 });
    console.log('  tx:', sent.hash);
    const receipt = await sent.wait();
    const registryAddr = receipt.contractAddress;
    console.log('  BotRegistry deployed at:', registryAddr);

    const registry = new ethers.Contract(registryAddr, artifact.abi, wallet);

    // 2. setBackendWallet (backend wallet deploys = is owner, can call this)
    console.log('\n[2] setBackendWallet...');
    const tx2 = await registry.setBackendWallet(wallet.address, { nonce: nonce++, gasLimit: 100_000 });
    await tx2.wait();
    console.log('  done');

    // 3. setNFTContract
    console.log('\n[3] setNFTContract...');
    const tx3 = await registry.setNFTContract(NFT_CONTRACT, { nonce: nonce++, gasLimit: 100_000 });
    await tx3.wait();
    console.log('  done');

    // 4. transferOwnership to user's MetaMask wallet
    console.log('\n[4] transferOwnership to', OWNER_WALLET, '...');
    const tx4 = await registry.transferOwnership(OWNER_WALLET, { nonce: nonce++, gasLimit: 100_000 });
    await tx4.wait();
    console.log('  done');

    console.log('\n=== SUCCESS ===');
    console.log('New BotRegistry:', registryAddr);
    console.log('NFT contract set:', NFT_CONTRACT);
    console.log('Backend wallet:', wallet.address);
    console.log('Owner:', OWNER_WALLET);
    console.log('\nUpdate these files:');
    console.log('  server.js: CONTRACTS.botRegistry =', `'${registryAddr}'`);
    console.log('  contracts.ts: botRegistry:', `'${registryAddr}'`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
