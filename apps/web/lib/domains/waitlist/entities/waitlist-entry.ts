import type { Email } from "../value-objects/email";

export interface WaitlistEntryAttributes {
  readonly id: string;
  readonly email: Email;
  readonly organization: string | null;
  readonly source: string | null;
  readonly referrer: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly createdAt: Date;
}

/**
 * Entidad de dominio: una entrada en la waitlist.
 * Inmutable. La construccion va via WaitlistEntry.create() o reconstitute().
 */
export class WaitlistEntry {
  private constructor(private readonly attrs: WaitlistEntryAttributes) {}

  static create(props: Omit<WaitlistEntryAttributes, "id" | "createdAt"> & {
    id?: string;
    createdAt?: Date;
  }): WaitlistEntry {
    return new WaitlistEntry({
      id: props.id ?? crypto.randomUUID(),
      createdAt: props.createdAt ?? new Date(),
      ...props,
    });
  }

  get id(): string {
    return this.attrs.id;
  }
  get email(): Email {
    return this.attrs.email;
  }
  get organization(): string | null {
    return this.attrs.organization;
  }
  get source(): string | null {
    return this.attrs.source;
  }
  get createdAt(): Date {
    return this.attrs.createdAt;
  }

  toPlain(): WaitlistEntryAttributes {
    return { ...this.attrs };
  }
}
