"use client";

import { useMemo, useState } from "react";

type NavItem = {
  label: string;
  icon: string;
  count?: number;
};

type Request = {
  id: string;
  visitor: string;
  initials: string;
  relationship: string;
  prisoner: string;
  prisonerId: string;
  date: string;
  time: string;
  tone: "mint" | "peach" | "lavender";
};

const primaryNav: NavItem[] = [
  { label: "Overview", icon: "⌂" },
  { label: "Appointments", icon: "◷", count: 12 },
  { label: "Visitors", icon: "♙", count: 6 },
  { label: "Prisoners", icon: "▦" },
];

const operationsNav: NavItem[] = [
  { label: "Credits & payments", icon: "◈" },
  { label: "Audit log", icon: "≡" },
  { label: "Settings", icon: "⚙" },
];

const initialRequests: Request[] = [
  {
    id: "REQ-2048",
    visitor: "Alya Pratama",
    initials: "AP",
    relationship: "Sister",
    prisoner: "Rafi Pratama",
    prisonerId: "LPS-JKT-004821",
    date: "Today",
    time: "10:40–11:00",
    tone: "mint",
  },
  {
    id: "REQ-2047",
    visitor: "Dimas Wirawan",
    initials: "DW",
    relationship: "Legal representative",
    prisoner: "Bima Aditya",
    prisonerId: "LPS-JKT-003118",
    date: "Today",
    time: "11:20–11:40",
    tone: "peach",
  },
  {
    id: "REQ-2046",
    visitor: "Nurul Hidayah",
    initials: "NH",
    relationship: "Mother",
    prisoner: "Fajar Hidayat",
    prisonerId: "LPS-JKT-005204",
    date: "Tomorrow",
    time: "09:00–09:20",
    tone: "lavender",
  },
];

const agenda = [
  { time: "09:00", name: "Maya & R. Santoso", room: "Room 03", type: "Family", status: "In 18 min", color: "blue" },
  { time: "09:30", name: "S. Rahman & A. Rahman", room: "Room 01", type: "Family", status: "Confirmed", color: "green" },
  { time: "10:00", name: "K. Wijaya & D. Wijaya", room: "Room 04", type: "Family", status: "Confirmed", color: "green" },
  { time: "10:40", name: "Alya Pratama", room: "Pending", type: "Review", status: "Needs review", color: "orange" },
];

