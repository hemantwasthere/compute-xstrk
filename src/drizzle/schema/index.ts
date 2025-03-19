import { bigint, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  userAddress: text("user_address").notNull(),
  blockNumber: integer("block_number").notNull(),
  txIndex: integer("tx_index").notNull(),
  eventIndex: integer("event_index").notNull(),
  txHash: text("tx_hash").notNull(),
  timestamp: integer("timestamp").notNull(),
  cursor: bigint("_cursor", { mode: "bigint" }),
});

export const xstrk_holdings = pgTable("xstrk_holdings", {
  id: serial("id").primaryKey(),
  userAddress: text("user_address").notNull(),
  blockNumber: integer("block_number").notNull(),
  vesuAmount: text("vesu_amount").notNull(),
  ekuboAmount: text("ekubo_amount").notNull(),
  nostraLendingAmount: text("nostra_lending_amount").notNull(),
  nostraDexAmount: text("nostra_dex_amount").notNull(),
  walletAmount: text("wallet_amount").notNull(),
  totalAmount: text("total_amount").notNull(),
  date: text("date").notNull(),
  timestamp: integer("timestamp").notNull(),
});

export type UserType = Omit<typeof users.$inferSelect, "id">;
export type XSTRK_HOLDING_TYPE = Omit<typeof xstrk_holdings.$inferSelect, "id">;
