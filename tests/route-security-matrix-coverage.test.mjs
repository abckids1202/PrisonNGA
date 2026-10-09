import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const apiRoot = path.resolve("app/api");
const matrixPath = path.resolve("docs/ROUTE_SECURITY_MATRIX.md");

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await routeFiles(fullPath));
    else if (entry.name === "route.ts") files.push(fullPath);
  }
  return files;
}

function routePathFromFile(file) {
  const relative = path.relative(apiRoot, file).replaceAll(path.sep, "/");
  return `/api/${relative.slice(0, -"/route.ts".length)}`.replace(/\[([^\]]+)\]/g, ":$1");
}

function matrixPatterns(markdown) {
  return markdown.split("\n")
    .filter((line) => line.startsWith("| `/api"))
    .map((line) => line.slice(1, line.indexOf("|", 1)).trim())
    .flatMap((cell) => cell.split(",").map((pattern) => pattern.trim().replace(/^`|`$/g, "")))
    .filter(Boolean);
}

function matches(pattern, route) {
  if (!pattern.includes("*")) return pattern === route;
  const prefix = pattern.slice(0, pattern.indexOf("*"));
  return route.startsWith(prefix);
}

test("every API route is represented in the security matrix", async () => {
  const [files, markdown] = await Promise.all([routeFiles(apiRoot), readFile(matrixPath, "utf8")]);
  const patterns = matrixPatterns(markdown);
  const uncovered = files.map(routePathFromFile).filter((route) => !patterns.some((pattern) => matches(pattern, route)));
  assert.deepEqual(uncovered, [], `Add a security-matrix row before shipping a new route: ${uncovered.join(", ")}`);
});
