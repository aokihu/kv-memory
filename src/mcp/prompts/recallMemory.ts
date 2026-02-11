import type { InputPrompt } from "fastmcp";

type McpSessionAuth = Record<string, unknown> | undefined;
type RecallMemoryArguments = [
  {
    name: "key";
    description: "Memory key";
    required: true;
  },
];

const recallMemoryArguments: RecallMemoryArguments = [
  {
    name: "key",
    description: "Memory key",
    required: true,
  },
];

export const recallMemoryPrompt: InputPrompt<McpSessionAuth, RecallMemoryArguments> = {
  name: "recall_memory",
  description: "Guide an agent to recall memory by key",
  arguments: [...recallMemoryArguments],
  load: async ({ key }: { key: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "你正在使用 KVDB MCP 工具读取记忆。请严格按以下步骤执行：\n" +
              "1) 先确保有 session：没有 session 时先调用 session_new。\n" +
              "2) 调用 memory_get 并传入 key。\n" +
              "3) key 必须使用 ':' 作为层级分隔符，例如 project:module:topic。\n" +
              `4) 当前查询 key: ${key}\n` +
              "如果没有明确 key，使用默认入口 key：index（用于保存高价值或高联想记忆）。",
          },
        },
      ],
    };
  },
};
