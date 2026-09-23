export async function purgeExpiredAuthArtifacts(db: Pick<D1Database, "prepare" | "batch">): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= CURRENT_TIMESTAMP OR (consumed_at IS NOT NULL AND consumed_at <= datetime('now', '-1 day'))"),
    db.prepare("DELETE FROM auth_federation_states WHERE expires_at <= CURRENT_TIMESTAMP OR (consumed_at IS NOT NULL AND consumed_at <= datetime('now', '-1 day'))"),
    db.prepare("DELETE FROM saml_request_cache WHERE created_at <= datetime('now', '-1 day')"),
  ]);
}
