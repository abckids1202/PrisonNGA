import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ alignItems: "center", background: "#f4f7f6", color: "#092638", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "32px" }}>
      <section aria-labelledby="not-found-title" style={{ background: "#ffffff", border: "1px solid #dce6e4", borderRadius: "16px", maxWidth: "520px", padding: "36px", width: "100%" }}>
        <p style={{ color: "#b85f2c", fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", margin: "0 0 12px", textTransform: "uppercase" }}>SecureVisit</p>
        <h1 id="not-found-title" style={{ fontSize: "30px", letterSpacing: "-0.03em", margin: "0 0 12px" }}>That page is unavailable</h1>
        <p style={{ color: "#60747d", lineHeight: 1.6, margin: "0 0 24px" }}>The link may be out of date, or the visit record may no longer be available. Your account and visit data have not been changed.</p>
        <Link href="/" style={{ background: "#092638", borderRadius: "10px", color: "#ffffff", display: "inline-block", fontWeight: 700, padding: "12px 16px", textDecoration: "none" }}>Return to SecureVisit</Link>
      </section>
    </main>
  );
}
