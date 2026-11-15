import { getRuntimeValue } from "./security";

const TEST_NOW_HEADER = "x-securevisit-test-now";

/** Local-only clock override for the disposable browser acceptance worker. */
export async function getRequestNow(request: Request): Promise<number> {
  if (process.env.SECUREVISIT_E2E_ISOLATED !== "true") return Date.now();
  if ((await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development") return Date.now();
  const parsed = Date.parse(request.headers.get(TEST_NOW_HEADER) || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}
