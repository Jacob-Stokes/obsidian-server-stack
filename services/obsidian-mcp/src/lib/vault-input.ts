import { z } from "zod";

const VaultId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/)
  .describe("Stable vault id from obsidian_list_vaults; required even when only one vault is connected.");

export function withVaultId(schema: z.AnyZodObject | z.ZodDiscriminatedUnion<string, any>): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) return schema.extend({ vault_id: VaultId });
  const options = schema.options.map((option: z.AnyZodObject) => option.extend({ vault_id: VaultId }));
  return z.discriminatedUnion(schema.discriminator, options as [z.AnyZodObject, ...z.AnyZodObject[]]);
}
