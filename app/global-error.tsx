"use client";

import Link from "next/link";

export default function GlobalError() {
  return <html lang="en"><body style={{ background: "#f7f5f1", color: "#173346", fontFamily: "system-ui, sans-serif", margin: 0 }}><main style={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "24px" }}><section style={{ maxWidth: "520px", textAlign: "center" }} role="alert"><p style={{ color: "#a56d52", fontSize: "11px", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>SecureVisit</p><h1>SecureVisit is temporarily unavailable</h1><p style={{ color: "#687b83", lineHeight: 1.6 }}>Please refresh this page or return shortly. No visit or payment action was confirmed by this screen.</p><Link href="/" style={{ color: "#b84d24", fontWeight: 700 }}>Return to SecureVisit</Link></section></main></body></html>;
}
