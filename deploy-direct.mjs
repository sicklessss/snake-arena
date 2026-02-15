import { ethers } from "ethers";
import fs from "fs";

const botRegistryArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/BotRegistry.sol/BotRegistry.json", "utf8"));
const rewardDistributorArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/RewardDistributor.sol/RewardDistributor.json", "utf8"));
const pariMutuelArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/SnakeArenaPariMutuel.sol/SnakeArenaPariMutuel.json", "utf8"));

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const wallet = new ethers.Wallet("ce6cf4fe0c9e4073bb5a683041563d35df40bd5e7e2bf86804ec68dd03660e31", provider);

console.log("Deploying contracts with account:", wallet.address);

async function main() {
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  
  // Get current nonce
  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  console.log("Current nonce:", nonce);

  // 1. Deploy BotRegistry
  console.log("\n1. Deploying BotRegistry...");
  const BotRegistryFactory = new ethers.ContractFactory(botRegistryArtifact.abi, botRegistryArtifact.bytecode, wallet);
  const botRegistry = await BotRegistryFactory.deploy({ nonce: nonce });
  await botRegistry.waitForDeployment();
  const botRegistryAddress = await botRegistry.getAddress();
  console.log("✅ BotRegistry deployed to:", botRegistryAddress);

  // 2. Deploy RewardDistributor
  console.log("\n2. Deploying RewardDistributor...");
  const RewardDistributorFactory = new ethers.ContractFactory(rewardDistributorArtifact.abi, rewardDistributorArtifact.bytecode, wallet);
  const rewardDistributor = await RewardDistributorFactory.deploy(botRegistryAddress, { nonce: nonce + 1 });
  await rewardDistributor.waitForDeployment();
  const rewardDistributorAddress = await rewardDistributor.getAddress();
  console.log("✅ RewardDistributor deployed to:", rewardDistributorAddress);

  // 3. Deploy SnakeArenaPariMutuel
  console.log("\n3. Deploying SnakeArenaPariMutuel...");
  const PariMutuelFactory = new ethers.ContractFactory(pariMutuelArtifact.abi, pariMutuelArtifact.bytecode, wallet);
  const pariMutuel = await PariMutuelFactory.deploy(rewardDistributorAddress, { nonce: nonce + 2 });
  await pariMutuel.waitForDeployment();
  const pariMutuelAddress = await pariMutuel.getAddress();
  console.log("✅ SnakeArenaPariMutuel deployed to:", pariMutuelAddress);

  // Save deployment info
  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: wallet.address,
    contracts: {
      BotRegistry: botRegistryAddress,
      RewardDistributor: rewardDistributorAddress,
      SnakeArenaPariMutuel: pariMutuelAddress
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("deployment-new.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\n🎉 Deployment complete! Info saved to deployment-new.json");
  console.log("\nContract Addresses:");
  console.log("===================");
  console.log("BotRegistry:", botRegistryAddress);
  console.log("RewardDistributor:", rewardDistributorAddress);
  console.log("SnakeArenaPariMutuel:", pariMutuelAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
