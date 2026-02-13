import { z } from "zod";
import { MemoryLink, MemoryNoMetaSchema } from "../../type";
import { SortLinksSchema } from "./common";

export const MemoryLinkInputSchema = MemoryLink.extend({
  key: z.string().optional(),
});

export const MemoryValueSchema = MemoryNoMetaSchema;

export const MemoryAddSchema = z.object({
  session: z.string().min(1).optional(),
  key: z.string().min(1),
  value: MemoryValueSchema,
  links: z.array(MemoryLinkInputSchema).optional(),
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export const MemoryGetSchema = z.object({
  key: z.string().min(1),
  session: z.string().min(1).optional(),
  sortLinks: SortLinksSchema,
  output_format: z.enum(["json", "toon"]).default("toon"),
});

export const MemoryUpdateSchema = z.object({
  key: z.string().min(1),
  value: MemoryNoMetaSchema.partial(),
  links: z.array(MemoryLinkInputSchema).optional(),
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
