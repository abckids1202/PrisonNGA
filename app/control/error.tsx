"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ControlError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SecureVisit control route error", { digest: error.digest });
  }, [error.digest]);

  return <main style={{ alignItems: "center", background: "#f4f7f6", color: "#092638", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>
    <section role="alert" style={{ background: "#fff", border: "1px solid #dce6e4", borderRadius: "16px", maxWidth: "520px", padding: "36px", textAlign: "center", width: "100%" }}>
      <p style={{ color: "#547986", fontSize: "11px", fontWeight: 800, letterSpacing: ".12em", margin: "0 0 10px", textTransform: "uppercase" }}>SecureVisit Control</p>
      <h1 style={{ fontSize: "28px", letterSpacing: "-.04em", margin: "0 0 10px" }}>This workspace needs to reload</h1>
      <p style={{ color: "#687b83", lineHeight: 1.6, margin: 0 }}>No appointment, facility, or audit action was confirmed by this screen. Try again or return to the protected workspace.</p>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "24px" }}>
        <button type="button" onClick={() => reset()} style={{ background: "#f47c32", border: 0, borderRadius: "9px", color: "#092638", cursor: "pointer", fontWeight: 700, padding: "12px 18px" }}>Try again</button>
        <Link href="/" style={{ border: "1px solid #d9e2e1", borderRadius: "9px", color: "#36525e", fontWeight: 700, padding: "11px 18px", textDecoration: "none" }}>Return to Control</Link>
      </div>
    </section>
  </main>;
}
