import { pgSchema, text, timestamp, integer, primaryKey, uuid, jsonb } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const tenantSchema = pgSchema("tenant");

export const organizations = tenantSchema.table("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan", {
    enum: ["trial", "starter", "pro", "business", "enterprise", "suspended"],
  })
    .notNull()
    .default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  branding: jsonb("branding").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = tenantSchema.table(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
  }),
);
