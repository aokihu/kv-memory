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
              "If you do not have a session, call session_new first.",
          },
        },
      ],
    };
  },
};
