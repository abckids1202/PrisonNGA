import AccessReviewPanel from "../../components/AccessReviewPanel";

export default function AccessReviewPage() {
  return <main className="sv3-page-scroll">
    <div className="sv3-page-header">
      <div><span className="sv3-eyebrow">Management · Security</span><h1>Access review</h1><p>Review facility staff access, role assignments, sign-in recency, and active sessions.</p></div>
      <div className="sv3-header-actions"><span className="sv3-status sv3-status-blue">FACILITY SCOPED</span></div>
    </div>
    <AccessReviewPanel />
  </main>;
}
