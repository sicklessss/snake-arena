const ethers = require('ethers');

// Config
const NETWORK_RPC = 'https://sepolia.base.org';
const RECIPIENT = '0x62dBfcEc94deA8c356284C6B282E13F9bc9E2fcE';
const AMOUNT = '0.005'; // Transfer amount

// Private Key (from previous context)
const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function main() {
    if (!PRIVATE_KEY) {
        console.error('Please provide PRIVATE_KEY env var');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(NETWORK_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Sender: ${wallet.address}`);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther(AMOUNT)) {
        console.error('Insufficient balance');
        process.exit(1);
    }

    console.log(`Sending ${AMOUNT} ETH to ${RECIPIENT}...`);

    const tx = await wallet.sendTransaction({
        to: RECIPIENT,
        value: ethers.parseEther(AMOUNT)
    });

    console.log(`Transaction sent! Hash: ${tx.hash}`);
    console.log('Waiting for confirmation...');
    
    await tx.wait();
    
    console.log('✅ Transfer confirmed!');
    console.log(`View on Blockscout: https://base-sepolia.blockscout.com/tx/${tx.hash}`);
}

main().catch(console.error);
