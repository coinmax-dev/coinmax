require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.27",
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
      },
      {
        version: "0.8.20",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  paths: {
    sources: "./src",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    // ─── Mainnets ─────────────────────────────────────────────
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
      chainId: 56,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
    arbitrum: {
      url: process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
    // ─── Testnets ─────────────────────────────────────────────
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
    arbitrumSepolia: {
      url: process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
  },
};
