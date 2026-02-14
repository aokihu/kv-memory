/**
 * Shared CLI helpers for command parsing and output.
 *
 * Debug entry: if command dispatch is wrong, inspect `parseCliInput` output first.
 */

export type CliLogLevel = "info" | "error";

export type CliLogger = {
  log: (level: CliLogLevel, message: string, payload?: unknown) => void;
};

export type ParsedCliInput = {
  command: string | null;
  args: string[];
  flags: Map<string, string | boolean>;
};

/**
 * Resolve runtime argv across `bun run`, `node`, and compiled executable forms.
 */
export function getCliArgv(): string[] {
  if (typeof Bun !== "undefined" && Array.isArray(Bun.argv)) {
    return Bun.argv;
  }

  return process.argv;
}

/**
 * Parse the first command token and long-form flags.
 */
export function parseCliInput(argv: string[]): ParsedCliInput {
  const userArgs = sliceUserArgs(argv);
  const [commandToken, ...rest] = userArgs;
  const flags = new Map<string, string | boolean>();
  const args: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }

    const pair = token.slice(2);
    if (pair.includes("=")) {
      const separatorIndex = pair.indexOf("=");
      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      flags.set(key, value);
      continue;
    }

    const key = pair.trim();
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }

    flags.set(key, true);
  }

  return {
    command: commandToken ?? null,
    args,
    flags,
  };
}

/**
 * Create logger with consistent prefix format.
 */
export function createCliLogger(scope: string): CliLogger {
  return {
    log(level, message, payload) {
      const prefix = `[cli:${scope}]`;
      const output = `${prefix} ${message}`;
      if (level === "error") {
        if (payload === undefined) {
          console.error(output);
          return;
        }
        console.error(output, payload);
        return;
      }

      if (payload === undefined) {
        console.info(output);
        return;
      }
      console.info(output, payload);
    },
  };
}

/**
 * Run command body with unified error handling.
 */
export function runCommandSafely(scope: string, run: (logger: CliLogger) => number): number {
  const logger = createCliLogger(scope);
  try {
    return run(logger);
  } catch (error) {
    logger.log("error", "command failed", error);
    return 1;
  }
}

export function getStringFlag(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

export function getBooleanFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return flags.get(key) === true;
}

function sliceUserArgs(argv: string[]): string[] {
  if (argv.length <= 1) {
    return [];
  }

  const second = argv[1] ?? "";

  if (
    second.endsWith(".ts") ||
    second.endsWith(".js") ||
    second.endsWith(".mjs") ||
    second.endsWith(".cjs") ||
    second.includes("/") ||
    second.includes("\\")
  ) {
    return argv.slice(2);
  }

  return argv.slice(1);
}
