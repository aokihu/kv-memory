import { z } from "zod";
import { MemoryNoMetaSchema } from "../../type";

export const MemoryLinkInputSchema = MemoryNoMetaSchema.shape.links.element.extend({
  key: z.string().optional(),
});

export const MemoryValueSchema = MemoryNoMetaSchema.extend({
  links: z.array(MemoryLinkInputSchema).optional(),
  keywords: MemoryNoMetaSchema.shape.keywords.optional(),
});

export const MemoryAddSchema = z.object({
  session: z.string().min(1),
  key: z.string().min(1),
  value: MemoryValueSchema,
});

export const MemoryGetSchema = z.object({
  key: z.string().min(1),
  session: z.string().min(1),
});

export const MemoryUpdateSchema = z.object({
  key: z.string().min(1),
  value: MemoryNoMetaSchema.partial(),
  session: z.string().min(1),
});

export const MemoryRenameSchema = z.object({
  old_key: z.string().min(1),
  new_key: z.string().min(1),
  session: z.string().min(1),
});

export type MemoryAddInput = z.infer<typeof MemoryAddSchema>;
export type MemoryGetInput = z.infer<typeof MemoryGetSchema>;
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateSchema>;
export type MemoryRenameInput = z.infer<typeof MemoryRenameSchema>;
