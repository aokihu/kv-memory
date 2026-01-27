import { z } from "zod";

export const SessionCreateSchema = z.object({
  namespace: z
    .string()
    .min(1)
    .describe("Memory namespace for the session")
    .default("mem"),
});

export type SessionCreateInput = z.infer<typeof SessionCreateSchema>;
