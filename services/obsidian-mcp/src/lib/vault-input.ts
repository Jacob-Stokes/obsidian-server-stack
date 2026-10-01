import { z } from "zod";

// Optional so a single-vault server costs no extra call: when omitted, the
// server uses its only vault, and refuses (listing the choices) when there
// are several. See VaultConnections.context().
const VaultId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/)
  .optional()
  .describe("Vault id from obsidian_list_vaults. May be omitted when the server has exactly one vault.");

export function withVaultId(schema: z.AnyZodObject | z.ZodDiscriminatedUnion<string, any>): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) return schema.extend({ vault_id: VaultId });
  const options = schema.options.map((option: z.AnyZodObject) => option.extend({ vault_id: VaultId }));
  return z.discriminatedUnion(schema.discriminator, options as [z.AnyZodObject, ...z.AnyZodObject[]]);
}
