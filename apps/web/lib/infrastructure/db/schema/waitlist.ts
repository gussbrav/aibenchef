import { pgSchema, text, timestamp, uuid, inet, jsonb } from "drizzle-orm/pg-core";

export const waitlistSchema = pgSchema("waitlist");

export const waitlistEntries = waitlistSchema.table("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  organization: text("organization"),
  source: text("source"),
  referrer: text("referrer"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaitlistEntryRow = typeof waitlistEntries.$inferSelect;
export type NewWaitlistEntry = typeof waitlistEntries.$inferInsert;
