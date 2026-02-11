/**
 * 记忆初始化
 */
import type { InputPrompt } from "fastmcp";

type McpSessionAuth = Record<string, unknown> | undefined;
type InitMemoryArguments = [
  {
    name: "name";
    description: "Agent Name";
    required: true;
  },
];

const initMemoryArguments: InitMemoryArguments = [
  {
    name: "name",
    description: "Agent Name",
    required: true,
  },
];

export const initMemoryPrompt: InputPrompt<
  McpSessionAuth,
  InitMemoryArguments
> = {
  name: "memory_init",
  description: "指导Agent如何开始初始化记忆库",
  arguments: [...initMemoryArguments],
  load: async ({ name }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `你正在初始化记忆,请按照下面的指示进行操作:
              1. 添加一个索引记忆 ${name}:global:index, 这个记忆将是你所有记忆的入口
              2. 添加一个记忆 ${name}:global:domain, 这个记忆保存着你自行定义的"domain", 比如"profile - 表示个人性格","intrest" - 表示个人兴趣; 之后规划"key"的时候需要从这些"domain"选取,也可以在以后添加新的"domain"
              3. 关联 ${name}:global:domain -> ${name}:global:index 并且设置权重为 "0.99"`,
          },
        },
      ],
    };
  },
};
