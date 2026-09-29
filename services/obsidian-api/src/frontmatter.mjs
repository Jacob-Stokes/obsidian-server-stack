/** Merge a scalar patch while preserving the note body and existing field order. */
export function mergeFrontmatter(original, patch) {
  const fenceStart = "---\n";
  const closingFence = "\n---";
  let block;
  let rest;
  let hadFrontmatter;
  if (original.startsWith(fenceStart)) {
    const end = original.indexOf(closingFence, fenceStart.length);
    if (end === -1) {
      hadFrontmatter = false;
      block = "";
      rest = original;
    } else {
      hadFrontmatter = true;
      block = original.slice(fenceStart.length, end);
      rest = original.slice(end + closingFence.length);
    }
  } else {
    hadFrontmatter = false;
    block = "";
    rest = original;
  }

  const lines = block.length > 0 ? block.split("\n") : [];
  for (const [key, value] of Object.entries(patch)) {
    const { start, end } = findKeyBlock(lines, key);
    if (value === null) {
      if (start !== -1) lines.splice(start, end - start + 1);
      continue;
    }
    const formatted = `${key}: ${formatScalar(value)}`;
    if (start === -1) lines.push(formatted);
    else lines.splice(start, end - start + 1, formatted);
  }

  const newBlock = lines.join("\n");
  if (!hadFrontmatter) {
    return `${fenceStart}${newBlock}\n---\n${rest.startsWith("\n") ? rest.slice(1) : rest}`;
  }
  return `${fenceStart}${newBlock}${closingFence}${rest}`;
}

export function sliceFrontmatter(full) {
  if (!full.startsWith("---\n")) return "";
  const end = full.indexOf("\n---", 4);
  if (end === -1) return "";
  return full.slice(0, end + 4);
}

function findKeyBlock(lines, key) {
  const keyPattern = new RegExp(`^${escapeRegex(key)}:\\s*(.*)$`);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(keyPattern);
    if (!match) continue;
    let end = index;
    if ((match[1] ?? "").trim() === "") {
      while (end + 1 < lines.length && /^\s{2,}-\s/.test(lines[end + 1])) end++;
    }
    return { start: index, end };
  }
  return { start: -1, end: -1 };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatScalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const needsQuotes =
    /[:#\[\]{} ,&*!|>'"`%@]/.test(value) ||
    /^\s|\s$/.test(value) ||
    value === "" ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    /^-?\d/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
