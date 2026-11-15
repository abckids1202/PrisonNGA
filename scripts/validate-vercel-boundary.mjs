const value = (name) => String(process.env[name] || "").trim();

function assertOrigin(name, raw) {
  if (!raw) throw new Error(`${name} is required for a Vercel deployment`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be a valid HTTPS origin`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query, or fragment`);
  }
  return url.origin;
}

const isVercelBuild = value("VERCEL") === "1" || value("SECUREVISIT_VERCEL_DEPLOYMENT") === "true";
if (!isVercelBuild) {
  console.log("Vercel boundary validation skipped outside a Vercel deployment.");
} else {
  const environment = value("SECUREVISIT_ENVIRONMENT").toLowerCase();
  if (!['staging', 'production'].includes(environment)) {
    throw new Error("SECUREVISIT_ENVIRONMENT must be staging or production for a Vercel deployment");
  }
  const frontendOrigin = assertOrigin("PUBLIC_APP_URL", value("PUBLIC_APP_URL"));
  const workerOrigin = assertOrigin("WORKER_API_ORIGIN", value("WORKER_API_ORIGIN"));
  console.log(JSON.stringify({ valid: true, environment, frontendOrigin, workerOrigin, rewriteRequired: frontendOrigin !== workerOrigin }, null, 2));
}
