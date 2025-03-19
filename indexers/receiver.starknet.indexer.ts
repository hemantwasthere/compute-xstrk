import { defineIndexer } from "@apibara/indexer";
import { StarknetStream } from "@apibara/starknet";

import { useLogger } from "@apibara/indexer/plugins";
import { drizzleStorage } from "@apibara/plugin-drizzle";
import type { ApibaraRuntimeConfig } from "apibara/types";
import type {
  ExtractTablesWithRelations,
  TablesRelationalConfig,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { hash, transaction } from "starknet";

import * as schema from "../src/drizzle/schema";
import { getDB, standardise } from "../src/utils";

export default function (runtimeConfig: ApibaraRuntimeConfig) {
  return createIndexer({
    database: getDB(process.env.DATABASE_URL!),
    config: runtimeConfig,
  });
}

export function createIndexer<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends
    TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
>({
  database,
  config,
}: {
  database: PgDatabase<TQueryResult, TFullSchema, TSchema>;
  config: ApibaraRuntimeConfig;
}) {
  return defineIndexer(StarknetStream)({
    streamUrl: config.streamUrl as string,
    finality: "accepted",
    startingBlock: BigInt(config.startingBlock as string),
    plugins: [
      drizzleStorage({
        db: database,
        idColumn: "event_id",
        persistState: true,
        indexerName: "starknet-receiver",
      }),
    ],
    filter: {
      events: [
        {
          address: config.contractAddress as `0x${string}`,
          keys: [hash.getSelectorFromName("Transfer") as `0x${string}`],
          // includeReceipt: false,
        },
      ],
    },
    async transform({ endCursor, block, context, finality }) {
      const logger = useLogger();

      const { events, header } = block;

      console.log(events, "events-----------------");

      if (!header.blockNumber) {
        return;
      }

      logger.info(
        "Transforming block | orderKey: ",
        endCursor?.orderKey,
        " | finality: ",
        finality
      );

      const records: schema.UserType[] = [];

      for (const event of events) {
        const record: schema.UserType = {
          userAddress: standardise(event.keys[2]),
          blockNumber: Number(header.blockNumber),
          txIndex: event.transactionIndex as number,
          eventIndex: event.eventIndex as number,
          txHash: event.transactionHash,
          timestamp: Math.round(header.timestamp.getTime() / 1000),
          cursor: BigInt(header.blockNumber),
        };

        logger.info(
          `Starknet: Saving record of event index: ${record.eventIndex} ...`
        );
        records.push(record);
      }

      if (records.length) {
        logger.info(
          `Starknet: Inserting ${JSON.stringify(records.length)} records...`
        );
        logger.info(
          await database.insert(schema.users).values(records).execute()
        );
        logger.info(
          `Starknet: Inserted ${JSON.stringify(records.length)} records !`
        );
      }
    },
  });
}
