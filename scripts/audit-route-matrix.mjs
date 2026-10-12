import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repositoryRoot = resolve(scriptDirectory, "..");

async function collectRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const pathname = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectRouteFiles(pathname));
    else if (entry.isFile() && entry.name === "route.ts") files.push(pathname);
  }
  return files;
}

function routePathFromFile(pathname, apiRoot) {
  const relativePath = relative(apiRoot, pathname).split(sep).join("/");
  const segments = relativePath.split("/");
  segments.pop();
  return `/api/${segments.join("/")}`;
}

function normalizeParameterSegments(pathname) {
  return pathname.split("/").map((segment) => segment.replace(/^\[[^\]]+\]$/, ":param"));
}

export function routeMatchesMatrixPattern(routePath, pattern) {
  if (pattern.endsWith("*") && !pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return routePath === prefix || routePath.startsWith(`${prefix}/`);
  }
  const route = normalizeParameterSegments(routePath);
  const matrix = normalizeParameterSegments(pattern);
  function match(routeIndex, matrixIndex) {
    if (matrixIndex === matrix.length) return routeIndex === route.length;
    if (matrix[matrixIndex] === "*") {
      if (matrixIndex === matrix.length - 1) return routeIndex < route.length;
      for (let nextRouteIndex = routeIndex; nextRouteIndex < route.length; nextRouteIndex += 1) {
        if (match(nextRouteIndex + 1, matrixIndex + 1)) return true;
      }
      return false;
    }
    if (routeIndex === route.length) return false;
    return (route[routeIndex] === matrix[matrixIndex] || matrix[matrixIndex].startsWith(":"))
      && match(routeIndex + 1, matrixIndex + 1);
  }
  return match(0, 0);
}

export async function auditRouteMatrix({ root = repositoryRoot } = {}) {
  const apiRoot = resolve(root, "app", "api");
  const matrixPath = resolve(root, "docs", "ROUTE_SECURITY_MATRIX.md");
  const [routeFiles, matrixSource] = await Promise.all([
    collectRouteFiles(apiRoot),
    readFile(matrixPath, "utf8"),
  ]);
  const patterns = [...matrixSource.matchAll(/^\|\s+(.*?)\s+\|/gm)]
    .flatMap((match) => [...match[1].matchAll(/`([^`]+)`/g)].map((routeMatch) => routeMatch[1]));
  const routes = routeFiles.map((pathname) => routePathFromFile(pathname, apiRoot)).sort();
  const uncoveredRoutes = routes.filter((route) => !patterns.some((pattern) => routeMatchesMatrixPattern(route, pattern)));
  return { routes, patterns, uncoveredRoutes, ok: uncoveredRoutes.length === 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await auditRouteMatrix();
  console.log(JSON.stringify({
    routeCount: result.routes.length,
    matrixPatternCount: result.patterns.length,
    uncoveredRoutes: result.uncoveredRoutes,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}
