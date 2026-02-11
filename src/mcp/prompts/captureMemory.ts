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
              "你正在使用 KVDB MCP 工具写入记忆。请严格按以下步骤执行：\n" +
              "1) 先确保有 session：没有 session 时先调用 session_new。\n" +
              "2) 再调用 memory_add，参数必须包含 key、value、links。\n" +
              "3) key 命名必须使用 ':' 作为层级分隔符，例如 project:module:topic。\n" +
              "4) 输出 JSON 结构：\n" +
              "- key (string)\n" +
              "- value.summary (string, 1-2 sentences)\n" +
              "- value.text (string, detailed)\n" +
              "- links (array of { type, key, term, weight })\n" +
              "5) links 中的 key 也必须遵循 ':' 分隔规则；未知时 links 传空数组。\n" +
              `当前建议 key: ${key}\n` +
              "当没有合适 key 时，使用默认入口 key：index。"
          },
        },
      ],
    };
  },
};
