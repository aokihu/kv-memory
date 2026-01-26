import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const mcpPath = path.join(rootDir, "src", "mcp.ts");
const pkgPath = path.join(rootDir, "package.json");

const results = [];

const record = (name, pass, details = "") => {
  results.push({ name, pass, details });
};

const summarize = () => {
  const failed = results.filter((result) => !result.pass);
  for (const result of results) {
    const status = result.pass ? "PASS" : "FAIL";
    const suffix = result.details ? ` - ${result.details}` : "";
    console.log(`[${status}] ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

const assertTrue = (name, condition, details = "") => {
  record(name, Boolean(condition), details);
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const checkBalance = (source) => {
  const stack = [];
  const openers = new Map([
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ]);
  const closers = new Map([
    ["}", "{"],
    [")", "("],
    ["]", "["],
  ]);

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (char === "/" && next === "/") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    if (!escaped) {
      if (char === "'" && !inDouble && !inTemplate) {
        inSingle = !inSingle;
        continue;
      }
      if (char === "\"" && !inSingle && !inTemplate) {
        inDouble = !inDouble;
        continue;
      }
      if (char === "`" && !inSingle && !inDouble) {
        inTemplate = !inTemplate;
        continue;
      }
    }

    escaped = !escaped && char === "\\";
    if (inSingle || inDouble || inTemplate) {
      continue;
    }

    if (openers.has(char)) {
      stack.push(char);
      continue;
    }
    if (closers.has(char)) {
      const expected = closers.get(char);
      const last = stack.pop();
      if (last !== expected) {
        return false;
      }
    }
  }

  return stack.length === 0 && !inSingle && !inDouble && !inTemplate;
};

const extractMatches = (source, regex) => {
  const matches = [];
  let match = regex.exec(source);
  while (match) {
    matches.push(match[1]);
    match = regex.exec(source);
  }
  return matches;
};

const ensureIncludes = (name, collection, expected) => {
  const missing = expected.filter((value) => !collection.includes(value));
  const pass = missing.length === 0;
  const details = pass ? "" : `Missing: ${missing.join(", ")}`;
  record(name, pass, details);
};

const run = async () => {
  try {
    await fs.access(mcpPath);
    record("src/mcp.ts exists", true);
  } catch (error) {
    record("src/mcp.ts exists", false, error?.message ?? "missing file");
    summarize();
    return;
  }

  let mcpSource = "";
  try {
    mcpSource = await fs.readFile(mcpPath, "utf8");
    assertTrue("src/mcp.ts is non-empty", mcpSource.trim().length > 0);
  } catch (error) {
    record("Read src/mcp.ts", false, error?.message ?? "read failed");
    summarize();
    return;
  }

  assertTrue(
    "src/mcp.ts passes lightweight syntax scan",
    checkBalance(mcpSource),
    "Unbalanced brackets or unterminated strings",
  );

  const toolNames = extractMatches(
    mcpSource,
    /addTool\(\s*{\s*name:\s*"([^"]+)"/g,
  );
  ensureIncludes("MCP tool list", toolNames, ["session_new", "memory_add", "memory_get"]);

  const resourceTemplates = extractMatches(
    mcpSource,
    /addResourceTemplate\(\s*{\s*uriTemplate:\s*"([^"]+)"/g,
  );
  ensureIncludes("MCP resource template", resourceTemplates, ["memory://{key}"]);
  assertTrue(
    "Resource template metadata",
    mcpSource.includes("name: \"KVDB Memory\"") &&
      mcpSource.includes("mimeType: \"application/json\""),
    "Expected name or mimeType not found",
  );

  const promptNames = extractMatches(
    mcpSource,
    /addPrompt\(\s*{\s*name:\s*"([^"]+)"/g,
  );
  ensureIncludes("MCP prompts", promptNames, ["capture_memory", "recall_memory"]);

  assertTrue(
    "stdio transport configured",
    mcpSource.includes("transportType: \"stdio\""),
    "No stdio transport found",
  );

  assertTrue(
    "MCP API exports",
    mcpSource.includes("export const mcpServer") &&
      mcpSource.includes("export const startMcpServer"),
    "Missing exported API",
  );

  let pkg = null;
  try {
    pkg = await readJson(pkgPath);
    record("package.json is readable", true);
  } catch (error) {
    record("package.json is readable", false, error?.message ?? "read failed");
  }

  if (pkg) {
    const scripts = pkg.scripts ?? {};
    assertTrue(
      "MCP script configured",
      scripts.mcp === "bun run ./src/mcp.ts",
      `Expected scripts.mcp to be "bun run ./src/mcp.ts"`,
    );

    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    ensureIncludes("Required dependencies", Object.keys(deps ?? {}), [
      "fastmcp",
      "zod",
    ]);
  }

  summarize();
};

run().catch((error) => {
  record("Unhandled error", false, error?.message ?? "unknown error");
  summarize();
});
