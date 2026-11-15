import test from "node:test";
import assert from "node:assert/strict";
import { protect, restore, PreservationError, hasUnsupportedLetters } from "../src/protection.mjs";

test("mixed spelling/case, URL and literal HTML survive protection exactly", () => {
  const text = '学习 Android Studio 和 teh API；网址 https://example.com/a?x=1&y=2。<script>alert("x")</script>';
  const { html, fragments } = protect(text);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(restore(html, fragments), text);
  const translated = html.replace("学习", "Learn").replace("和", "and").replace("网址", "website");
  const result = restore(translated, fragments);
  for (const part of fragments) assert.ok(result.includes(part));
  assert.ok(result.includes("teh API"));
  assert.ok(result.includes('<script>alert("x")</script>'));
});

test("protected fragment mutation, missing/duplicate tags and injected HTML fail closed", () => {
  const { html, fragments } = protect("学习 API 再读 English。");
  const invalid = [html.replace("API", "Api"), html.replace(/<span[^>]*>[\s\S]*?<\/span>/, ""),
    html.replace('data-ba-id="1"', 'data-ba-id="0"'), html.replace("</div>", "<script>x</script></div>"),
    html.replace("</span>", ""), html.replace("</div>", "&madeup;</div>"),
    html.replace("<div>", '<div onclick="x">')];
  for (const candidate of invalid) assert.throws(() => restore(candidate, fragments), PreservationError);
});

test("plain translated Chinese output and numeric entities decode without executing tags", () => {
  assert.equal(restore("<div>Hello &#x1F600; &lt;b&gt;world&lt;/b&gt;</div>", []), "Hello 😀 <b>world</b>");
  assert.equal(hasUnsupportedLetters("中文 English café 😀"), false);
  assert.equal(hasUnsupportedLetters("中文 русский"), true);
});
