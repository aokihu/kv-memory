const recallMemoryArguments = [
  {
    name: "key",
    description: "Memory key",
    required: true,
  },
] as const;

export const recallMemoryPrompt = {
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
