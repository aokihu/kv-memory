import { KVMemoryService } from "../../service";
import type { MemoryNoMetaWithLinkSummary } from "../../service/kvmemory";

export const createMemoryResourceTemplate = (
  kvMemoryService: KVMemoryService,
) => ({
  uriTemplate: "memory://{namespace}/{key}",
  name: "KVDB Memory",
  description: "只读方式获取记忆数据",
  mimeType: "application/json",
  arguments: [
    {
      name: "namespace",
      description: "Memory namespace (defaults to mem)",
      required: false,
    },
    {
      name: "key",
      description: "Memory key",
      required: true,
    },
  ],
  load: async (args: Record<string, unknown>) => {
    const namespace = (args.namespace as string | undefined) ?? "mem";
    const key = args.key as string;
    try {
      const memory: MemoryNoMetaWithLinkSummary | undefined =
        await kvMemoryService.getMemory(namespace, key);
      return {
        uri: `memory://${namespace}/${key}`,
        text: JSON.stringify(memory, null, 2),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        uri: `memory://${namespace}/${key}`,
        text: JSON.stringify({ success: false, message }, null, 2),
      };
    }
  },
});
