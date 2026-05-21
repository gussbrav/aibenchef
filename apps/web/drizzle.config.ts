import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/infrastructure/db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  schemaFilter: ["auth", "tenant", "billing", "audit"],
} satisfies Config;
