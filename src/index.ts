import axios from "axios";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";

import * as schema from "../src/drizzle/schema";
import { db } from "./drizzle/db";

const API_BASE_URL = "http://localhost:3000/api/timestamp-holdings";
const BATCH_SIZE = 7; // Process a week at a time
const CONCURRENCY_LIMIT = 3; // Limit concurrent API calls
const USER_BATCH_SIZE = 5; // Process 5 users at a time

async function fetchHoldingsForDateAndUser(
  date: Date,
  userAddr: string
): Promise<schema.XSTRK_HOLDING_TYPE | null> {
  const timestamp = Math.floor(date.getTime() / 1000);
  const url = `${API_BASE_URL}/${userAddr}/${timestamp}`;

  try {
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
    console.error(
      `Error fetching data for user ${userAddr} on date ${date.toISOString().split("T")[0]}: ${error.message}`
    );
    return null;
  }
}

async function processUserHoldings(userAddr: string): Promise<number> {
  console.log(`Processing holdings for user: ${userAddr}`);

  const startDate = new Date("2024-12-26");
  const endDate = new Date();

  // get all dates in the range
  const dates: Date[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // check for existing records
  const existingRecords = await db
    .select({ date: schema.xstrk_holdings.date })
    .from(schema.xstrk_holdings)
    .where(eq(schema.xstrk_holdings.userAddress, userAddr));

  const existingDates = new Set(existingRecords.map((record) => record.date));
  const datesToProcess: Date[] = dates.filter(
    (date) => !existingDates.has(date.toISOString().split("T")[0])
  );

  console.log(
    `Processing ${datesToProcess.length} new dates out of ${dates.length} total dates for user ${userAddr}`
  );

  if (datesToProcess.length === 0) {
    return 0;
  }

  const limit = pLimit(CONCURRENCY_LIMIT);
  let totalInserted = 0;

  for (let i = 0; i < datesToProcess.length; i += BATCH_SIZE) {
    const batch = datesToProcess.slice(i, i + BATCH_SIZE);

    // process batch concurrently with rate limiting
    const results = await Promise.all(
      batch.map((date) =>
        limit(() => fetchHoldingsForDateAndUser(date, userAddr))
      )
    );

    // filter out null results and insert valid data
    const validResults: any = results.filter(Boolean);

    if (validResults.length > 0) {
      await db.insert(schema.xstrk_holdings).values(validResults);
      totalInserted += validResults.length;

      console.log(
        `Inserted ${validResults.length} records for user ${userAddr} batch ${i / BATCH_SIZE + 1}`
      );
    }

    // add a delay between batches
    if (i + BATCH_SIZE < datesToProcess.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return totalInserted;
}

async function fetchAndStoreHoldingsForAllUsers() {
  const allUsers = await db
    .select({ userAddress: schema.users.userAddress })
    .from(schema.users)
    .groupBy(schema.users.userAddress);

  console.log(`Found ${allUsers.length} users to process`);

  let totalRecordsInserted = 0;

  // process users in batches
  for (let i = 0; i < allUsers.length; i += USER_BATCH_SIZE) {
    const userBatch = allUsers.slice(i, i + USER_BATCH_SIZE);
    console.log(
      `Processing user batch ${i / USER_BATCH_SIZE + 1} of ${Math.ceil(allUsers.length / USER_BATCH_SIZE)}`
    );

    const results = await Promise.all(
      userBatch.map((user) => processUserHoldings(user.userAddress))
    );

    const batchInserted = results.reduce((sum, count) => sum + count, 0);
    totalRecordsInserted += batchInserted;

    console.log(
      `Completed user batch ${i / USER_BATCH_SIZE + 1}, inserted ${batchInserted} records`
    );

    // add delay between user batches
    if (i + USER_BATCH_SIZE < allUsers.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(
    `Data fetching and storage complete. Total records inserted: ${totalRecordsInserted}`
  );
}

fetchAndStoreHoldingsForAllUsers().catch((error) => {
  console.error("Fatal error during processing:", error);
  process.exit(1);
});
