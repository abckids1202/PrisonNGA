import { getRuntimeValue } from "./security";

export type ReleaseInfo = {
  releaseId: string;
  buildId: string | null;
  migrationVersion: number | null;
  migrationName: string | null;
};

/**
 * Read the immutable application identity used by deployment and rollback
 * tooling. The migration value is read from D1 so readiness can distinguish a
 * new worker running against an old schema from a fully applied release.
 */
export async function getReleaseInfo(d1: D1Database): Promise<ReleaseInfo> {
  const [configuredReleaseId, buildId] = await Promise.all([
    getRuntimeValue("SECUREVISIT_RELEASE_ID"),
    getRuntimeValue("SECUREVISIT_BUILD_ID"),
  ]);
  let migration: { id: number; name: string } | null = null;
  try {
    migration = await d1.prepare("SELECT id, name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ id: number; name: string }>();
  } catch {
    // The readiness schema check reports the missing migration table. Do not
    // hide that useful diagnostic behind a generic database failure response.
  }

  return {
    releaseId: configuredReleaseId?.trim() || "unversioned",
    buildId: buildId?.trim() || null,
    migrationVersion: typeof migration?.id === "number" ? migration.id : null,
    migrationName: migration?.name || null,
  };
}
