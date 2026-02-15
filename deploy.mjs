import hre from "hardhat";

async function main() {
  // Get signers using Hardhat 3.x API
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy BotRegistry
  console.log("\n1. Deploying BotRegistry...");
  const BotRegistry = await hre.ethers.getContractFactory("BotRegistry", deployer);
  const botRegistry = await BotRegistry.deploy();
  await botRegistry.waitForDeployment();
  const botRegistryAddress = await botRegistry.getAddress();
  console.log("BotRegistry deployed to:", botRegistryAddress);

  // 2. Deploy RewardDistributor
  console.log("\n2. Deploying RewardDistributor...");
  const RewardDistributor = await hre.ethers.getContractFactory("RewardDistributor", deployer);
  const rewardDistributor = await RewardDistributor.deploy(botRegistryAddress);
  await rewardDistributor.waitForDeployment();
  const rewardDistributorAddress = await rewardDistributor.getAddress();
  console.log("RewardDistributor deployed to:", rewardDistributorAddress);

  // 3. Deploy SnakeArenaPariMutuel
  console.log("\n3. Deploying SnakeArenaPariMutuel...");
  const SnakeArenaPariMutuel = await hre.ethers.getContractFactory("SnakeArenaPariMutuel", deployer);
  const pariMutuel = await SnakeArenaPariMutuel.deploy(rewardDistributorAddress);
  await pariMutuel.waitForDeployment();
  const pariMutuelAddress = await pariMutuel.getAddress();
  console.log("SnakeArenaPariMutuel deployed to:", pariMutuelAddress);

  // 4. Transfer RewardDistributor ownership to PariMutuel
  console.log("\n4. Setting up permissions...");
  await (await rewardDistributor.transferOwnership(pariMutuelAddress)).wait();
  console.log("RewardDistributor ownership transferred to PariMutuel");

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: Number(await hre.network.provider.send("eth_chainId")),
    deployer: deployer.address,
    contracts: {
      BotRegistry: botRegistryAddress,
      RewardDistributor: rewardDistributorAddress,
      SnakeArenaPariMutuel: pariMutuelAddress
    },
    timestamp: new Date().toISOString()
  };

  const fs = await import("fs");
  fs.writeFileSync("deployment-new.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\n✅ Deployment complete! Info saved to deployment-new.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
