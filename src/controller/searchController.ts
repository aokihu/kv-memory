/**
 * 搜索控制器
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 * @summary 处理 GET /search 与 GET /fulltext 请求
 */

import { z } from 'zod';
import { KVMemoryService, SessionService } from '../service';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  session: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const FulltextQuerySchema = z.object({
  keywords: z.string().trim().min(1, 'keywords is required'),
  session: z.string().optional(),
  operator: z.enum(['AND', 'OR']).optional().default('OR'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

type SearchQueryInput = {
  q?: string;
  session?: string;
  limit?: string;
  offset?: string;
};

type FulltextQueryInput = {
  keywords?: string;
  session?: string;
  operator?: string;
  limit?: string;
  offset?: string;
};

export class SearchController {
  private readonly kvMemoryService: KVMemoryService;
  private readonly sessionService: SessionService;

  constructor(kvMemoryService: KVMemoryService, sessionService: SessionService = new SessionService()) {
    this.kvMemoryService = kvMemoryService;
    this.sessionService = sessionService;
  }

  /**
   * 处理基础关键词搜索。
   */
  async search(req: Bun.BunRequest<'/search'>): Promise<Response> {
    const queryInput = this.getSearchInput(req);
    const parsed = SearchQuerySchema.safeParse(queryInput);

    if (!parsed.success) {
      return Response.json({ success: false, message: parsed.error.issues }, { status: 400 });
    }

    const namespaceResult = await this.resolveNamespace(parsed.data.session);
    if (namespaceResult.errorResponse) {
      return namespaceResult.errorResponse;
    }

    try {
      const result = await this.kvMemoryService.searchMemory(
        parsed.data.q,
        parsed.data.limit,
        parsed.data.offset,
        namespaceResult.namespace,
      );

      return Response.json({ success: true, data: result });
    } catch (error) {
      // Debug 起点: 若业务层抛错，先检查 q/limit/offset 归一化结果与 SearchService 开关配置。
      return this.handleServiceError(error);
    }
  }

  /**
   * 处理多关键词全文搜索。
   */
  async fulltextSearch(req: Bun.BunRequest<'/fulltext'>): Promise<Response> {
    const queryInput = this.getFulltextInput(req);
    const parsed = FulltextQuerySchema.safeParse(queryInput);

    if (!parsed.success) {
      return Response.json({ success: false, message: parsed.error.issues }, { status: 400 });
    }

    const keywords = parsed.data.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);

    if (keywords.length === 0) {
      return Response.json(
        { success: false, message: 'keywords must contain at least one non-empty value' },
        { status: 400 },
      );
    }

    const namespaceResult = await this.resolveNamespace(parsed.data.session);
    if (namespaceResult.errorResponse) {
      return namespaceResult.errorResponse;
    }

    try {
      const result = await this.kvMemoryService.fulltextSearchMemory(
        keywords,
        parsed.data.operator,
        parsed.data.limit,
        parsed.data.offset,
        namespaceResult.namespace,
      );

      return Response.json({ success: true, data: result });
    } catch (error) {
      // Debug 起点: 若组合查询失败，优先检查关键词拆分结果和 operator 传递值。
      return this.handleServiceError(error);
    }
  }

  /**
   * 从 URL 解析基础搜索参数。
   */
  private getSearchInput(req: Bun.BunRequest<'/search'>): SearchQueryInput {
    const searchParams = new URL(req.url).searchParams;
    return {
      q: searchParams.get('q') ?? undefined,
      session: searchParams.get('session') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    };
  }

  /**
   * 从 URL 解析全文搜索参数。
   */
  private getFulltextInput(req: Bun.BunRequest<'/fulltext'>): FulltextQueryInput {
    const searchParams = new URL(req.url).searchParams;
    return {
      keywords: searchParams.get('keywords') ?? undefined,
      session: searchParams.get('session') ?? undefined,
      operator: searchParams.get('operator') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    };
  }

  /**
   * 统一业务层异常输出。
   */
  private handleServiceError(error: unknown): Response {
    const message = error instanceof Error ? error.message : 'search failed';
    return Response.json({ success: false, message }, { status: 500 });
  }

  /**
   * 校验可选 session 并提取 namespace。
   */
  private async resolveNamespace(
    sessionId?: string,
  ): Promise<{ namespace?: string; errorResponse?: Response }> {
    if (!sessionId) {
      return {};
    }

    const sessionData = await this.sessionService.getSession(sessionId);
    if (!sessionData) {
      return {
        errorResponse: Response.json({ success: false, message: 'invalid session' }, { status: 401 }),
      };
    }

    return { namespace: sessionData.kv_namespace };
  }
}
