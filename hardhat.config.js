import "@nomicfoundation/hardhat-ethers";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.19",
  networks: {
    baseSepolia: {
      type: "http",
      url: "https://sepolia.base.org",
      accounts: ["ce6cf4fe0c9e4073bb5a683041563d35df40bd5e7e2bf86804ec68dd03660e31"]
    }
  }
};
