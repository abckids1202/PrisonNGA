export default function VisitorLoading() {
  return (
    <main aria-busy="true" aria-live="polite" style={{ background: "#fffaf6", color: "#092638", minHeight: "100vh", padding: "28px 20px" }}>
      <div style={{ margin: "0 auto", maxWidth: "760px" }}>
        <p style={{ color: "#b85f2c", fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", margin: "0 0 14px", textTransform: "uppercase" }}>SecureVisit Visitor</p>
        <div aria-hidden="true" style={{ background: "#f3e5dc", borderRadius: "12px", height: "30px", marginBottom: "12px", maxWidth: "430px", width: "78%" }} />
        <div aria-hidden="true" style={{ background: "#f7eee9", borderRadius: "8px", height: "18px", marginBottom: "28px", maxWidth: "620px", width: "92%" }} />
        <p style={{ color: "#60747d", margin: 0 }}>Preparing your visits and account…</p>
      </div>
    </main>
  );
}
