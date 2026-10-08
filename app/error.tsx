"use client";

import { useEffect } from "react";
import Link from "next/link";

type BoundaryError = Error & { digest?: string };

export default function ErrorBoundary({ error, reset }: { error: BoundaryError; reset: () => void }) {
  useEffect(() => {
    // Keep the visitor-facing message generic. The runtime can be connected
    // to an error-monitoring provider later without exposing server details.
    console.error("SecureVisit route error", { digest: error.digest });
  }, [error.digest]);

  return <main style={{ alignItems: "center", background: "#f7f5f1", color: "#173346", display: "flex", fontFamily: "system-ui, sans-serif", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>
    <section style={{ background: "#fff", border: "1px solid #e4e0da", borderRadius: "16px", boxShadow: "0 18px 50px rgba(23,51,70,.10)", maxWidth: "520px", padding: "36px", textAlign: "center", width: "100%" }} role="alert">
      <span style={{ alignItems: "center", background: "#fff0e8", borderRadius: "50%", color: "#c9552f", display: "inline-flex", fontSize: "24px", height: "56px", justifyContent: "center", width: "56px" }}>!</span>
      <p style={{ color: "#a56d52", fontSize: "11px", fontWeight: 800, letterSpacing: ".12em", margin: "20px 0 8px", textTransform: "uppercase" }}>SecureVisit</p>
      <h1 style={{ fontSize: "28px", letterSpacing: "-.04em", margin: "0 0 10px" }}>Something went wrong</h1>
      <p style={{ color: "#687b83", lineHeight: 1.6, margin: 0 }}>This page could not finish loading. Your saved visit information has not been changed.</p>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "24px" }}>
        <button type="button" onClick={() => reset()} style={{ background: "#f26b38", border: 0, borderRadius: "8px", color: "#0b2033", cursor: "pointer", fontWeight: 700, padding: "12px 18px" }}>Try again</button>
        <Link href="/" style={{ border: "1px solid #d9d5cf", borderRadius: "8px", color: "#36525e", fontWeight: 700, padding: "11px 18px", textDecoration: "none" }}>Return home</Link>
      </div>
    </section>
  </main>;
}
