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
              "- value.summary (string, 1-2 sentences)\n" +
              "- value.text (string, detailed)\n" +
              "- value.links (array of { type, term, weight })\n" +
              "\n" +
              `Use key: ${key}. Keep links empty when unknown.` +
              "你可以设置一个index作为key,当作是整个记忆仓库的入口,其中保存你认为的重要的记忆或者具有很好联想能力的记忆条目" +
              "当你没有任何合适的key时,可以使用默认的key: index"
          },
        },
      ],
    };
  },
};
