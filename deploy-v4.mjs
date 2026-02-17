import { ethers } from "ethers";
import fs from "fs";

const botRegistryArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/BotRegistry.sol/BotRegistry.json", "utf8"));
const rewardDistributorArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/RewardDistributor.sol/RewardDistributor.json", "utf8"));
const pariMutuelArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/SnakeArenaPariMutuel.sol/SnakeArenaPariMutuel.json", "utf8"));
const nftArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/SnakeBotNFT.sol/SnakeBotNFT.json", "utf8"));
const referralArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/ReferralRewards.sol/ReferralRewards.json", "utf8"));

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const wallet = new ethers.Wallet("5461d8065407507f314c733211cf5948398229e85c9e0d608180d00ad92e9602", provider);

console.log("Deploying contracts with account:", wallet.address);

async function main() {
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  
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

  // 4. Deploy SnakeBotNFT
  console.log("\n4. Deploying SnakeBotNFT...");
  const NFTFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, wallet);
  const nft = await NFTFactory.deploy({ nonce: nonce + 3 });
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("✅ SnakeBotNFT deployed to:", nftAddress);

  // 5. Deploy ReferralRewards
  console.log("\n5. Deploying ReferralRewards...");
  const ReferralFactory = new ethers.ContractFactory(referralArtifact.abi, referralArtifact.bytecode, wallet);
  const referral = await ReferralFactory.deploy(wallet.address, { nonce: nonce + 4 });
  await referral.waitForDeployment();
  const referralAddress = await referral.getAddress();
  console.log("✅ ReferralRewards deployed to:", referralAddress);

  // 6. Set NFT contract in BotRegistry
  console.log("\n6. Setting NFT contract in BotRegistry...");
  const tx1 = await botRegistry.setNFTContract(nftAddress, { nonce: nonce + 5 });
  await tx1.wait();
  console.log("✅ NFT contract set in BotRegistry");

  // 7. Set Referral contract in BotRegistry
  console.log("\n7. Setting Referral contract in BotRegistry...");
  const tx2 = await botRegistry.setReferralContract(referralAddress, { nonce: nonce + 6 });
  await tx2.wait();
  console.log("✅ Referral contract set in BotRegistry");

  // 8. Fund referral contract with 0.1 ETH
  console.log("\n8. Funding ReferralRewards contract...");
  const tx3 = await wallet.sendTransaction({
    to: referralAddress,
    value: ethers.parseEther("0.1"),
    nonce: nonce + 7
  });
  await tx3.wait();
  console.log("✅ Funded ReferralRewards with 0.1 ETH");

  // Save deployment info
  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: wallet.address,
    contracts: {
      BotRegistry: botRegistryAddress,
      RewardDistributor: rewardDistributorAddress,
      SnakeArenaPariMutuel: pariMutuelAddress,
      SnakeBotNFT: nftAddress,
      ReferralRewards: referralAddress
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("deployment-v4.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\n🎉 Deployment complete! Info saved to deployment-v4.json");
  console.log("\nContract Addresses:");
  console.log("BotRegistry:", botRegistryAddress);
  console.log("RewardDistributor:", rewardDistributorAddress);
  console.log("SnakeArenaPariMutuel:", pariMutuelAddress);
  console.log("SnakeBotNFT:", nftAddress);
  console.log("ReferralRewards:", referralAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
