import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const mcpPath = path.join(rootDir, "src", "mcp", "server.ts");
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

const safeJsonParse = (name, raw) => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    record(name, false, error?.message ?? "invalid JSON");
    return null;
  }
};

const findToolExecutor = (server, toolName) => {
  if (!server || typeof server !== "object") {
    return null;
  }

  const direct = server.getTool?.(toolName);
  if (direct?.execute) {
    return direct.execute.bind(direct);
  }

  const candidates = [
    server.tools,
    server.toolHandlers,
    server.handlers,
    server.registry,
    server._tools,
  ];

  for (const collection of candidates) {
    if (!collection) {
      continue;
    }

    if (typeof collection.get === "function") {
      const item = collection.get(toolName);
      if (item?.execute) {
        return item.execute.bind(item);
      }
    }

    const items = Array.isArray(collection)
      ? collection
      : Object.values(collection);

    for (const item of items) {
      if (item?.name === toolName && typeof item.execute === "function") {
        return item.execute.bind(item);
      }
    }
  }

  return null;
};

const runTool = async (toolName, executor, args, context) => {
  if (!executor) {
    return null;
  }

  try {
    const raw = await executor(args, context);
    return raw;
  } catch (error) {
    record(`${toolName} tool execution`, false, error?.message ?? "execution failed");
    return null;
  }
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
    record("src/mcp/server.ts exists", true);
  } catch (error) {
    record("src/mcp/server.ts exists", false, error?.message ?? "missing file");
    summarize();
    return;
  }

  let mcpSource = "";
  try {
    mcpSource = await fs.readFile(mcpPath, "utf8");
    assertTrue("src/mcp/server.ts is non-empty", mcpSource.trim().length > 0);
  } catch (error) {
    record("Read src/mcp/server.ts", false, error?.message ?? "read failed");
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
  ensureIncludes("MCP tool list", toolNames, [
    "session_new",
    "memory_add",
    "memory_get",
    "memory_update",
    "memory_rename",
  ]);

  const resourceTemplates = extractMatches(
    mcpSource,
    /addResourceTemplate\(\s*{\s*uriTemplate:\s*"([^"]+)"/g,
  );
  ensureIncludes("MCP resource template", resourceTemplates, ["memory://{namespace}/{key}"]);
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
    "httpStream transport configured",
    mcpSource.includes("transportType: \"httpStream\""),
    "No httpStream transport found",
  );

  assertTrue(
    "MCP API exports",
    mcpSource.includes("export const server") &&
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
      scripts.mcp === "bun run ./src/mcp/index.ts",
      `Expected scripts.mcp to be "bun run ./src/mcp/index.ts"`,
    );

    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    ensureIncludes("Required dependencies", Object.keys(deps ?? {}), [
      "fastmcp",
      "zod",
    ]);
  }

  let mcpServer = null;
  try {
    const mcpModule = await import(pathToFileURL(mcpPath).href);
    mcpServer = mcpModule?.server ?? null;
    assertTrue("MCP server import", Boolean(mcpServer), "server export not found");
  } catch (error) {
    record("MCP server import", false, error?.message ?? "import failed");
  }

  if (mcpServer) {
    const addTool = findToolExecutor(mcpServer, "memory_add");
    const getTool = findToolExecutor(mcpServer, "memory_get");
    const updateTool = findToolExecutor(mcpServer, "memory_update");
    const renameTool = findToolExecutor(mcpServer, "memory_rename");

    assertTrue("memory_add tool available", Boolean(addTool), "Tool executor not found");
    assertTrue("memory_get tool available", Boolean(getTool), "Tool executor not found");
    assertTrue("memory_update tool available", Boolean(updateTool), "Tool executor not found");
    assertTrue("memory_rename tool available", Boolean(renameTool), "Tool executor not found");

    if (addTool && getTool && updateTool && renameTool) {
      const keySuffix = `${Date.now()}`;
      const baseMemory = {
        domain: "mcp-test",
        summary: "Initial memory payload",
        text: "Initial memory text",
        type: "note",
        links: [],
        keywords: ["mcp", "test"],
      };

      const updateKey = `mcp-update-${keySuffix}`;
      const updatePayload = {
        summary: "Updated memory payload",
        text: "Updated memory text",
      };

      const addUpdateRaw = await runTool(
        "memory_add",
        addTool,
        { key: updateKey, value: baseMemory, output_format: "json" },
        {},
      );
      const addUpdateResult = addUpdateRaw
        ? safeJsonParse("memory_update add parse", addUpdateRaw)
        : null;
      assertTrue(
        "memory_update add success",
        addUpdateResult?.success === true,
        addUpdateResult?.message ?? "memory_add failed",
      );

      const updateRaw = await runTool(
        "memory_update",
        updateTool,
        { key: updateKey, value: updatePayload, output_format: "json" },
        {},
      );
      const updateResult = updateRaw
        ? safeJsonParse("memory_update response parse", updateRaw)
        : null;
      assertTrue(
        "memory_update success",
        updateResult?.success === true,
        updateResult?.message ?? "memory_update failed",
      );

      const updatedGetRaw = await runTool(
        "memory_get",
        getTool,
        { key: updateKey, output_format: "json" },
        {},
      );
      const updatedGetResult = updatedGetRaw
        ? safeJsonParse("memory_update get parse", updatedGetRaw)
        : null;
      assertTrue(
        "memory_update get success",
        updatedGetResult?.success === true,
        updatedGetResult?.message ?? "memory_get failed",
      );

      const updatedData = updatedGetResult?.data ?? {};
      assertTrue(
        "memory_update updated summary",
        updatedData.summary === updatePayload.summary,
        `Expected ${updatePayload.summary}`,
      );
      assertTrue(
        "memory_update updated text",
        updatedData.text === updatePayload.text,
        `Expected ${updatePayload.text}`,
      );
      assertTrue(
        "memory_update preserves domain",
        updatedData.domain === baseMemory.domain,
        `Expected ${baseMemory.domain}`,
      );

      const renameOldKey = `mcp-rename-old-${keySuffix}`;
      const renameNewKey = `mcp-rename-new-${keySuffix}`;
      const renamePayload = {
        domain: "mcp-test",
        summary: "Rename memory payload",
        text: "Rename memory text",
        type: "note",
        links: [],
        keywords: ["mcp", "rename"],
      };

      const addRenameRaw = await runTool(
        "memory_add",
        addTool,
        { key: renameOldKey, value: renamePayload, output_format: "json" },
        {},
      );
      const addRenameResult = addRenameRaw
        ? safeJsonParse("memory_rename add parse", addRenameRaw)
        : null;
      assertTrue(
        "memory_rename add success",
        addRenameResult?.success === true,
        addRenameResult?.message ?? "memory_add failed",
      );

      const renameRaw = await runTool(
        "memory_rename",
        renameTool,
        { old_key: renameOldKey, new_key: renameNewKey, output_format: "json" },
        {},
      );
      const renameResult = renameRaw
        ? safeJsonParse("memory_rename response parse", renameRaw)
        : null;
      assertTrue(
        "memory_rename success",
        renameResult?.success === true,
        renameResult?.message ?? "memory_rename failed",
      );

      const oldKeyRaw = await runTool(
        "memory_get",
        getTool,
        { key: renameOldKey, output_format: "json" },
        {},
      );
      const oldKeyResult = oldKeyRaw
        ? safeJsonParse("memory_rename old key parse", oldKeyRaw)
        : null;
      assertTrue(
        "memory_rename old key missing",
        oldKeyResult?.success === false,
        oldKeyResult?.message ?? "old key still exists",
      );

      const newKeyRaw = await runTool(
        "memory_get",
        getTool,
        { key: renameNewKey, output_format: "json" },
        {},
      );
      const newKeyResult = newKeyRaw
        ? safeJsonParse("memory_rename new key parse", newKeyRaw)
        : null;
      assertTrue(
        "memory_rename new key exists",
        newKeyResult?.success === true,
        newKeyResult?.message ?? "new key not found",
      );

      const renamedData = newKeyResult?.data ?? {};
      assertTrue(
        "memory_rename preserves summary",
        renamedData.summary === renamePayload.summary,
        `Expected ${renamePayload.summary}`,
      );
      assertTrue(
        "memory_rename preserves text",
        renamedData.text === renamePayload.text,
        `Expected ${renamePayload.text}`,
      );
      assertTrue(
        "memory_rename preserves domain",
        renamedData.domain === renamePayload.domain,
        `Expected ${renamePayload.domain}`,
      );
    }
  }

  summarize();
};

run().catch((error) => {
  record("Unhandled error", false, error?.message ?? "unknown error");
  summarize();
});
