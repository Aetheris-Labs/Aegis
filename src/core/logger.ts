import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: unknown;
}

const AUDIT_DIR = "./logs";
const AUDIT_FILE = join(AUDIT_DIR, "audit-trail.jsonl");

function ensureLogDir() {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

function writeAuditEntry(entry: LogEntry) {
  ensureLogDir();
  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // non-fatal
  }
}

function colorize(level: LogLevel, text: string): string {
  const colors: Record<LogLevel, string> = {
    info: "\x1b[36m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    debug: "\x1b[90m",
  };
  return `${colors[level]}${text}\x1b[0m`;
}

export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, data?: unknown) => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component,
      message,
      data,
    };

    // Console output
    const prefix = colorize(level, `[${level.toUpperCase()}]`);
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    console.log(`${entry.ts} ${prefix} [${component}] ${message}${dataStr}`);

    // JSONL audit trail — debug excluded; warn/error always written regardless of log level filter
    if (level !== "debug") {
      writeAuditEntry(entry);
    }
  };

  return {
    info: (message: string, data?: unknown) => log("info", message, data),
    warn: (message: string, data?: unknown) => log("warn", message, data),
    error: (message: string, data?: unknown) => log("error", message, data),
    debug: (message: string, data?: unknown) => log("debug", message, data),
  };
}