function Avatar({ initials, tone = "mint", small = false }: { initials: string; tone?: string; small?: boolean }) {
  return <span className={`avatar avatar-${tone} ${small ? "avatar-small" : ""}`}>{initials}</span>;
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status status-${tone}`}><span className="status-dot" />{children}</span>;
}

type MockPageProps = { section: string; onNotify: (message: string) => void };

function MockPage({ section, onNotify }: MockPageProps) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [toggles, setToggles] = useState({ recording: true, reminders: true, mfa: true });

  const pageCopy: Record<string, { kicker: string; title: string; description: string }> = {
    Appointments: { kicker: "Scheduling workspace", title: "Appointments", description: "Review, approve, and coordinate every visit across the facility." },
    Visitors: { kicker: "Identity & relationships", title: "Visitors", description: "Keep visitor verification and prisoner relationships moving safely." },
    Prisoners: { kicker: "Fictional records", title: "Prisoners", description: "Manage visitation eligibility without exposing restricted custody data." },
    "Credits & payments": { kicker: "Mock financial ledger", title: "Credits & payments", description: "Track visit credits and reconciliation with a transparent ledger." },
    "Audit log": { kicker: "Compliance workspace", title: "Audit log", description: "A chronological record of sensitive actions across Central Facility." },
    Settings: { kicker: "Facility configuration", title: "Settings", description: "Define the rules that keep every visit controlled and accountable." },
  };
  const copy = pageCopy[section] ?? pageCopy.Appointments;

  function toggle(key: "recording" | "reminders" | "mfa") {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
    onNotify(`${key === "mfa" ? "Staff MFA" : key === "recording" ? "Recording policy" : "Visitor reminders"} setting updated.`);
  }

  return (
    <section className="mock-page">
      <div className="mock-heading">
        <div><span className="eyebrow">{copy.kicker}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
        <div className="heading-actions"><button className="secondary-button" onClick={() => onNotify("A report export is being prepared.")}>↓ <span>Export</span></button><button className="primary-button" onClick={() => onNotify(`New ${section.toLowerCase()} flow opened.`)}>+ <span>{section === "Settings" ? "Save changes" : "Create new"}</span></button></div>
      </div>

      {section === "Appointments" ? <>
        <div className="mock-stat-row"><div><span>Today</span><strong>18</strong><small><em>+12%</em> vs last week</small></div><div><span>Needs review</span><strong>12</strong><small><em className="warm">3 urgent</em> in queue</small></div><div><span>Approved this week</span><strong>86</strong><small><em>94%</em> of requests</small></div><div><span>Average approval</span><strong>18m</strong><small><em>↓ 4m</em> faster than July</small></div></div>
        <div className="mock-toolbar"><div className="toolbar-tabs"><button className={activeFilter === "All" ? "toolbar-active" : ""} onClick={() => setActiveFilter("All")}>All visits <span>18</span></button><button className={activeFilter === "Pending" ? "toolbar-active" : ""} onClick={() => setActiveFilter("Pending")}>Pending <span>12</span></button><button className={activeFilter === "Approved" ? "toolbar-active" : ""} onClick={() => setActiveFilter("Approved")}>Approved <span>6</span></button></div><div className="toolbar-right"><button className="date-button">‹ &nbsp; Wed, 05 Aug &nbsp; ›</button><button className="filter-button">☷ Filters</button></div></div>
        <div className="mock-two-column"><article className="panel table-panel"><div className="panel-header"><div><span className="eyebrow">{activeFilter} appointments</span><h2>Visit schedule</h2></div><button className="more-button">•••</button></div><div className="data-table appointment-table"><div className="data-head"><span>Visitor & prisoner</span><span>Time / room</span><span>Type</span><span>Status</span><span /></div>{[
          ["Alya Pratama", "Rafi Pratama", "10:40–11:00", "Room 02", "Family", "Needs review", "orange"],
          ["S. Rahman", "A. Rahman", "09:30–09:50", "Room 01", "Family", "Confirmed", "green"],
          ["Dimas Wirawan", "Bima Aditya", "11:20–11:40", "Room 04", "Legal", "Needs review", "orange"],
          ["K. Wijaya", "D. Wijaya", "13:00–13:20", "Room 03", "Family", "Confirmed", "green"],
          ["Nurul Hidayah", "Fajar Hidayat", "Tomorrow · 09:00", "Room 02", "Family", "Reschedule", "blue"],
        ].map((row) => <div className="data-row" key={row[0]}><div className="table-person"><Avatar initials={row[0].split(" ").map((part) => part[0]).join("").slice(0, 2)} tone="mint" small /><span><strong>{row[0]}</strong><small>{row[1]}</small></span></div><span className="table-time"><strong>{row[2]}</strong><small>{row[3]}</small></span><span className="table-muted">{row[4]}</span><StatusPill tone={row[6]}>{row[5]}</StatusPill><button className="row-menu" onClick={() => onNotify(`${row[0]}'s appointment details opened.`)}>•••</button></div>)}</div></article><aside className="side-stack"><div className="rule-card rule-card-dark"><span className="eyebrow">Capacity today</span><strong>72%</strong><p>13 of 18 monitored slots are allocated.</p><div className="progress"><i style={{ width: "72%" }} /></div><span className="rule-foot">5 slots still available</span></div><div className="panel mini-panel"><div className="panel-header"><div><span className="eyebrow">Policy check</span><h2>Before approval</h2></div></div><div className="check-list"><span>✓ <b>Visitor identity verified</b></span><span>✓ <b>Prisoner eligible today</b></span><span>✓ <b>Room & staff capacity clear</b></span><span className="check-muted">○ <b>Credit reservation ready</b></span></div></div></aside></div>
      </> : null}

      {section === "Visitors" ? <>
        <div className="mock-stat-row visitor-stats"><div><span>Verified visitors</span><strong>248</strong><small><em>+16</em> this month</small></div><div><span>Pending review</span><strong>6</strong><small><em className="warm">2 urgent</em> need action</small></div><div><span>Relationships</span><strong>312</strong><small><em>98%</em> active</small></div><div><span>Expiring soon</span><strong>9</strong><small>within 30 days</small></div></div>
        <div className="mock-toolbar"><div className="toolbar-tabs"><button className="toolbar-active">All visitors <span>264</span></button><button>Pending review <span>6</span></button><button>Suspended <span>3</span></button></div><div className="toolbar-right"><label className="search-field">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search visitor or ID" /></label><button className="filter-button">☷ Filters</button></div></div>
        <div className="mock-two-column"><article className="panel table-panel"><div className="panel-header"><div><span className="eyebrow">Visitor directory</span><h2>Verified accounts</h2></div><button className="more-button">•••</button></div><div className="data-table visitor-table"><div className="data-head"><span>Visitor</span><span>Relationship</span><span>Verification</span><span>Last visit</span><span /></div>{[
          ["Alya Pratama", "AP", "Sister · Rafi Pratama", "Verified", "29 Jul 2026", "mint"],
          ["Dimas Wirawan", "DW", "Legal · Bima Aditya", "Verified", "01 Aug 2026", "peach"],
          ["Nurul Hidayah", "NH", "Mother · Fajar Hidayat", "Pending", "—", "lavender"],
          ["Sarah Amelia", "SA", "Wife · A. Rahman", "Verified", "04 Aug 2026", "blue"],
          ["Reno Putra", "RP", "Brother · M. Putra", "Expiring soon", "18 Jul 2026", "mint"],
        ].filter((row) => row[0].toLowerCase().includes(search.toLowerCase())).map((row) => <div className="data-row" key={row[0]}><div className="table-person"><Avatar initials={row[1]} tone={row[5]} small /><span><strong>{row[0]}</strong><small>Visitor ID · VST-20{row[1]}</small></span></div><span className="table-muted">{row[2]}</span><StatusPill tone={row[3] === "Verified" ? "green" : row[3] === "Pending" ? "orange" : "blue"}>{row[3]}</StatusPill><span className="table-muted">{row[4]}</span><button className="row-menu" onClick={() => onNotify(`${row[0]}'s visitor profile opened.`)}>•••</button></div>)}</div></article><aside className="side-stack"><div className="panel mini-panel"><div className="panel-header"><div><span className="eyebrow">Review queue</span><h2>Identity checks</h2></div><span className="heading-count">6</span></div><div className="review-list"><div><Avatar initials="NH" tone="lavender" small /><span><strong>Nurul Hidayah</strong><small>Document review · 8m ago</small></span><button onClick={() => onNotify("Identity review opened.")}>Review</button></div><div><Avatar initials="FA" tone="peach" small /><span><strong>Fajar A.</strong><small>More information · 22m ago</small></span><button onClick={() => onNotify("Identity review opened.")}>Review</button></div><div><Avatar initials="DK" tone="mint" small /><span><strong>Dewi Kartika</strong><small>Expiry check · 1h ago</small></span><button onClick={() => onNotify("Identity review opened.")}>Review</button></div></div></div><div className="rule-card"><span className="eyebrow">Verification health</span><div className="health-line"><strong>98.2%</strong><span>current</span></div><p>Most visitor profiles are in good standing.</p><div className="progress"><i style={{ width: "98%" }} /></div></div></aside></div>
      </> : null}

      {section === "Prisoners" ? <>
        <div className="mock-stat-row prisoner-stats"><div><span>Active records</span><strong>1,284</strong><small><em>All fictional</em> prototype data</small></div><div><span>Visit eligible</span><strong>1,102</strong><small><em>86%</em> of active records</small></div><div><span>Restricted today</span><strong>31</strong><small><em className="warm">5 new</em> since yesterday</small></div><div><span>In transfer</span><strong>4</strong><small>requires rescheduling</small></div></div>
        <div className="mock-toolbar"><div className="toolbar-tabs"><button className="toolbar-active">All records <span>1,284</span></button><button>Eligible <span>1,102</span></button><button>Restricted <span>31</span></button></div><div className="toolbar-right"><label className="search-field">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or prisoner ID" /></label><button className="filter-button">☷ Filters</button></div></div>
        <article className="panel table-panel full-table"><div className="panel-header"><div><span className="eyebrow">Central Facility records</span><h2>Prisoner directory</h2></div><button className="more-button">•••</button></div><div className="data-table prisoner-table"><div className="data-head"><span>Prisoner</span><span>Facility ID</span><span>Eligibility</span><span>Visits this week</span><span>Housing</span><span /></div>{[
          ["Rafi Pratama", "RP", "LPS-JKT-004821", "Eligible", "2 / 3", "Unit C · 04"],
          ["Bima Aditya", "BA", "LPS-JKT-003118", "Eligible", "1 / 3", "Unit A · 12"],
          ["Fajar Hidayat", "FH", "LPS-JKT-005204", "Restricted", "0 / 0", "Unit B · 08"],
          ["A. Rahman", "AR", "LPS-JKT-002944", "Eligible", "3 / 3", "Unit C · 02"],
          ["M. Putra", "MP", "LPS-JKT-006401", "In transfer", "—", "Transfer desk"],
        ].filter((row) => row[0].toLowerCase().includes(search.toLowerCase()) || row[2].toLowerCase().includes(search.toLowerCase())).map((row) => <div className="data-row" key={row[2]}><div className="table-person"><Avatar initials={row[1]} tone="navy" small /><span><strong>{row[0]}</strong><small>Display name · fictional record</small></span></div><span className="table-code">{row[2]}</span><StatusPill tone={row[3] === "Eligible" ? "green" : row[3] === "Restricted" ? "orange" : "blue"}>{row[3]}</StatusPill><span className="table-muted">{row[4]}</span><span className="table-muted">{row[5]}</span><button className="row-menu" onClick={() => onNotify(`${row[0]}'s restricted profile opened.`)}>•••</button></div>)}</div><div className="table-disclaimer">ⓘ Visitors only see a display name and the last four digits of a facility reference. Restricted fields stay staff-only.</div></article>
      </> : null}

      {section === "Credits & payments" ? <>
        <div className="mock-stat-row credit-stats"><div><span>Available credits</span><strong>164</strong><small><em>Across 248</em> visitor accounts</small></div><div><span>Reserved</span><strong>18</strong><small>for approved appointments</small></div><div><span>Purchased this month</span><strong>236</strong><small><em>+8.4%</em> vs July</small></div><div><span>Refunds pending</span><strong>3</strong><small><em className="warm">¥ 60</em> mock value</small></div></div>
        <div className="mock-toolbar"><div className="toolbar-tabs"><button className="toolbar-active">All transactions <span>1,842</span></button><button>Purchases <span>236</span></button><button>Reservations <span>18</span></button><button>Refunds <span>3</span></button></div><div className="toolbar-right"><button className="date-button">August 2026⌄</button><button className="filter-button">↓ Export ledger</button></div></div>
        <div className="mock-two-column"><article className="panel table-panel"><div className="panel-header"><div><span className="eyebrow">Immutable activity</span><h2>Credit ledger</h2></div><button className="more-button">•••</button></div><div className="data-table credit-table"><div className="data-head"><span>Transaction</span><span>Visitor</span><span>Amount</span><span>Balance after</span><span /></div>{[
          ["PURCHASE", "Sarah Amelia", "+5 credits", "8 credits", "05 Aug · 08:32", "green"],
          ["RESERVATION", "Alya Pratama", "−1 credit", "2 credits", "05 Aug · 08:18", "orange"],
          ["RELEASE", "Sari Yuliani", "+1 credit", "4 credits", "04 Aug · 17:40", "blue"],
          ["CONSUMPTION", "Rizky Kurniawan", "−1 credit", "0 credits", "04 Aug · 15:20", "lavender"],
          ["REFUND", "Dewi Kartika", "+2 credits", "6 credits", "04 Aug · 14:05", "mint"],
        ].map((row) => <div className="data-row" key={`${row[0]}-${row[1]}`}><div className="ledger-type"><span className={`ledger-dot ledger-${row[5]}`} /><span><strong>{row[0]}</strong><small>{row[4]}</small></span></div><span className="table-muted">{row[1]}</span><strong className={row[2].startsWith("−") ? "amount-minus" : "amount-plus"}>{row[2]}</strong><span className="table-muted">{row[3]}</span><button className="row-menu" onClick={() => onNotify("Ledger transaction details opened.")}>•••</button></div>)}</div></article><aside className="side-stack"><div className="rule-card rule-card-purple"><span className="eyebrow">Ledger integrity</span><div className="health-line"><strong>100%</strong><span>reconciled</span></div><p>All mock payment webhooks are idempotent and accounted for.</p><div className="progress purple-progress"><i style={{ width: "100%" }} /></div></div><div className="panel mini-panel"><div className="panel-header"><div><span className="eyebrow">Credit policy</span><h2>Standard visit</h2></div></div><div className="credit-policy"><div><strong>1 credit</strong><span>20 minute family session</span></div><div><strong>Reserve</strong><span>when appointment is approved</span></div><div><strong>Consume</strong><span>after successful session start</span></div></div></div></aside></div>
      </> : null}

      {section === "Audit log" ? <>
        <div className="mock-stat-row audit-stats"><div><span>Events today</span><strong>482</strong><small><em>+9.2%</em> vs yesterday</small></div><div><span>Staff actions</span><strong>138</strong><small>across 7 roles</small></div><div><span>Sensitive access</span><strong>12</strong><small><em>All authorized</em></small></div><div><span>Alerts</span><strong>0</strong><small><em>Clear</em> in last 24h</small></div></div>
        <div className="mock-toolbar"><div className="toolbar-tabs"><button className="toolbar-active">All events <span>482</span></button><button>Access events <span>12</span></button><button>Financial <span>38</span></button><button>Security <span>4</span></button></div><div className="toolbar-right"><label className="search-field">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event or actor" /></label><button className="filter-button">☷ Filters</button></div></div>
        <article className="panel table-panel full-table"><div className="panel-header"><div><span className="eyebrow">Append-only record</span><h2>Recent events</h2></div><button className="secondary-button" onClick={() => onNotify("Audit export queued with your access reason.")}>↓ <span>Export audit</span></button></div><div className="data-table audit-table"><div className="data-head"><span>Time</span><span>Actor</span><span>Action</span><span>Resource</span><span>Result</span></div>{[
          ["08:41:52", "Maya Santoso", "Approved appointment", "REQ-2043 · appointment", "Allowed", "MS", "navy"],
          ["08:38:17", "Rizky Kurniawan", "Joined monitor room", "Room 03 · session", "Allowed", "RK", "blue"],
          ["08:32:04", "System", "Created credit ledger entry", "PAY-00841 · +5 credits", "Allowed", "SY", "lavender"],
          ["08:19:43", "Sari Yuliani", "Viewed visitor document", "VST-20NH · identity", "Allowed", "SY", "peach"],
          ["08:14:20", "Maya Santoso", "Updated schedule rules", "Central Facility · settings", "Allowed", "MS", "navy"],
        ].filter((row) => row.join(" ").toLowerCase().includes(search.toLowerCase())).map((row) => <div className="data-row" key={`${row[0]}-${row[2]}`}><span className="audit-time">{row[0]}<small>05 Aug 2026</small></span><div className="table-person"><Avatar initials={row[5]} tone={row[6]} small /><span><strong>{row[1]}</strong><small>Staff member</small></span></div><span className="table-muted">{row[2]}</span><span className="table-muted">{row[3]}</span><StatusPill tone="green">{row[4]}</StatusPill></div>)}</div><div className="table-disclaimer">ⓘ Audit events are append-only in the production architecture. Recording access and exports always require a reason.</div></article>
      </> : null}

      {section === "Settings" ? <>
        <div className="settings-layout"><div className="settings-nav"><span className="settings-nav-title">Facility setup</span>{["General", "Appointment policy", "Recording policy", "Staff access", "Notifications"].map((item, index) => <button className={index === 0 ? "settings-nav-active" : ""} key={item} onClick={() => onNotify(`${item} settings selected.`)}>{item}<span>›</span></button>)}</div><div className="settings-content"><article className="panel settings-card"><div className="settings-card-header"><div><span className="eyebrow">General</span><h2>Central Facility</h2><p>Basic details shown to verified visitors.</p></div><StatusPill tone="green">Active</StatusPill></div><div className="settings-fields"><label>Facility display name<input defaultValue="Central Facility" /></label><label>Timezone<select defaultValue="Asia/Jakarta"><option>Asia/Jakarta · GMT+7</option></select></label><label>Operating hours<input defaultValue="09:00 – 16:00 · Monday to Saturday" /></label><label>Visitor support email<input defaultValue="support@central-facility.example" /></label></div></article><article className="panel settings-card"><div className="settings-card-header"><div><span className="eyebrow">Policy controls</span><h2>Guardrails for every visit</h2><p>These settings are illustrative and require institutional approval.</p></div></div><div className="toggle-list"><div className="toggle-row"><span><strong>Record standard family sessions</strong><small>Show recording notice before admission.</small></span><button className={`toggle ${toggles.recording ? "toggle-on" : ""}`} onClick={() => toggle("recording")}><i /></button></div><div className="toggle-row"><span><strong>Send appointment reminders</strong><small>Notify verified visitors 24 hours and 10 minutes before a visit.</small></span><button className={`toggle ${toggles.reminders ? "toggle-on" : ""}`} onClick={() => toggle("reminders")}><i /></button></div><div className="toggle-row"><span><strong>Require MFA for staff</strong><small>All staff accounts must verify a second factor.</small></span><button className={`toggle ${toggles.mfa ? "toggle-on" : ""}`} onClick={() => toggle("mfa")}><i /></button></div></div></article></div></div>
      </> : null}
    </section>
  );
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("Overview");
  const [requests, setRequests] = useState(initialRequests);
  const [toast, setToast] = useState("");
  const [showVisitorView, setShowVisitorView] = useState(false);

  const pendingCount = requests.length;
  const selectedLabel = activeNav === "Overview" ? "Overview" : activeNav;

  const activeRequests = useMemo(() => requests.slice(0, 3), [requests]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function approveRequest(id: string) {
    const request = requests.find((item) => item.id === id);
    setRequests((current) => current.filter((item) => item.id !== id));
    if (request) notify(`${request.visitor}'s request approved and credit reserved.`);
  }

  function declineRequest(id: string) {
    const request = requests.find((item) => item.id === id);
    setRequests((current) => current.filter((item) => item.id !== id));
    if (request) notify(`${request.visitor}'s request moved to declined.`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>SV</span></div>
          <div>
            <div className="brand-name">SecureVisit</div>
            <div className="brand-subtitle">Facility operations</div>
          </div>
        </div>

        <div className="facility-switcher">
          <div className="facility-icon">CF</div>
          <div className="facility-copy"><span>Central Facility</span><small>Jakarta · ID</small></div>
          <span className="chevron">⌄</span>
        </div>

        <div className="nav-section-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {primaryNav.map((item) => (
            <button className={`nav-item ${activeNav === item.label ? "nav-active" : ""}`} key={item.label} onClick={() => setActiveNav(item.label)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.count ? <span className="nav-count">{item.label === "Appointments" ? pendingCount : item.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="nav-section-label nav-section-gap">Operations</div>
        <nav className="nav-list" aria-label="Operations navigation">
          {operationsNav.map((item) => (
            <button className={`nav-item ${activeNav === item.label ? "nav-active" : ""}`} key={item.label} onClick={() => setActiveNav(item.label)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.count ? <span className="nav-count">{item.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="security-note"><span className="lock-icon">⌾</span><div><strong>Secure mode</strong><small>All activity is logged</small></div></div>
          <div className="user-card"><Avatar initials="MS" tone="navy" small /><div><strong>Maya Santoso</strong><small>Scheduling officer</small></div><button aria-label="User menu">•••</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Central Facility</span><b>/</b><strong>{selectedLabel}</strong></div>
          <div className="topbar-actions">
            <button className="view-toggle" onClick={() => setShowVisitorView((current) => !current)}><span className="toggle-dot" />{showVisitorView ? "Visitor view" : "Staff view"}<span className="chevron">⌄</span></button>
            <button className="icon-button" aria-label="Search">⌕</button>
            <button className="icon-button notification-button" aria-label="Notifications">♧<span /></button>
            <Avatar initials="MS" tone="navy" />
          </div>
        </header>

        {showVisitorView ? (
          <section className="visitor-preview">
            <div className="visitor-preview-copy"><span className="eyebrow">Visitor portal preview</span><h1>Good morning, Sarah.</h1><p>Your next approved visit is ready when you are.</p></div>
            <div className="visitor-call-card"><div className="call-card-header"><span className="live-label"><span className="status-dot" />Upcoming visit</span><span className="call-time">Tomorrow · 09:30</span></div><div className="call-person"><Avatar initials="AR" tone="peach" /><div><strong>With A. Rahman</strong><span>Central Facility · 20 minutes</span></div><button className="dark-button" onClick={() => notify("Waiting room opens 10 minutes before the appointment.")}>View details <span>→</span></button></div></div>
            <div className="visitor-bottom-grid"><div className="simple-panel"><span className="eyebrow">Visit credits</span><strong className="big-number">3</strong><p>Available for approved appointments</p><button className="text-button" onClick={() => notify("Mock credit purchase flow opened.")}>Buy credits <span>→</span></button></div><div className="simple-panel"><span className="eyebrow">Verification</span><StatusPill tone="green">Verified</StatusPill><p className="panel-note">Your identity review is current through 30 Nov 2026.</p><button className="text-button" onClick={() => notify("Profile settings opened.")}>View profile <span>→</span></button></div></div>
          </section>
        ) : activeNav === "Overview" ? (
          <>
            <section className="page-heading">
              <div><div className="eyebrow">Wednesday, 05 August 2026 <span className="heading-dot">·</span> 08:42 WIB</div><h1>Good morning, Maya <span className="wave">✦</span></h1><p>Here&apos;s what needs your attention across Central Facility today.</p></div>
              <div className="heading-actions"><button className="secondary-button" onClick={() => notify("Report export prepared for download.")}>↓ <span>Export report</span></button><button className="primary-button" onClick={() => setActiveNav("Appointments")}>+ <span>New appointment</span></button></div>
            </section>

            <section className="stat-grid" aria-label="Facility summary">
              <article className="stat-card stat-card-highlight"><div className="stat-top"><span>Today&apos;s visits</span><span className="stat-icon stat-icon-dark">◷</span></div><div className="stat-value">18</div><div className="stat-foot"><span className="trend-up">↗ 12%</span><span>vs. last Wednesday</span></div><div className="sparkline sparkline-light"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></article>
              <article className="stat-card"><div className="stat-top"><span>Pending approval</span><span className="stat-icon">◌</span></div><div className="stat-value">{pendingCount + 9}</div><div className="stat-foot"><span className="trend-warm">{pendingCount} urgent</span><span>needs review</span></div><div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /></div></article>
              <article className="stat-card"><div className="stat-top"><span>Active rooms</span><span className="stat-icon stat-icon-green">◉</span></div><div className="stat-value">2 <small>/ 6</small></div><div className="stat-foot"><span className="trend-green">● On schedule</span><span>all systems normal</span></div><div className="room-dots"><i className="filled" /><i className="filled" /><i /><i /><i /><i /></div></article>
              <article className="stat-card"><div className="stat-top"><span>Credits this month</span><span className="stat-icon stat-icon-purple">◈</span></div><div className="stat-value">164</div><div className="stat-foot"><span className="trend-up">↗ 8.4%</span><span>vs. last month</span></div><div className="sparkline sparkline-purple"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></article>
            </section>

            <section className="dashboard-grid">
              <article className="panel agenda-panel"><div className="panel-header"><div><span className="eyebrow">Live schedule</span><h2>Today&apos;s agenda</h2></div><button className="text-button" onClick={() => setActiveNav("Appointments")}>View calendar <span>→</span></button></div><div className="agenda-date-row"><button>‹</button><strong>Wed, 05 Aug</strong><span className="today-pill">Today</span><button>›</button><span className="agenda-timezone">GMT+7 · Jakarta</span></div><div className="agenda-list">{agenda.map((item) => <div className="agenda-row" key={`${item.time}-${item.name}`}><span className="agenda-time">{item.time}</span><span className={`agenda-line agenda-line-${item.color}`} /><div className="agenda-main"><strong>{item.name}</strong><span>{item.room} <i /> {item.type}</span></div><StatusPill tone={item.color === "orange" ? "orange" : item.color === "blue" ? "blue" : "green"}>{item.status}</StatusPill></div>)}</div><div className="agenda-footer"><span className="status status-light"><span className="status-dot status-dot-green" />2 rooms in progress</span><button className="text-button" onClick={() => notify("Room status panel opened.")}>Room status <span>→</span></button></div></article>

              <article className="panel pulse-panel"><div className="panel-header"><div><span className="eyebrow">Facility pulse</span><h2>Operational health</h2></div><button className="more-button" aria-label="More options">•••</button></div><div className="pulse-score"><div className="pulse-ring"><div><strong>94</strong><span>/ 100</span></div></div><div><StatusPill tone="green">All systems normal</StatusPill><p>Updated just now</p></div></div><div className="pulse-metrics"><div><span><i className="metric-dot mint-dot" />Room readiness</span><strong>100%</strong></div><div><span><i className="metric-dot blue-dot" />Staff capacity</span><strong>82%</strong></div><div><span><i className="metric-dot orange-dot" />Visitor queue</span><strong>12 waiting</strong></div></div><div className="pulse-note"><span>↗</span><p><strong>Great momentum.</strong> Approval time is down 18% this week.</p></div></article>
            </section>

            <section className="lower-grid">
              <article className="panel requests-panel"><div className="panel-header"><div><span className="eyebrow">Action required</span><h2>Approval queue <span className="heading-count">{pendingCount}</span></h2></div><button className="text-button" onClick={() => setActiveNav("Visitors")}>View all <span>→</span></button></div><div className="request-list">{activeRequests.length ? activeRequests.map((request) => <div className="request-row" key={request.id}><Avatar initials={request.initials} tone={request.tone} /><div className="request-person"><strong>{request.visitor}</strong><span>{request.relationship} <i /> <b>{request.id}</b></span></div><div className="request-visit"><strong>{request.prisoner}</strong><span>{request.prisonerId}</span></div><div className="request-time"><strong>{request.date}</strong><span>{request.time}</span></div><div className="request-actions"><button className="approve-button" aria-label={`Approve ${request.visitor}`} onClick={() => approveRequest(request.id)}>✓</button><button className="decline-button" aria-label={`Decline ${request.visitor}`} onClick={() => declineRequest(request.id)}>×</button></div></div>) : <div className="empty-state"><span>✓</span><strong>Queue cleared</strong><p>New visitor requests will appear here.</p></div>}</div></article>

              <article className="panel activity-panel"><div className="panel-header"><div><span className="eyebrow">Audit trail</span><h2>Recent activity</h2></div><button className="more-button" aria-label="More options">•••</button></div><div className="activity-list"><div className="activity-item"><Avatar initials="MS" tone="navy" small /><div><p><strong>You</strong> approved a visit request</p><span>REQ-2043 · 8 minutes ago</span></div><span className="activity-check">✓</span></div><div className="activity-item"><Avatar initials="RK" tone="blue" small /><div><p><strong>Rizky K.</strong> started a session</p><span>Room 03 · 21 minutes ago</span></div><span className="activity-live">Live</span></div><div className="activity-item"><Avatar initials="SY" tone="peach" small /><div><p><strong>Sari Y.</strong> updated a prisoner record</p><span>LPS-JKT-004821 · 42 minutes ago</span></div><span className="activity-check">✓</span></div><div className="activity-item"><Avatar initials="SYS" tone="lavender" small /><div><p><strong>System</strong> released 1 visit credit</p><span>Facility cancellation · 1h ago</span></div><span className="activity-check">✓</span></div></div><button className="full-link" onClick={() => setActiveNav("Audit log")}>Open audit log <span>→</span></button></article>
            </section>
          </>
        ) : <MockPage section={activeNav} onNotify={notify} />}
      </main>
      {toast ? <div className="toast"><span>✓</span>{toast}</div> : null}
    </div>
  );
}
