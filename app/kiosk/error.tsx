"use client";

import { useEffect } from "react";

export default function KioskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SecureVisit kiosk route error", { digest: error.digest });
  }, [error.digest]);

  return <main style={{ alignItems: "center", background: "#071f30", color: "#fff", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "28px" }}>
    <section role="alert" style={{ maxWidth: "520px", textAlign: "center", width: "100%" }}>
      <p style={{ color: "#f47c32", fontSize: "11px", fontWeight: 800, letterSpacing: ".14em", margin: "0 0 12px", textTransform: "uppercase" }}>SecureVisit Kiosk</p>
      <h1 style={{ fontSize: "30px", letterSpacing: "-.04em", margin: "0 0 12px" }}>This kiosk screen needs to reconnect</h1>
      <p style={{ color: "#b4c6cd", lineHeight: 1.6, margin: 0 }}>The visit was not confirmed by this screen. Check the device connection, then try again or return to the controlled-device start screen.</p>
      <button type="button" onClick={() => reset()} style={{ background: "#f47c32", border: 0, borderRadius: "9px", color: "#092638", cursor: "pointer", fontWeight: 800, marginTop: "24px", padding: "13px 20px" }}>Retry kiosk screen</button>
    </section>
  </main>;
}
