const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy BotRegistry
  const BotRegistry = await hre.ethers.getContractFactory("BotRegistry");
  const botRegistry = await BotRegistry.deploy();
  await botRegistry.waitForDeployment();
  console.log("BotRegistry deployed to:", await botRegistry.getAddress());

  // 2. Deploy RewardDistributor
  const RewardDistributor = await hre.ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(await botRegistry.getAddress());
  await rewardDistributor.waitForDeployment();
  console.log("RewardDistributor deployed to:", await rewardDistributor.getAddress());

  // 3. Deploy SnakeArenaPariMutuel
  const SnakeArenaPariMutuel = await hre.ethers.getContractFactory("SnakeArenaPariMutuel");
  const pariMutuel = await SnakeArenaPariMutuel.deploy(await rewardDistributor.getAddress());
  await pariMutuel.waitForDeployment();
  console.log("SnakeArenaPariMutuel deployed to:", await pariMutuel.getAddress());

  // 4. Authorize pariMutuel to call rewardDistributor
  await rewardDistributor.transferOwnership(await pariMutuel.getAddress());
  console.log("RewardDistributor ownership transferred to PariMutuel");

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: Number(await hre.network.provider.send("eth_chainId")),
    deployer: deployer.address,
    contracts: {
      BotRegistry: await botRegistry.getAddress(),
      RewardDistributor: await rewardDistributor.getAddress(),
      SnakeArenaPariMutuel: await pariMutuel.getAddress()
    },
    timestamp: new Date().toISOString()
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployment-new.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-new.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
