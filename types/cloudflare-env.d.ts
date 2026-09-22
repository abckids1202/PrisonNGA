declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EVIDENCE_BUCKET?: R2Bucket;
  }
}
