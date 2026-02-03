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
              "Recall a memory record by key. Use the memory_get tool with:\n" +
              `- key: ${key}\n` +
              "If you do not have a session, call session_new first." +
              "如果没有设置key,你可以是使用index作为默认key" +
              "其中保存着你认为的重要的记忆或者具有很好联想能力的记忆条目",
          },
        },
      ],
    };
  },
};
