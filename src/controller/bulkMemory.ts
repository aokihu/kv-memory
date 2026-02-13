/**
 * 批量读取记忆控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { z } from "zod";
import type { AppServerContext } from "../type";

const BulkReadQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(6).optional().default(3),
  breadth: z.coerce.number().int().min(1).max(20).optional().default(5),
  total: z.coerce.number().int().min(1).max(50).optional().default(20),
});

function parseMemoryKeyFromPath(url: string): string | undefined {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/^\/api\/memories\/([^/]+)\/bulk$/);
  if (!match?.[1]) {
    return undefined;
  }

  return decodeURIComponent(match[1]);
}

export const bulkMemoryReadController = async (
  req: Bun.BunRequest<"/api/memories/:key/bulk">,
  ctx: AppServerContext,
) => {
  const key = parseMemoryKeyFromPath(req.url);
  if (!key) {
    return Response.json({ success: false, message: "invalid memory key" }, { status: 400 });
  }

  const searchParams = new URL(req.url).searchParams;
  const parsed = BulkReadQuerySchema.safeParse({
    depth: searchParams.get("depth") ?? undefined,
    breadth: searchParams.get("breadth") ?? undefined,
    total: searchParams.get("total") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ success: false, message: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await ctx.kvMemoryService.bulkReadMemory(key, parsed.data);
    if (!result) {
      return Response.json({ success: false, message: "memory not found" }, { status: 404 });
    }

    return Response.json({
      success: true,
      data: {
        targetMemory: result.targetMemory,
        associatedMemories: result.associatedMemories,
        metadata: result.metadata,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bulk memory read failed";
    return Response.json({ success: false, message }, { status: 500 });
  }
};
