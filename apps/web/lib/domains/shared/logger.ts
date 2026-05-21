/**
 * Logger estructurado JSON.
 *
 * Output: 1 linea JSON por log -> compatible con Loki/Grafana, glitchtip,
 * y cualquier parser que lea logs estandar.
 *
 * Uso:
 *   import { logger } from "@/lib/domains/shared";
 *   const log = logger.child("auth");
 *   log.info("signin attempt", { email });
 *   log.error("signin failed", { reason: "wrong_password", err });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface BaseFields {
  service?: string;
  domain?: string;
  [key: string]: unknown;
}

interface LogEntry extends BaseFields {
  level: LogLevel;
  msg: string;
  ts: string;
  ctx?: Record<string, unknown>;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentMinLevel(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[lvl] ?? LEVELS.info;
}

export class Logger {
  constructor(private readonly base: BaseFields = {}) {}

  child(domain: string, extra: BaseFields = {}): Logger {
    return new Logger({ ...this.base, ...extra, domain });
  }

  private emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVELS[level] < currentMinLevel()) return;
    const entry: LogEntry = {
      ...this.base,
      level,
      msg,
      ts: new Date().toISOString(),
      ...(ctx ? { ctx } : {}),
    };
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    sink(JSON.stringify(entry));
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("debug", msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("info", msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("warn", msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("error", msg, ctx);
  }
}

export const logger = new Logger({ service: "aibenchef-web" });
