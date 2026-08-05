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
        ) : (
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
        )}
      </main>
      {toast ? <div className="toast"><span>✓</span>{toast}</div> : null}
    </div>
  );
}
