export class PreservationError extends Error {}

export const hasHan = (text) => /\p{Script=Han}/u.test(text);
export const hasUnsupportedLetters = (text) => [...text].some((character) =>
  /\p{Letter}/u.test(character) && !/[\p{Script=Han}\p{Script=Latin}]/u.test(character));

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (value) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[value]);
}

// Keep a whole mixed sentence available to the translator. The non-Han runs
// containing Latin letters (including their spelling/case/URLs) are protected.
export function protect(text) {
  const fragments = [];
  let html = "<div>";
  for (const match of text.matchAll(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)) {
    const part = match[0];
    if (/\p{Script=Latin}/u.test(part)) {
      const id = fragments.length;
      fragments.push(part);
      html += `<span class="notranslate" translate="no" data-ba-id="${id}">${escapeHtml(part)}</span>`;
    } else {
      html += escapeHtml(part);
    }
  }
  return { html: html + "</div>", fragments };
}

function decodeEntities(text) {
  // This is deliberately a small, fail-closed grammar, not a general HTML
  // renderer. Azure output outside our generated div/span grammar is rejected.
  return text.replace(/&[^;\s]*;|&/g, (entity) => {
    const known = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
      "&apos;": "'", "&nbsp;": "\u00a0" };
    if (known[entity] !== undefined) return known[entity];
    const match = /^&#(x[0-9a-f]+|[0-9]+);$/i.exec(entity);
    if (!match) throw new PreservationError("Unsupported HTML entity");
    const value = match[1][0].toLowerCase() === "x"
      ? parseInt(match[1].slice(1), 16) : Number(match[1]);
    if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
      throw new PreservationError("Invalid HTML entity");
    }
    return String.fromCodePoint(value);
  });
}

export function restore(html, fragments) {
  if (typeof html !== "string" || html.length > 250000) throw new PreservationError("Invalid output");
  const stack = [];
  const found = new Set();
  let result = "";
  let protectedText = "";
  let protectedId = null;
  let rootSeen = false;
  let rootClosed = false;
  for (const token of html.matchAll(/<[^>]*>|[^<]+|</g)) {
    const value = token[0];
    if (!value.startsWith("<")) {
      if (rootClosed || !rootSeen) {
        if (value.trim()) throw new PreservationError("Text outside root");
        continue;
      }
      const plain = decodeEntities(value);
      if (protectedId !== null) protectedText += plain;
      else result += plain;
      continue;
    }
    const close = /^<\/(div|span)\s*>$/i.exec(value);
    if (close) {
      const name = close[1].toLowerCase();
      if (stack.pop() !== name) throw new PreservationError("Unbalanced tags");
      if (name === "span") {
        if (protectedId === null || protectedText !== fragments[protectedId]) {
          throw new PreservationError("Protected English changed");
        }
        result += fragments[protectedId];
        protectedText = "";
        protectedId = null;
      } else rootClosed = true;
      continue;
    }
    const open = /^<(div|span)((?:\s+[a-z][a-z0-9-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*>$/i.exec(value);
    if (!open || rootClosed) throw new PreservationError("Unsupported HTML");
    const name = open[1].toLowerCase();
    const attributes = new Map();
    for (const attribute of open[2].matchAll(/([a-z][a-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/gi)) {
      const key = attribute[1].toLowerCase();
      if (attributes.has(key)) throw new PreservationError("Duplicate attribute");
      attributes.set(key, attribute[2] ?? attribute[3]);
    }
    if (name === "div") {
      if (rootSeen || stack.length || attributes.size) throw new PreservationError("Invalid root");
      rootSeen = true;
    } else {
      if (stack.length !== 1 || stack[0] !== "div") throw new PreservationError("Invalid protected tag");
      if ([...attributes.keys()].some((key) => !["class", "translate", "data-ba-id"].includes(key))) {
        throw new PreservationError("Unknown attribute");
      }
      const idText = attributes.get("data-ba-id");
      if (!/^(0|[1-9][0-9]*)$/.test(idText ?? "")) throw new PreservationError("Missing protected id");
      const id = Number(idText);
      if (id >= fragments.length || found.has(id)) throw new PreservationError("Duplicate protected id");
      found.add(id);
      protectedId = id;
    }
    stack.push(name);
  }
  if (!rootSeen || !rootClosed || stack.length || found.size !== fragments.length || !result.trim()) {
    throw new PreservationError("Incomplete protected result");
  }
  return result;
}
