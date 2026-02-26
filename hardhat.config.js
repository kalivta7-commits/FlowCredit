require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      chainId: 1337,
    },
    creditcoinTestnet: {
      url: process.env.CREDITCOIN_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 102030, // Creditcoin testnet chain ID (example, verify actual)
    },
  },
  etherscan: {
    apiKey: {
      creditcoinTestnet: "no-api-key-needed", // Placeholder if not verifying
    },
  },
};