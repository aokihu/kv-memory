import type { InputPrompt } from "fastmcp";

type McpSessionAuth = Record<string, unknown> | undefined;

type CaptureMemoryArguments = [
  {
    name: "key";
    description: "Unique memory key";
    required: true;
  },
];

const captureMemoryArguments: CaptureMemoryArguments = [
  {
    name: "key",
    description: "Unique memory key",
    required: true,
  },
];

export const captureMemoryPrompt: InputPrompt<
  McpSessionAuth,
  CaptureMemoryArguments
> = {
  name: "capture_memory",
  description: "Guide an agent to create a structured memory record",
  arguments: [...captureMemoryArguments],
  load: async ({ key }: { key: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Create a structured memory payload for KVDB. Output JSON with:\n" +
              "- key (string)\n" +
              "- value.domain (string)\n" +
              "- value.summary (string, 1-2 sentences)\n" +
              "- value.text (string, detailed)\n" +
              "- value.type (string)\n" +
              "- value.links (array of { type, term, weight })\n" +
              "- value.keywords (array of strings)\n\n" +
              `Use key: ${key}. Keep links empty when unknown.`,
          },
        },
      ],
    };
  },
};
