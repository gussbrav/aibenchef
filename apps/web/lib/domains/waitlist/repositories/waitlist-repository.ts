import type { Email } from "../value-objects/email";
import type { WaitlistEntry } from "../entities/waitlist-entry";

/**
 * Interface del repositorio waitlist. La implementacion concreta vive en
 * drizzle-waitlist-repository.ts. El service depende de esta abstraccion (DIP).
 */
export interface WaitlistRepository {
  findByEmail(email: Email): Promise<WaitlistEntry | null>;
  save(entry: WaitlistEntry): Promise<void>;
  count(): Promise<number>;
}
