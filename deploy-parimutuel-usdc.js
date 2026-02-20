const { ethers } = require('ethers');
const fs = require('fs');

const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
const provider = new ethers.JsonRpcProvider(RPC_URL);
const BACKEND_KEY = process.env.BACKEND_PRIVATE_KEY;
const wallet = new ethers.Wallet(BACKEND_KEY, provider);

const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const OWNER_WALLET = '0xBa379b9AaF5eac6eCF9B532cb6563390De6edfEe'; // user MetaMask

const artifact = JSON.parse(
  fs.readFileSync('./artifacts/contracts/SnakeArenaPariMutuel.sol/SnakeArenaPariMutuel.json', 'utf8')
);

async function main() {
  console.log('Deployer:', wallet.address);
  console.log('Balance:', ethers.formatEther(await provider.getBalance(wallet.address)), 'ETH');

  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  // 1. Deploy SnakeArenaPariMutuel(usdc)
  console.log('\n[1] Deploying SnakeArenaPariMutuel (USDC)...');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(USDC_ADDRESS);
  const sent = await wallet.sendTransaction({ ...deployTx, nonce: nonce++, gasLimit: 5_000_000 });
  console.log('  Deploy tx:', sent.hash);
  const receipt = await sent.wait();
  const addr = receipt.contractAddress;
  console.log('  SnakeArenaPariMutuel (USDC) deployed at:', addr);

  const contract = new ethers.Contract(addr, artifact.abi, wallet);

  // 2. Authorize oracle (backend wallet is oracle for settle/create)
  console.log('\n[2] authorizeOracle (backend wallet)...');
  const tx2 = await contract.authorizeOracle(wallet.address, { nonce: nonce++, gasLimit: 100_000 });
  await tx2.wait();
  console.log('  Oracle authorized:', wallet.address);

  // 3. Transfer ownership to user wallet
  console.log('\n[3] transferOwnership to', OWNER_WALLET, '...');
  const tx3 = await contract.transferOwnership(OWNER_WALLET, { nonce: nonce++, gasLimit: 100_000 });
  await tx3.wait();
  console.log('  Ownership transferred to:', OWNER_WALLET);

  console.log('\n=== SUCCESS ===');
  console.log('\nUpdate these files:');
  console.log(`  server.js  CONTRACTS.pariMutuel: '${addr}'`);
  console.log(`  contracts.ts pariMutuel: '${addr}'`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
