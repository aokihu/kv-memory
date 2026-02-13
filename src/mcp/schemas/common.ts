/**
 * MCP Common Schemas
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import { z } from "zod";

/**
 * sortLinks parameter schema shared by MCP tools.
 *
 * Accepts:
 * - boolean: true / false
 * - string: "true" / "false" (case-insensitive)
 *
 * Defaults to true to match HTTP API behavior.
 * Debug hint: if validation fails unexpectedly, inspect caller payload type
 * before preprocess (number/object values are rejected by design).
 */
export const SortLinksSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }

      if (normalized === "false") {
        return false;
      }
    }

    return value;
  },
  z.boolean({ message: "sortLinks must be true or false" }).optional().default(true),
);

export type SortLinksInput = z.input<typeof SortLinksSchema>;
export type SortLinksValue = z.output<typeof SortLinksSchema>;
