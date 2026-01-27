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
  session: z.string().min(1).optional(),
  key: z.string().min(1),
  value: MemoryValueSchema,
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export const MemoryGetSchema = z.object({
  key: z.string().min(1),
  session: z.string().min(1).optional(),
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export const MemoryUpdateSchema = z.object({
  key: z.string().min(1),
  value: MemoryNoMetaSchema.partial(),
  session: z.string().min(1).optional(),
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export const MemoryRenameSchema = z.object({
  old_key: z.string().min(1),
  new_key: z.string().min(1),
  session: z.string().min(1).optional(),
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export type MemoryAddInput = z.infer<typeof MemoryAddSchema>;
export type MemoryGetInput = z.infer<typeof MemoryGetSchema>;
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateSchema>;
export type MemoryRenameInput = z.infer<typeof MemoryRenameSchema>;
