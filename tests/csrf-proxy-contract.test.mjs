import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("central API proxy enforces the cookie mutation CSRF boundary", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /isSameOriginMutation\(request, process\.env\.PUBLIC_APP_URL/);
  assert.match(source, /CSRF_ORIGIN_MISMATCH/);
  assert.match(source, /matcher: \["\/api\/:path\*"\]/);
  assert.match(source, /NextResponse\.next\(\)/);
});
