import { ConflictError, logger } from "@/lib/domains/shared";
import { Email } from "../value-objects/email";
import { WaitlistEntry } from "../entities/waitlist-entry";
import type { WaitlistRepository } from "../repositories/waitlist-repository";

const log = logger.child("waitlist");

export interface JoinWaitlistInput {
  email: string;
  organization?: string;
  source?: string;
  referrer?: string;
  ipAddress?: string;
  userAgent?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

export interface JoinWaitlistResult {
  entry: WaitlistEntry;
  alreadyExisted: boolean;
}

/**
 * Use case: dar de alta un lead en la waitlist.
 * - Valida el email (via Email value object)
 * - Idempotente: si ya existe (mismo email) devuelve alreadyExisted=true
 * - No falla en duplicado (UX queremos confirmar al usuario igualmente)
 */
export function makeJoinWaitlist(deps: { repo: WaitlistRepository }) {
  return async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
    const email = Email.create(input.email);

    const existing = await deps.repo.findByEmail(email);
    if (existing) {
      log.info("waitlist.duplicate", { email: email.toString() });
      return { entry: existing, alreadyExisted: true };
    }

    const entry = WaitlistEntry.create({
      email,
      organization: input.organization?.trim() || null,
      source: input.source ?? null,
      referrer: input.referrer ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
    });

    await deps.repo.save(entry);
    log.info("waitlist.created", {
      email: email.toString(),
      organization: entry.organization,
      source: entry.source,
    });

    return { entry, alreadyExisted: false };
  };
}
