export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite" style={{ alignItems: "center", background: "#f4f7f6", color: "#092638", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "32px" }}>
      <div style={{ background: "#ffffff", border: "1px solid #dce6e4", borderRadius: "16px", maxWidth: "440px", padding: "32px", textAlign: "center", width: "100%" }}>
        <div aria-hidden="true" style={{ background: "#f47c32", borderRadius: "999px", height: "10px", margin: "0 auto 20px", width: "72px" }} />
        <p style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", margin: "0 0 10px", textTransform: "uppercase" }}>SecureVisit</p>
        <p style={{ color: "#60747d", margin: 0 }}>Loading your secure workspace…</p>
      </div>
    </main>
  );
}
