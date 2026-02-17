import { ethers } from "ethers";
import fs from "fs";

const referralArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/ReferralRewards.sol/ReferralRewards.json", "utf8"));

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const wallet = new ethers.Wallet("5461d8065407507f314c733211cf5948398229e85c9e0d608180d00ad92e9602", provider);

console.log("Deploying ReferralRewards with account:", wallet.address);

async function main() {
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  
  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  console.log("Current nonce:", nonce);

  // Deploy ReferralRewards only
  console.log("\nDeploying ReferralRewards...");
  const ReferralFactory = new ethers.ContractFactory(referralArtifact.abi, referralArtifact.bytecode, wallet);
  const referral = await ReferralFactory.deploy(wallet.address, { nonce: nonce });
  await referral.waitForDeployment();
  const referralAddress = await referral.getAddress();
  console.log("✅ ReferralRewards deployed to:", referralAddress);
  
  // Fund with 0.1 ETH
  console.log("\nFunding ReferralRewards...");
  const tx = await wallet.sendTransaction({
    to: referralAddress,
    value: ethers.parseEther("0.05"),
    nonce: nonce + 1
  });
  await tx.wait();
  console.log("✅ Funded with 0.05 ETH");

  // Save deployment info
  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: wallet.address,
    contracts: {
      ReferralRewards: referralAddress
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("deployment-referral.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\n🎉 ReferralRewards deployed!");
  console.log("Address:", referralAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
