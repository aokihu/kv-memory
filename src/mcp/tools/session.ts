import { type Tool } from "fastmcp";
import { SessionService } from "../../service";
import {
  SessionCreateSchema,
  type SessionCreateInput,
} from "../schemas/session";

type McpSessionAuth = Record<string, unknown> | undefined;

export const createSessionNewTool = (
  sessionService: SessionService
): Tool<McpSessionAuth, typeof SessionCreateSchema> => ({
  name: "session_new",
  description: "创建新的session,每个session最多保持3分钟时效",
  parameters: SessionCreateSchema,
  execute: async (args: SessionCreateInput) => {
    const namespace = args.namespace ?? "mem";
    const sessionKey = await sessionService.generateSession(namespace);
return sessionKey;
  },
});
