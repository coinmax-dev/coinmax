require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./src",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    bsc: {
      url: "https://bsc-dataseed1.binance.org",
      chainId: 56,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
    },
  },
};
