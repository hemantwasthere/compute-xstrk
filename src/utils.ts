import dotenv from "dotenv";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { num, RpcProvider } from "starknet";

import * as schema from "./drizzle/schema";

dotenv.config();

export function getProvider() {
  const env = dotenv.config();
  const rpcUrl =
    env.parsed?.RPC_URL || "https://starknet-mainnet.public.blastapi.io";

  return new RpcProvider({
    nodeUrl: rpcUrl,
    blockIdentifier: "pending",
  });
}

export function getDB(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: connectionString,
  });
  return drizzle(pool, { schema });
}

export function standardise(address: string | bigint) {
  let _a = address;
  if (!address) {
    _a = "0";
  }
  const a = num.getHexString(num.getDecimalString(_a.toString()));
  return a;
}

// Types for the result object with discriminated union
type Success<T> = {
  data: T;
  error: null;
};

type Failure<E> = {
  data: null;
  error: E;
};

type Result<T, E = Error> = Success<T> | Failure<E>;

export async function tryCatch<T, E = Error>(
  promise: Promise<T>
): Promise<Result<T, E>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as E };
  }
}
