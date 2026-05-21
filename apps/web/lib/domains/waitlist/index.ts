/**
 * Public API del dominio waitlist.
 * Solo se exporta lo que otros modulos necesitan consumir.
 */

export { Email } from "./value-objects/email";
export { WaitlistEntry } from "./entities/waitlist-entry";
export type { WaitlistRepository } from "./repositories/waitlist-repository";
export { DrizzleWaitlistRepository } from "./repositories/drizzle-waitlist-repository";
export {
  makeJoinWaitlist,
  type JoinWaitlistInput,
  type JoinWaitlistResult,
} from "./services/join-waitlist";
