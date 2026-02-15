const solc = require('solc');
const { ethers } = require('ethers');
const fs = require('fs');

// Base Sepolia
const RPC_URL = 'https://sepolia.base.org';
const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployerKey = 'ce6cf4fe0c9e4073bb5a683041563d35df40bd5e7e2bf86804ec68dd03660e31';
const wallet = new ethers.Wallet(deployerKey, provider);

// Owner and oracle addresses
const OWNER_ADDRESS = '0x62dBfcEc94deA8c356284C6B282E13F9bc9E2fcE';
const ORACLE_ADDRESS = '0xfC65695eE542E70820Ab47803Be0D585713bA193'; // deployer as oracle

function compileContract(source, contractName) {
    const input = {
        language: 'Solidity',
        sources: {
            'contract.sol': { content: source }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode']
                }
            },
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        const hasError = output.errors.some(e => e.severity === 'error');
        if (hasError) {
            console.error('Compilation errors:', output.errors);
            throw new Error('Compilation failed');
        }
    }

    const contract = output.contracts['contract.sol'][contractName];
    return {
        abi: contract.abi,
        bytecode: contract.evm.bytecode.object
    };
}

async function deployContract(name, abi, bytecode, ...args) {
    console.log(`\nDeploying ${name}...`);
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`${name} deployed at: ${address}`);
    return { contract, address };
}

async function main() {
    console.log('=== Snake Arena Contract Deployment ===');
    console.log('Deployer:', wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log('Balance:', ethers.formatEther(balance), 'ETH\n');

    // Read sources
    const botRegistrySource = fs.readFileSync('./BotRegistry.sol', 'utf8');
    const rewardDistributorSource = fs.readFileSync('./RewardDistributor.sol', 'utf8');
    const pariMutuelSource = fs.readFileSync('./SnakeArenaPariMutuel.sol', 'utf8');

    // Add OpenZeppelin imports inline (simplified version)
    const ozOwnable = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Context {
    function _msgSender() internal view virtual returns (address) { return msg.sender; }
}

abstract contract Ownable is Context {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor(address initialOwner) { _transferOwnership(initialOwner); }
    function owner() public view virtual returns (address) { return _owner; }
    modifier onlyOwner() { require(owner() == _msgSender(), "Ownable: caller is not the owner"); _; }
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner; _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}`;

    const ozReentrancy = `
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    constructor() { _status = _NOT_ENTERED; }
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED; _;
        _status = _NOT_ENTERED;
    }
}`;

    // Note: In real deployment, use proper imports. For now, this is a simplified version.
    // Due to import complexity, let's create deployment records that will be filled manually
    // or use a proper development environment

    console.log('⚠️  Note: Due to OpenZeppelin import dependencies,');
    console.log('please use Hardhat or Foundry for actual deployment.\n');
    console.log('Creating deployment configuration...\n');

    // Save deployment config for Hardhat
    const deploymentConfig = {
        network: 'base-sepolia',
        deployer: wallet.address,
        owner: OWNER_ADDRESS,
        oracle: ORACLE_ADDRESS,
        contracts: {
            BotRegistry: {
                source: 'BotRegistry.sol',
                constructorArgs: [],
                initialFee: '0.01' // ETH
            },
            RewardDistributor: {
                source: 'RewardDistributor.sol',
                constructorArgs: ['${BotRegistry}'], // placeholder
                minClaim: '0.001' // ETH
            },
            SnakeArenaPariMutuel: {
                source: 'SnakeArenaPariMutuel.sol',
                constructorArgs: ['${RewardDistributor}'], // placeholder
                platformRake: '5%',
                botReward: '5%'
            }
        }
    };

    fs.writeFileSync('./deployment-config.json', JSON.stringify(deploymentConfig, null, 2));
    console.log('Deployment config saved to: deployment-config.json');

    // Also create a simple deployment script for Hardhat
    const hardhatScript = `
const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying from:", deployer.address);

    // Deploy BotRegistry
    const BotRegistry = await ethers.getContractFactory("BotRegistry");
    const botRegistry = await BotRegistry.deploy();
    await botRegistry.waitForDeployment();
    console.log("BotRegistry deployed to:", await botRegistry.getAddress());

    // Deploy RewardDistributor
    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributor = await RewardDistributor.deploy(await botRegistry.getAddress());
    await rewardDistributor.waitForDeployment();
    console.log("RewardDistributor deployed to:", await rewardDistributor.getAddress());

    // Deploy SnakeArenaPariMutuel
    const SnakeArenaPariMutuel = await ethers.getContractFactory("SnakeArenaPariMutuel");
    const pariMutuel = await SnakeArenaPariMutuel.deploy(await rewardDistributor.getAddress());
    await pariMutuel.waitForDeployment();
    console.log("SnakeArenaPariMutuel deployed to:", await pariMutuel.getAddress());

    // Configure
    await botRegistry.transferOwnership("${OWNER_ADDRESS}");
    await pariMutuel.authorizeOracle("${ORACLE_ADDRESS}");
    
    console.log("\\nDeployment complete!");
    console.log("Owner:", "${OWNER_ADDRESS}");
    console.log("Oracle:", "${ORACLE_ADDRESS}");
}

main().catch(console.error);
`;

    fs.writeFileSync('./deploy-hardhat.js', hardhatScript);
    console.log('Hardhat deployment script saved to: deploy-hardhat.js\n');
}

main().catch(console.error);
