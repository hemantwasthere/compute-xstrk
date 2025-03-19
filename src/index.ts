import axios from "axios";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";

import * as schema from "../src/drizzle/schema";
import { db } from "./drizzle/db";

const API_BASE_URL = "http://localhost:3000/api/timestamp-holdings";
const DB_BATCH_SIZE = 100; // no of records to insert at once
const GLOBAL_CONCURRENCY_LIMIT = 5; // total concurrent API calls allowed
const MAX_RETRIES = 3; // max number of retry attempts
const RETRY_DELAY = 5000; // 5 seconds delay between retries

const globalLimit = pLimit(GLOBAL_CONCURRENCY_LIMIT);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHoldingsWithRetry(
  userAddr: string,
  date: Date
): Promise<schema.XSTRK_HOLDING_TYPE | null> {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      const timestamp = Math.floor(date.getTime() / 1000);
      const url = `${API_BASE_URL}/${userAddr}/${timestamp}`;

      const response = await axios.get(url);
      const data = response.data;

      if (!data.blocks || !data.blocks[0]) {
        console.warn(
          `Invalid data format for user ${userAddr} on date: ${date.toISOString().split("T")[0]}`
        );
        return null;
      }

      const vesuAmount = Number(
        data.vesu[0].xSTRKAmount.bigNumber /
          10 ** data.vesu[0].xSTRKAmount.decimals
      );
      const ekuboAmount = Number(
        data.ekubo[0].xSTRKAmount.bigNumber /
          10 ** data.ekubo[0].xSTRKAmount.decimals
      );
      const nostraLendingAmount = Number(
        data.nostraLending[0].xSTRKAmount.bigNumber /
          10 ** data.nostraLending[0].xSTRKAmount.decimals
      );
      const nostraDexAmount = Number(
        data.nostraDex[0].xSTRKAmount.bigNumber /
          10 ** data.nostraDex[0].xSTRKAmount.decimals
      );
      const walletAmount = Number(
        data.wallet[0].xSTRKAmount.bigNumber /
          10 ** data.wallet[0].xSTRKAmount.decimals
      );
      const totalAmount =
        vesuAmount +
        ekuboAmount +
        nostraLendingAmount +
        nostraDexAmount +
        walletAmount;

      return {
        userAddress: userAddr,
        blockNumber: Number(data.blocks[0].block),
        vesuAmount: vesuAmount.toString(),
        ekuboAmount: ekuboAmount.toString(),
        nostraLendingAmount: nostraLendingAmount.toString(),
        nostraDexAmount: nostraDexAmount.toString(),
        walletAmount: walletAmount.toString(),
        totalAmount: totalAmount.toString(),
        date: date.toISOString().split("T")[0],
        timestamp: timestamp,
      };
    } catch (error) {
      retries++;
      if (retries >= MAX_RETRIES) {
        console.error(
          `Failed after ${MAX_RETRIES} attempts for user ${userAddr} on date ${date.toISOString().split("T")[0]}: ${error.message}`
        );
        return null;
      }
      console.warn(
        `Attempt ${retries}/${MAX_RETRIES} failed for user ${userAddr} on date ${date.toISOString().split("T")[0]}: ${error.message}. Retrying in ${RETRY_DELAY / 1000}s...`
      );
      await sleep(RETRY_DELAY);
    }
  }

  return null;
}

async function getAllTasks(): Promise<[string, Date][]> {
  const allUsers = await db
    .select({ userAddress: schema.users.userAddress })
    .from(schema.users)
    .groupBy(schema.users.userAddress);

  console.log(`Found ${allUsers.length} users to process`);

  const startDate = new Date("2024-12-26");
  const endDate = new Date();

  const allTasks: [string, Date][] = [];

  for (const user of allUsers) {
    const existingRecords = await db
      .select({ date: schema.xstrk_holdings.date })
      .from(schema.xstrk_holdings)
      .where(eq(schema.xstrk_holdings.userAddress, user.userAddress));

    const existingDates = new Set(existingRecords.map((record) => record.date));

    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateString = currentDate.toISOString().split("T")[0];

      if (!existingDates.has(dateString)) {
        allTasks.push([user.userAddress, new Date(currentDate)]);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  console.log(`Total tasks to process: ${allTasks.length}`);
  return allTasks;
}

async function processTaskBatch(tasks: [string, Date][]): Promise<number> {
  const results = await Promise.all(
    tasks.map(([userAddr, date]) =>
      globalLimit(() => fetchHoldingsWithRetry(userAddr, date))
    )
  );

  // filter out null results
  const validResults: any = results.filter(Boolean);

  if (validResults.length > 0) {
    await db.insert(schema.xstrk_holdings).values(validResults);
    console.log(`Inserted ${validResults.length} records in batch`);
    return validResults.length;
  }

  return 0;
}

async function fetchAndStoreHoldings() {
  const allTasks = await getAllTasks();

  if (allTasks.length === 0) {
    console.log("No tasks to process.");
    return;
  }

  let totalInserted = 0;

  for (let i = 0; i < allTasks.length; i += DB_BATCH_SIZE) {
    const taskBatch = allTasks.slice(i, i + DB_BATCH_SIZE);

    console.log(
      `Processing batch ${Math.floor(i / DB_BATCH_SIZE) + 1}/${Math.ceil(allTasks.length / DB_BATCH_SIZE)}`
    );

    const inserted = await processTaskBatch(taskBatch);
    totalInserted += inserted;

    // add small delay between batches
    if (i + DB_BATCH_SIZE < allTasks.length) {
      await sleep(500);
    }
  }

  console.log(
    `Data fetching and storage complete. Total records inserted: ${totalInserted}`
  );
}

fetchAndStoreHoldings().catch((error) => {
  console.error("Fatal error during processing:", error);
  process.exit(1);
});
