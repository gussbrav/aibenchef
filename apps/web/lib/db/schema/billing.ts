import { pgSchema, text, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenant";

export const billingSchema = pgSchema("billing");

export const subscriptions = billingSchema.table("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  status: text("status").notNull(),
  plan: text("plan").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entitlements = billingSchema.table("entitlements", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  gruposAcceso: text("grupos_acceso").array().notNull().default(["cmac"]),
  topicosAcceso: text("topicos_acceso").array().notNull().default(["eeff"]),
  mesesHistorico: integer("meses_historico").notNull().default(6),
  maxUsers: integer("max_users").notNull().default(1),
  exportPdf: boolean("export_pdf").notNull().default(false),
  exportExcel: boolean("export_excel").notNull().default(false),
  apiEnabled: boolean("api_enabled").notNull().default(false),
  apiQuotaMonthly: integer("api_quota_monthly"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
