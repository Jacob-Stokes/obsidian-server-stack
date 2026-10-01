import type { ToolRegistration } from "./lib/transport.js";
import { z } from "zod";
import { type VaultConnections } from "./lib/connections.js";
import { withVaultId } from "./lib/vault-input.js";
// One MCP tool set across every vault in the registry. Each content tool
// takes an explicit vault_id; obsidian_list_vaults is how a client finds them.

import { ATTACHMENTS_TOOL, AttachmentsInput, handleAttachments } from "./tools/attachments.js";
import { BULK_TOOL, BulkInput, handleBulk } from "./tools/bulk.js";
import { DAILY_TOOL, DailyInput, handleDaily } from "./tools/daily.js";
import { FILES_TOOL, FilesInput, handleFiles } from "./tools/files.js";
import { FOLDERS_TOOL, FoldersInput, handleFolders } from "./tools/folders.js";
import { handleLinks, LINKS_TOOL, LinksInput } from "./tools/links.js";
import {
  FRONTMATTER_TOOL,
  FrontmatterInput,
  handleFrontmatter,
  handleTags,
  TAGS_TOOL,
  TagsInput
} from "./tools/metadata.js";
import {
  APPEND_NOTE_TOOL,
  AppendNoteInput,
  DELETE_NOTE_TOOL,
  DeleteNoteInput,
  GET_NOTE_TOOL,
  GetNoteInput,
  handleAppendNote,
  handleDeleteNote,
  handleGetNote,
  handleListNotes,
  handleMoveNote,
  handlePatchNote,
  handleReplaceNote,
  handleWriteNote,
  LIST_NOTES_TOOL,
  ListNotesInput,
  MOVE_NOTE_TOOL,
  MoveNoteInput,
  PATCH_NOTE_TOOL,
  PatchNoteInput,
  REPLACE_NOTE_TOOL,
  ReplaceNoteInput,
  WRITE_NOTE_TOOL,
  WriteNoteInput
} from "./tools/notes.js";
import { SEARCH_TOOL, SearchInput } from "./tools/search.js";
import { handleSearchNotes, SEARCH_NOTES_TOOL, SearchNotesInput } from "./tools/search-notes.js";
import { handleStatus, STATUS_TOOL, StatusInput } from "./tools/status.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const IDEMPOTENT_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
} as const;
const MUTATING = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function obsidianTools(connections: VaultConnections): ToolRegistration[] {
  return [
    {
      def: {
        name: "obsidian_list_vaults",
        description:
          "List the vaults this server can reach (id, name, sync source). Optionally find one by name or id. Use its id as vault_id for every other tool; disabled or missing vaults are omitted.",
        inputSchema: z.object({ query: z.string().max(120).optional() }),
        annotations: READ_ONLY
      },
      handler: async (input) => ({ vaults: await connections.list(input.query) })
    },
    {
      def: { ...GET_NOTE_TOOL, inputSchema: withVaultId(GetNoteInput), annotations: READ_ONLY },
      handler: async (i) => handleGetNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...LIST_NOTES_TOOL, inputSchema: withVaultId(ListNotesInput), annotations: READ_ONLY },
      handler: async (i) => handleListNotes(await connections.context(i.vault_id), i)
    },
    {
      def: { ...SEARCH_NOTES_TOOL, inputSchema: withVaultId(SearchNotesInput), annotations: READ_ONLY },
      handler: async (i) => handleSearchNotes(await connections.context(i.vault_id), i)
    },
    {
      def: { ...WRITE_NOTE_TOOL, inputSchema: withVaultId(WriteNoteInput), annotations: IDEMPOTENT_WRITE },
      handler: async (i) => handleWriteNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...APPEND_NOTE_TOOL, inputSchema: withVaultId(AppendNoteInput), annotations: MUTATING },
      handler: async (i) => handleAppendNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...PATCH_NOTE_TOOL, inputSchema: withVaultId(PatchNoteInput), annotations: MUTATING },
      handler: async (i) => handlePatchNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...REPLACE_NOTE_TOOL, inputSchema: withVaultId(ReplaceNoteInput), annotations: IDEMPOTENT_WRITE },
      handler: async (i) => handleReplaceNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...MOVE_NOTE_TOOL, inputSchema: withVaultId(MoveNoteInput), annotations: MUTATING },
      handler: async (i) => handleMoveNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...DELETE_NOTE_TOOL, inputSchema: withVaultId(DeleteNoteInput), annotations: MUTATING },
      handler: async (i) => handleDeleteNote(await connections.context(i.vault_id), i)
    },
    {
      def: { ...FRONTMATTER_TOOL, inputSchema: withVaultId(FrontmatterInput), annotations: IDEMPOTENT_WRITE },
      handler: async (i) => handleFrontmatter(await connections.context(i.vault_id), i)
    },
    {
      def: { ...TAGS_TOOL, inputSchema: withVaultId(TagsInput), annotations: IDEMPOTENT_WRITE },
      handler: async (i) => handleTags(await connections.context(i.vault_id), i)
    },
    {
      def: { ...LINKS_TOOL, inputSchema: withVaultId(LinksInput), annotations: READ_ONLY },
      handler: async (i) => handleLinks(await connections.context(i.vault_id), i)
    },
    {
      def: { ...BULK_TOOL, inputSchema: withVaultId(BulkInput), annotations: MUTATING },
      handler: async (i) => handleBulk(await connections.context(i.vault_id), i)
    },
    {
      def: { ...DAILY_TOOL, inputSchema: withVaultId(DailyInput), annotations: MUTATING },
      handler: async (i) => handleDaily(await connections.context(i.vault_id), i)
    },
    {
      def: { ...ATTACHMENTS_TOOL, inputSchema: withVaultId(AttachmentsInput), annotations: MUTATING },
      handler: async (i) => handleAttachments(await connections.context(i.vault_id), i)
    },
    {
      def: { ...STATUS_TOOL, inputSchema: withVaultId(StatusInput), annotations: READ_ONLY },
      handler: async (i) => handleStatus(await connections.context(i.vault_id))
    },

    // Compatibility aliases retained for existing agents and automations.
    {
      def: { ...FILES_TOOL, inputSchema: withVaultId(FilesInput), annotations: MUTATING },
      handler: async (i) => handleFiles(await connections.context(i.vault_id), i)
    },
    {
      def: { ...FOLDERS_TOOL, inputSchema: withVaultId(FoldersInput), annotations: READ_ONLY },
      handler: async (i) => handleFolders(await connections.context(i.vault_id), i)
    },
    {
      def: { ...SEARCH_TOOL, inputSchema: withVaultId(SearchInput), annotations: READ_ONLY },
      handler: async (i) =>
        handleSearchNotes(await connections.context(i.vault_id), {
          mode: i.regex ? "regex" : "text",
          query: i.q,
          path: i.path,
          case_sensitive: i.case_sensitive,
          max_results: i.max_results,
          max_scan: 1000
        })
    }
  ];
}
