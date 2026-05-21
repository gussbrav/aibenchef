import { ValidationError } from "@/lib/domains/shared";

/**
 * Email value object. Inmutable, validado en construccion.
 */
export class Email {
  private constructor(private readonly value: string) {}

  static create(raw: string): Email {
    const trimmed = raw.trim().toLowerCase();
    if (!Email.regex.test(trimmed)) {
      throw new ValidationError("Email invalido", { input: raw });
    }
    return new Email(trimmed);
  }

  static tryCreate(raw: string): Email | null {
    const trimmed = raw.trim().toLowerCase();
    return Email.regex.test(trimmed) ? new Email(trimmed) : null;
  }

  toString(): string {
    return this.value;
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  // RFC 5322 simplificado — suficiente para captura de leads.
  private static readonly regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
}
