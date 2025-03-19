import { defineIndexer } from "@apibara/indexer";
import { useLogger } from "@apibara/indexer/plugins";
import { drizzleStorage } from "@apibara/plugin-drizzle";
import { StarknetStream } from "@apibara/starknet";
import type { ApibaraRuntimeConfig } from "apibara/types";
import type {
  ExtractTablesWithRelations,
  TablesRelationalConfig,
} from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { hash } from "starknet";

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
        const userAddress = standardise(event.keys[2]);

        // check if this user address already exists in the database
        const existingUser = await database
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.userAddress, userAddress))
          .limit(1)
          .execute();

        // skip this record if it's a duplicate
        if (existingUser.length > 0) {
          logger.info(
            `Starknet: Skipping existing user address: ${userAddress}`
          );
          continue;
        }

        const record: schema.UserType = {
          userAddress,
          blockNumber: Number(header.blockNumber),
          txIndex: event.transactionIndex as number,
          eventIndex: event.eventIndex as number,
          txHash: event.transactionHash,
          timestamp: Math.round(header.timestamp.getTime() / 1000),
          cursor: BigInt(header.blockNumber),
        };

        logger.info(`Starknet: Adding new user address: ${userAddress}`);

        records.push(record);
      }

      if (records.length) {
        logger.info(
          `Starknet: Inserting ${records.length} new user records...`
        );

        const result = await database
          .insert(schema.users)
          .values(records)
          .execute();

        logger.info(
          `Starknet: Successfully inserted ${records.length} new users!`
        );
        logger.info(result);
      } else {
        logger.info("Starknet: No new users to insert");
      }
    },
  });
}
