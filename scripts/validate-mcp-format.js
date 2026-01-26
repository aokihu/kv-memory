import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];

const record = (name, pass, details = "") => {
  results.push({ name, pass, details });
};

const summarize = () => {
  for (const result of results) {
    const status = result.pass ? "PASS" : "FAIL";
    const suffix = result.details ? ` - ${result.details}` : "";
    console.log(`[${status}] ${result.name}${suffix}`);
  }

  if (results.some((result) => !result.pass)) {
    process.exitCode = 1;
  }
};

const assertTrue = (name, condition, details = "") => {
  record(name, Boolean(condition), details);
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

    const items = Array.isArray(collection) ? collection : Object.values(collection);
    for (const item of items) {
      if (item?.name === toolName && typeof item.execute === "function") {
        return item.execute.bind(item);
      }
    }
  }

  return null;
};

const runTool = async (toolName, executor, args, context = {}) => {
  if (!executor) {
    return null;
  }

  try {
    return await executor(args, context);
  } catch (error) {
    record(`${toolName} tool execution`, false, error?.message ?? "execution failed");
    return null;
  }
};

const ensureFields = (name, obj, fields) => {
  const missing = fields.filter((field) => !(field in obj));
  record(name, missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "");
};

const validateLinks = (links) => {
  assertTrue("links is array", Array.isArray(links), "links must be an array");
  if (!Array.isArray(links)) {
    return;
  }

  links.forEach((link, index) => {
    const prefix = `links[${index}]`;
    assertTrue(`${prefix} is object`, link && typeof link === "object", "link must be object");
    if (!link || typeof link !== "object") {
      return;
    }

    ensureFields(`${prefix} required fields`, link, ["type", "term", "weight", "summary"]);
    assertTrue(`${prefix}.type is string`, typeof link.type === "string", "type must be string");
    assertTrue(`${prefix}.term is string`, typeof link.term === "string", "term must be string");
    assertTrue(`${prefix}.weight is number`, typeof link.weight === "number", "weight must be number");
    assertTrue(`${prefix}.summary is string`, typeof link.summary === "string", "summary must be string");

    const hasKey = Object.prototype.hasOwnProperty.call(link, "key");
    assertTrue(
      `${prefix}.key optional`,
      !hasKey || typeof link.key === "string",
      "key must be string when provided",
    );
  });
};

const run = async () => {
  const rootDir = process.cwd();
  const mcpPath = path.join(rootDir, "src", "mcp.ts");

  let mcpServer = null;
  try {
    const mcpModule = await import(pathToFileURL(mcpPath).href);
    mcpServer = mcpModule?.mcpServer ?? null;
    assertTrue("MCP server import", Boolean(mcpServer), "mcpServer export not found");
  } catch (error) {
    record("MCP server import", false, error?.message ?? "import failed");
    summarize();
    return;
  }

  const addTool = findToolExecutor(mcpServer, "memory_add");
  const getTool = findToolExecutor(mcpServer, "memory_get");
  assertTrue("memory_add tool available", Boolean(addTool), "Tool executor not found");
  assertTrue("memory_get tool available", Boolean(getTool), "Tool executor not found");

  if (!addTool || !getTool) {
    summarize();
    return;
  }

  const keySuffix = `${Date.now()}`;
  const baseKey = `mcp-format-base-${keySuffix}`;
  const testKey = `mcp-format-test-${keySuffix}`;

  const baseMemory = {
    domain: "mcp-test",
    summary: "Base memory for link summary",
    text: "This memory is used to populate link summary.",
    type: "note",
    links: [],
    keywords: ["mcp", "format"],
  };

  const testMemory = {
    domain: "mcp-test",
    summary: "Format verification memory",
    text: "Validates memory_get response fields and link schema.",
    type: "note",
    links: [
      {
        type: "design",
        term: "base-memory",
        weight: 0.8,
        key: baseKey,
      },
      {
        type: "decision",
        term: "optional-key-link",
        weight: 0.4,
      },
    ],
    keywords: ["mcp", "validation", "links"],
  };

  const addBaseRaw = await runTool("memory_add", addTool, { key: baseKey, value: baseMemory });
  const addBaseResult = addBaseRaw ? safeJsonParse("memory_add base parse", addBaseRaw) : null;
  assertTrue(
    "memory_add base success",
    addBaseResult?.success === true,
    addBaseResult?.message ?? "memory_add failed",
  );

  const addTestRaw = await runTool("memory_add", addTool, { key: testKey, value: testMemory });
  const addTestResult = addTestRaw ? safeJsonParse("memory_add test parse", addTestRaw) : null;
  assertTrue(
    "memory_add test success",
    addTestResult?.success === true,
    addTestResult?.message ?? "memory_add failed",
  );

  const getRaw = await runTool("memory_get", getTool, { key: testKey });
  const getResult = getRaw ? safeJsonParse("memory_get parse", getRaw) : null;
  assertTrue(
    "memory_get success",
    getResult?.success === true,
    getResult?.message ?? "memory_get failed",
  );

  const data = getResult?.data ?? null;
  assertTrue("memory_get returns data", Boolean(data), "data is missing");

  if (data && typeof data === "object") {
    ensureFields("memory data fields", data, [
      "domain",
      "summary",
      "text",
      "type",
      "links",
      "keywords",
    ]);

    assertTrue("domain is string", typeof data.domain === "string", "domain must be string");
    assertTrue("summary is string", typeof data.summary === "string", "summary must be string");
    assertTrue("text is string", typeof data.text === "string", "text must be string");
    assertTrue("type is string", typeof data.type === "string", "type must be string");
    assertTrue("keywords is array", Array.isArray(data.keywords), "keywords must be array");

    validateLinks(data.links);
  }

  summarize();
};

run().catch((error) => {
  record("Unhandled error", false, error?.message ?? "unknown error");
  summarize();
});
