import assert from "node:assert/strict";
import test from "node:test";

import { mergeFrontmatter, sliceFrontmatter } from "./frontmatter.mjs";

test("frontmatter updates preserve the note body", () => {
  const original = "---\ntags:\n  - old\ntitle: Existing\n---\n# Body\n";
  const updated = mergeFrontmatter(original, { tags: "research", title: null });
  assert.equal(updated, "---\ntags: research\n---\n# Body\n");
  assert.equal(sliceFrontmatter(updated), "---\ntags: research\n---");
});

test("frontmatter is added to a plain note", () => {
  assert.equal(mergeFrontmatter("# Body\n", { reviewed: true }), "---\nreviewed: true\n---\n# Body\n");
});
