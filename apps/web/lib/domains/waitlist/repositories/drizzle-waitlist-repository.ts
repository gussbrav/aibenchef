import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { waitlistEntries } from "@/lib/infrastructure/db/schema";
import { Email } from "../value-objects/email";
import { WaitlistEntry } from "../entities/waitlist-entry";
import type { WaitlistRepository } from "./waitlist-repository";

export class DrizzleWaitlistRepository implements WaitlistRepository {
  async findByEmail(email: Email): Promise<WaitlistEntry | null> {
    const rows = await db
      .select()
      .from(waitlistEntries)
      .where(sql`lower(${waitlistEntries.email}) = ${email.toString()}`)
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return WaitlistEntry.create({
      id: row.id,
      email: Email.create(row.email),
      organization: row.organization,
      source: row.source,
      referrer: row.referrer,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      createdAt: row.createdAt,
    });
  }

  async save(entry: WaitlistEntry): Promise<void> {
    const plain = entry.toPlain();
    await db
      .insert(waitlistEntries)
      .values({
        id: plain.id,
        email: plain.email.toString(),
        organization: plain.organization,
        source: plain.source,
        referrer: plain.referrer,
        ipAddress: plain.ipAddress,
        userAgent: plain.userAgent,
        utmSource: plain.utmSource,
        utmMedium: plain.utmMedium,
        utmCampaign: plain.utmCampaign,
        createdAt: plain.createdAt,
      })
      .onConflictDoNothing();
  }

  async count(): Promise<number> {
    const result = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM waitlist.entries`,
    );
    return result[0]?.count ?? 0;
  }
}
