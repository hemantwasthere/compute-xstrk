import { defineConfig } from "apibara/config";

import {
  XSTRK_CONTRACT_ADDRESS,
  XSTRK_TOKEN_MAINNET_DEPLOYMENT_BLOCK,
} from "./src/constants";

export default defineConfig({
  runtimeConfig: {
    streamUrl: "https://starknet.preview.apibara.org",
    contractAddress: XSTRK_CONTRACT_ADDRESS, // receiver
    startingBlock: XSTRK_TOKEN_MAINNET_DEPLOYMENT_BLOCK,
  },
  presets: {
    sepolia_starknet: {
      runtimeConfig: {
        streamUrl: "https://starknet.preview.apibara.org",
        contractAddress: XSTRK_CONTRACT_ADDRESS, // receiver
        startingBlock: XSTRK_TOKEN_MAINNET_DEPLOYMENT_BLOCK,
      },
    },
  },
});
