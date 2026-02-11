import { encode } from "@toon-format/toon";
import { type Tool } from "fastmcp";
import { KVMemoryService, SessionService } from "../../service";
import type { MemoryNoMeta } from "../../type";
import { MemoryAddSchema, type MemoryAddInput } from "../schemas/memory";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createMemoryAddTool = (
  sessionService: SessionService,
  kvMemoryService: KVMemoryService,
): Tool<McpSessionAuth, typeof MemoryAddSchema> => ({
  name: "memory_add",
  description: `Add a memory record,使用':'作为key的分隔符,
  * 使用有语义的词作为key,并且按照层级定义key
    1. namespace 命名空间,通常是agent的名字
    2. domain 表示记忆的作用域,比如'project','global','UI','code','knowldge',etc.
    3. type 表示记忆的类型,比如'test','debug','note',
    4. title 记忆的具体标题,使用'-'作为连接符号
  * link只需要添加相关记忆的key即可
  * 默认可以添加{namespace}:index记忆key作为所有记忆的索引入口
  * namespace如果是英文,使用首字母大写格式
  * 当添加记忆后,确认是否有相关联的上下文记忆需要连接,比如 {ns}:profile:avatar -> {ns}:profile, 或者 {ns}:profile:avatar -> {ns}:core:identity
  * 如果没有上下文记忆能够连接,那么就把记忆连接在{ns}:index作为最后的连接入口
  * 尽量避免孤儿记忆存在,所有的记忆至少要有一个父记忆连接({ns}:index 除外)`,
  parameters: MemoryAddSchema,
  execute: async (args: MemoryAddInput) => {
    try {
      if (args.session) {
        const sessionData = await sessionService.getSession(args.session);
        if (!sessionData) {
          return JSON.stringify(
            { success: false, message: "invalid session" },
            null,
            2,
          );
        }
      }
      const value: MemoryNoMeta = {
        ...args.value,
      };

      await kvMemoryService.addMemory(args.key, value, args.links ?? []);

      const outputFormat = args.output_format ?? "toon";
      const payload = { success: true };

      if (outputFormat === "toon") {
        return encode(payload);
      }

      return JSON.stringify(payload, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return JSON.stringify({ success: false, message }, null, 2);
    }
  },
});
