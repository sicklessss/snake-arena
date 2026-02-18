import "@nomicfoundation/hardhat-ethers";
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.20",
  networks: {
    baseSepolia: {
      type: "http",
      url: "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};
