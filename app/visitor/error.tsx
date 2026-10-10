"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function VisitorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SecureVisit visitor route error", { digest: error.digest });
  }, [error.digest]);

  return <main style={{ alignItems: "center", background: "#fffaf6", color: "#092638", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>
    <section role="alert" style={{ background: "#fff", border: "1px solid #eadfd8", borderRadius: "18px", boxShadow: "0 18px 50px rgba(23,51,70,.08)", maxWidth: "520px", padding: "36px", textAlign: "center", width: "100%" }}>
      <p style={{ color: "#b85f2c", fontSize: "11px", fontWeight: 800, letterSpacing: ".12em", margin: "0 0 10px", textTransform: "uppercase" }}>SecureVisit Visitor</p>
      <h1 style={{ fontSize: "28px", letterSpacing: "-.04em", margin: "0 0 10px" }}>We couldn’t load this visit page</h1>
      <p style={{ color: "#687b83", lineHeight: 1.6, margin: 0 }}>Your saved visits and credits were not changed. Try again, or return to your visitor home.</p>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "24px" }}>
        <button type="button" onClick={() => reset()} style={{ background: "#f47c32", border: 0, borderRadius: "9px", color: "#092638", cursor: "pointer", fontWeight: 700, padding: "12px 18px" }}>Try again</button>
        <Link href="/visitor" style={{ border: "1px solid #ded5cf", borderRadius: "9px", color: "#36525e", fontWeight: 700, padding: "11px 18px", textDecoration: "none" }}>Visitor home</Link>
      </div>
    </section>
  </main>;
}
