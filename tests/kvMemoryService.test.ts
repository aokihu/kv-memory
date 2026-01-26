import { describe, test, expect } from "bun:test";
import { KVMemoryService } from "../src/service/kvmemory";
import type { Memory, MemoryNoMeta } from "../src/type";

const service = new KVMemoryService();

const createKey = (suffix: string) =>
  `kv_memory_service_${suffix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

const buildMemory = (overrides: Partial<MemoryNoMeta> = {}): MemoryNoMeta => ({
  domain: "test",
  summary: "test summary",
  text: "test text",
  type: "test",
  links: [],
  keywords: ["test"],
  ...overrides,
});

describe("KVMemoryService getMemory", () => {
  test("hides meta information", async () => {
    const key = createKey("no_meta");
    await service.addMemory(key, buildMemory({ summary: "no meta summary" }));

    const result = await service.getMemory(key);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("meta");
    expect(result?.summary).toBe("no meta summary");
  });

  test("adds summary field to links", async () => {
    const linkedKey = createKey("linked_for_summary");
    const key = createKey("with_link_summary");
    const link: Memory["links"][number] = {
      type: "design",
      key: linkedKey,
      term: "related",
      weight: 0.7,
    };

    await service.addMemory(
      linkedKey,
      buildMemory({ summary: "linked summary" })
    );
    await service.addMemory(key, buildMemory({ links: [link] }));

    const result = await service.getMemory(key);

    expect(result).toBeDefined();
    expect(result?.links.length).toBe(1);
    expect(result?.links[0]).toHaveProperty("summary");
  });

  test("shows '关联记忆不存在' when linked memory is missing", async () => {
    const missingKey = createKey("missing_link_target");
    const key = createKey("missing_link_summary");
    const link: Memory["links"][number] = {
      type: "design",
      key: missingKey,
      term: "missing",
      weight: 0.5,
    };

    await service.addMemory(key, buildMemory({ links: [link] }));

    const result = await service.getMemory(key);

    expect(result).toBeDefined();
    expect(result?.links.length).toBe(1);
    expect(result?.links[0].summary).toBe("关联记忆不存在");
  });

  test("shows correct summary when linked memory exists", async () => {
    const linkedKey = createKey("linked_target");
    const key = createKey("linked_summary");
    const link: Memory["links"][number] = {
      type: "design",
      key: linkedKey,
      term: "exists",
      weight: 0.9,
    };

    await service.addMemory(
      linkedKey,
      buildMemory({ summary: "expected linked summary" })
    );
    await service.addMemory(key, buildMemory({ links: [link] }));

    const result = await service.getMemory(key);

    expect(result).toBeDefined();
    expect(result?.links.length).toBe(1);
    expect(result?.links[0].summary).toBe("expected linked summary");
  });
});
