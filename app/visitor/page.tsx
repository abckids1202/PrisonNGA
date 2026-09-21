"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import "./visitor-auth.css";

type Tab = "Home" | "Visits" | "Connections" | "Credits" | "Account";
type NoticeTone = "success" | "info";
type VisitorAppointmentRecord = { id: string; status: string; requested_start: string; requested_end: string; prisoner_name: string; appointment_type: string };
type VisitorRelationshipRecord = { id: string; status: string; prisoner_name: string; relationship_type: string };
type VisitorCreditAccount = { available_credits: number; reserved_credits: number; facility_name: string };
type VisitorData = { appointments: VisitorAppointmentRecord[]; relationships: VisitorRelationshipRecord[]; credits: VisitorCreditAccount[]; unreadNotifications: number; loading: boolean };

const VisitorDataContext = createContext<VisitorData>({ appointments: [], relationships: [], credits: [], unreadNotifications: 0, loading: true });

const navItems: { label: Tab; icon: string }[] = [
  { label: "Home", icon: "⌂" },
  { label: "Visits", icon: "◷" },
  { label: "Connections", icon: "↔" },
  { label: "Credits", icon: "◇" },
  { label: "Account", icon: "○" },
];

function VisitorButton({
  children,
  primary = false,
  onClick,
  className = "",
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button className={`sv4-button ${primary ? "sv4-button-primary" : ""} ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}

function VisitorStatus({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "orange" | "blue" }) {
  return <span className={`sv4-status sv4-status-${tone}`}><i />{children}</span>;
}

function VisitorAvatar({ initials, color = "sage" }: { initials: string; color?: string }) {
  return <span className={`sv4-avatar sv4-avatar-${color}`}>{initials}</span>;
}

export default function VisitorPage() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "signed_out">(() => typeof window === "undefined" ? "authenticated" : "loading");
  const [visitorName, setVisitorName] = useState("Sarah");
  const [visitorData, setVisitorData] = useState<VisitorData>({ appointments: [], relationships: [], credits: [], unreadNotifications: 0, loading: true });
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "Home";
    const requested = new URLSearchParams(window.location.search).get("section");
    return requested && ["Home", "Visits", "Connections", "Credits", "Account"].includes(requested) ? requested as Tab : "Home";
  });
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { headers: { accept: "application/json" }, credentials: "include" }).then(async (response) => {
      if (!active) return;
      if (!response.ok) {
        setAuthState("signed_out");
        return;
      }
      const body = await response.json() as { identity?: { displayName?: string; userType?: string } };
      if (body.identity?.userType !== "VISITOR") {
        setAuthState("signed_out");
        return;
      }
      setVisitorName(body.identity.displayName || "Visitor");
      setAuthState("authenticated");
    }).catch(() => active && setAuthState("signed_out"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let active = true;
    Promise.all([
      fetch("/api/visitor/appointments", { credentials: "include" }).then((response) => response.ok ? response.json() : { appointments: [] }),
      fetch("/api/visitor/relationships", { credentials: "include" }).then((response) => response.ok ? response.json() : { relationships: [] }),
      fetch("/api/visitor/credits", { credentials: "include" }).then((response) => response.ok ? response.json() : { accounts: [] }),
      fetch("/api/visitor/notifications", { credentials: "include" }).then((response) => response.ok ? response.json() : { notifications: [] }),
    ]).then(([appointments, relationships, credits, notifications]) => {
      if (!active) return;
      setVisitorData({ appointments: appointments.appointments || [], relationships: relationships.relationships || [], credits: credits.accounts || [], unreadNotifications: (notifications.notifications || []).filter((item: { status?: string }) => item.status !== "READ").length, loading: false });
    }).catch(() => active && setVisitorData((current) => ({ ...current, loading: false })));
    return () => { active = false; };
  }, [authState]);

  function action(message: string, tone: NoticeTone = "success") {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 3600);
  }

  function navigate(nextTab: Tab) {
    setTab(nextTab);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openVisitDetails() {
    window.location.href = "/visitor/visits/SV-260814-018";
  }

  if (authState !== "authenticated") return <VisitorAuthGate loading={authState === "loading"} onAuthenticated={(name) => { setVisitorName(name); setAuthState("authenticated"); }} />;

  return (
    <VisitorDataContext.Provider value={visitorData}>
    <div className="sv3-visitor-app sv4-visitor-app">
      <header className="sv4-header">
        <div className="sv4-header-inner">
          <button className="sv4-brand" onClick={() => navigate("Home")} aria-label="Go to SecureVisit home">
            <span className="sv4-brand-mark">+</span>
            <span><strong>SecureVisit</strong><small>Visitor</small></span>
          </button>
          <nav className="sv4-desktop-nav" aria-label="Visitor navigation">
            {navItems.slice(0, 4).map((item) => (
              <button key={item.label} className={tab === item.label ? "active" : ""} onClick={() => navigate(item.label)}>
                {item.label}
                {item.label === "Visits" && <b>1</b>}
              </button>
            ))}
          </nav>
          <div className="sv4-header-actions">
            <span className="sv4-secure-note"><i />Secure session</span>
            <button className={`sv4-icon-button ${notificationsOpen ? "active" : ""}`} onClick={() => setNotificationsOpen((value) => !value)} aria-label="Open notifications">♢{visitorData.unreadNotifications > 0 && <b>{visitorData.unreadNotifications}</b>}</button>
            <button className="sv4-profile-chip" onClick={() => navigate("Account")} aria-label="Open account">
              <VisitorAvatar initials={visitorName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()} color="coral" /><span>{visitorName.split(" ")[0]}</span><em>⌄</em>
            </button>
          </div>
        </div>
        {notificationsOpen && <VisitorNotifications onAction={action} />}
      </header>

      <main className="sv4-main">
        {tab === "Home" && <VisitorHome onAction={action} onOpenVisit={openVisitDetails} onNavigate={navigate} />}
        {tab === "Visits" && <VisitorVisits onAction={action} onOpenVisit={openVisitDetails} />}
        {tab === "Connections" && <VisitorConnections onAction={action} />}
        {tab === "Credits" && <VisitorCredits onAction={action} />}
        {tab === "Account" && <VisitorAccount onAction={action} />}
      </main>

      <nav className="sv4-mobile-nav" aria-label="Mobile visitor navigation">
        {navItems.map((item) => (
          <button key={item.label} className={tab === item.label ? "active" : ""} onClick={() => navigate(item.label)}>
            <span>{item.icon}{item.label === "Visits" && <b>1</b>}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {notice && <div className={`sv4-toast sv4-toast-${notice.tone}`} role="status"><span>{notice.tone === "success" ? "✓" : "i"}</span>{notice.message}</div>}
    </div>
    </VisitorDataContext.Provider>
  );
}

function VisitorAuthGate({ loading, onAuthenticated }: { loading: boolean; onAuthenticated: (displayName: string) => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/visitor/request", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json() as { challengeId?: string; devCode?: string; error?: string };
      if (!response.ok || !body.challengeId) throw new Error(body.error || "We could not send a sign-in code.");
      setChallengeId(body.challengeId);
      if (body.devCode) setCode(body.devCode);
      setMessage(body.devCode ? "Development code loaded. Verify it below." : "Check your email or phone for the six-digit code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not send a sign-in code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/visitor/verify", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "include", body: JSON.stringify({ challengeId, code, displayName }) });
      const body = await response.json() as { visitor?: { displayName?: string }; error?: string };
      if (!response.ok || !body.visitor) throw new Error(body.error || "That code is not valid.");
      onAuthenticated(body.visitor.displayName || displayName || "Visitor");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code is not valid.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="sv11-auth-shell"><section className="sv11-auth-card"><div className="sv11-auth-mark">+</div><span className="sv4-kicker">SECUREVISIT VISITOR</span><h1>{loading ? "Checking your secure session" : "Welcome back"}</h1><p>{loading ? "One moment while we check your visitor account." : "Sign in with a one-time code to manage visits and connections."}</p>{!loading && !challengeId ? <form onSubmit={requestCode} className="sv11-auth-form"><label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label>Your name <span>(optional)</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we greet you?" /></label><button className="sv4-button sv4-button-primary" disabled={busy}>{busy ? "Sending…" : "Send me a sign-in code"}</button></form> : null}{!loading && challengeId ? <form onSubmit={verifyCode} className="sv11-auth-form"><label>Six-digit code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /></label><button className="sv4-button sv4-button-primary" disabled={busy}>{busy ? "Checking…" : "Continue to SecureVisit"}</button><button type="button" className="sv11-back-button" onClick={() => { setChallengeId(null); setCode(""); setMessage(""); }}>Use another email</button></form> : null}{message && <p className="sv11-auth-message" role="status">{message}</p>}<small className="sv11-auth-footnote">Your visit details are protected. SecureVisit will never ask for your password.</small></section></main>;
}

function VisitorHome({
  onAction,
  onOpenVisit,
  onNavigate,
}: {
  onAction: (message: string, tone?: NoticeTone) => void;
  onOpenVisit: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  const { appointments, relationships, credits, loading } = useContext(VisitorDataContext);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const nextVisit = appointments.find((visit) => ["APPROVED", "WAITING", "IN_PROGRESS"].includes(visit.status));
  const connection = relationships.find((item) => item.status === "APPROVED");
  const availableCredits = credits.reduce((sum, account) => sum + Number(account.available_credits || 0), 0);
  const slides = [
    { eyebrow: "Your next visit", title: nextVisit ? "Your visit is scheduled" : "Plan your first visit", copy: nextVisit ? `${nextVisit.prisoner_name} is ready to see you.` : "Start by adding a connection and submitting a visit request.", button: nextVisit ? "Prepare for visit" : "View connections", status: nextVisit ? "VISIT APPROVED" : "GET STARTED", theme: "peach", action: nextVisit ? onOpenVisit : () => onNavigate("Connections") },
    { eyebrow: "Before your visit", title: "Make sure you’re ready", copy: "Test your camera, microphone, and connection before tomorrow.", button: "Check my device", status: "RECOMMENDED", theme: "blue", action: () => onAction("Device check is ready when you are.", "info") },
    { eyebrow: "Good to know", title: "Join 10 minutes early", copy: "Your waiting room opens at 09:50 WIB so you have time to settle in.", button: "View visit guidelines", status: "READY WHEN YOU ARE", theme: "sage", action: () => onAction("Guidelines opened — you’re all set.", "info") },
  ];
  const current = slides[slide];

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setSlide((value) => (value + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  return (
    <div className="sv4-page">
      <section className="sv4-greeting">
        <div><p className="sv4-kicker">Wednesday · 13 August 2026</p><h1>Hello, Sarah</h1><p className="sv4-lead">It’s good to see you. Here’s everything for your next visit.</p></div>
        <button className="sv4-help-link" onClick={() => onAction("Our visitor support team is here to help.", "info")}>Need a hand? <span>Visit support →</span></button>
      </section>

      <section className={`sv4-hero sv4-hero-${current.theme}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="sv4-hero-copy"><span className="sv4-hero-eyebrow">{current.eyebrow}</span><h2>{current.title}</h2><p>{current.copy}</p><VisitorButton primary onClick={current.action}>{current.button} <span>→</span></VisitorButton><span className="sv4-hero-status">{current.status}</span></div>
        <div className="sv4-hero-art" aria-hidden="true"><div className="sv4-art-grid" /><div className="sv4-art-path" /><div className="sv4-art-avatar"><span>AR</span></div><div className="sv4-art-device"><span>●</span><i /><i /><i /></div></div>
        <div className="sv4-hero-controls"><button onClick={() => setSlide((slide + slides.length - 1) % slides.length)} aria-label="Previous story">←</button><span>{slides.map((_, index) => <i key={index} className={index === slide ? "active" : ""} />)}</span><button onClick={() => setSlide((slide + 1) % slides.length)} aria-label="Next story">→</button></div>
      </section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Make it easy</p><h2>What would you like to do?</h2></div><button className="sv4-text-link" onClick={() => onNavigate("Visits")}>See all visits →</button></div><div className="sv4-action-grid">
        <QuickAction icon="＋" title="Book a visit" copy="Find a time to see someone" onClick={() => onAction("Choose a connection to start booking.", "info")} tone="orange" />
        <QuickAction icon="◷" title="My visits" copy="See upcoming and past visits" onClick={() => onNavigate("Visits")} tone="blue" />
        <QuickAction icon="↔" title="My connections" copy="People you’re approved to see" onClick={() => onNavigate("Connections")} tone="sage" />
        <QuickAction icon="◇" title="Visit credits" copy="Check your available balance" onClick={() => onNavigate("Credits")} tone="lilac" />
        <QuickAction icon="⌁" title="Device check" copy="Make sure everything works" onClick={() => onAction("Device check is ready when you are.", "info")} tone="sand" />
        <QuickAction icon="?" title="Help center" copy="Answers and visitor support" onClick={() => onAction("Our visitor support team is here to help.", "info")} tone="rose" />
      </div></section>

      {nextVisit ? <section className="sv4-next-visit-card" aria-label={`NEXT VISIT with ${nextVisit.prisoner_name}`} onClick={onOpenVisit} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenVisit()}>
        <div className="sv4-next-visit-main"><div className="sv4-card-overline"><span>Your next visit</span><VisitorStatus>APPROVED</VisitorStatus></div><h2>Visit scheduled</h2><div className="sv4-person-row"><VisitorAvatar initials={nextVisit.prisoner_name.split(" ").map((part) => part[0]).join("").slice(0, 2)} /><div><strong>{nextVisit.prisoner_name}</strong><span>{nextVisit.appointment_type} visit · Central Facility</span></div></div></div>
        <div className="sv4-next-visit-time"><span>{new Date(nextVisit.requested_start).toLocaleDateString()}</span><strong>{new Date(nextVisit.requested_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–{new Date(nextVisit.requested_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><small>Open Visit Details to prepare</small></div><span className="sv4-round-arrow">→</span>
      </section> : <section className="sv4-next-visit-card sv4-next-visit-empty"><div className="sv4-next-visit-main"><div className="sv4-card-overline"><span>Your next visit</span><VisitorStatus tone="blue">NOT SCHEDULED</VisitorStatus></div><h2>{loading ? "Loading your visits" : "Nothing scheduled yet"}</h2><div className="sv4-person-row"><VisitorAvatar initials="+" /><div><strong>{loading ? "Checking your account" : "Add a connection to begin"}</strong><span>{loading ? "Your latest information is on its way." : "Your approved connections will appear here."}</span></div></div></div><span className="sv4-round-arrow">→</span></section>}

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">People in your circle</p><h2>Your connections</h2></div><button className="sv4-text-link" onClick={() => onNavigate("Connections")}>Manage connections →</button></div><div className="sv4-connection-scroll">{connection ? <ConnectionCard initials={connection.prisoner_name.split(" ").map((part) => part[0]).join("").slice(0, 2)} name={connection.prisoner_name} relation={connection.relationship_type} color="sage" onClick={onOpenVisit} /> : <div className="sv4-empty-inline">{loading ? "Loading connections…" : "No approved connections yet."}</div>}<button className="sv4-add-card" onClick={() => onNavigate("Connections")}><span>＋</span><strong>Add a connection</strong><small>Who would you like to see?</small></button></div></section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">A little help along the way</p><h2>For you</h2></div></div><div className="sv4-recommend-grid"><Recommendation icon="⌁" title="Device ready" copy="Take a quick check before you join." action="Check device" onClick={() => onAction("Device check is ready when you are.", "info")} tone="blue" /><Recommendation icon="◷" title={nextVisit ? "Visit scheduled" : "Plan a visit"} copy={nextVisit ? "Everything is in place for your visit." : "Add a connection to get started."} action={nextVisit ? "View details" : "View connections"} onClick={nextVisit ? onOpenVisit : () => onNavigate("Connections")} tone="orange" /><Recommendation icon="◇" title={`${availableCredits} Visit Credit${availableCredits === 1 ? "" : "s"}`} copy={availableCredits ? "Available for an approved visit." : "Top up when you are ready to book."} action="View credits" onClick={() => onNavigate("Credits")} tone="sage" /></div></section>

      <section className="sv4-section sv4-guidance-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Feel ready</p><h2>Before your visit</h2></div><button className="sv4-text-link" onClick={() => onAction("All visit guidance opened.", "info")}>See all guidance →</button></div><div className="sv4-guidance-grid"><GuidanceCard number="01" title="Find a quiet place" copy="A calm space helps you focus on the conversation." /><GuidanceCard number="02" title="Test your connection" copy="Check your camera, microphone, and internet." /><GuidanceCard number="03" title="Join a little early" copy="Your waiting room opens ten minutes before." /></div></section>

      <section className="sv4-section sv4-activity-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Your SecureVisit story</p><h2>Recent activity</h2></div></div><div className="sv4-activity-list"><Activity icon="✓" title="Your visit was approved" time="Yesterday · 14:32" tone="green" /><Activity icon="◇" title="Visit Credit reserved" time="Yesterday · 14:32" tone="orange" /><Activity icon="↔" title="Connection approved" time="12 Aug · 09:10" tone="blue" /></div></section>
    </div>
  );
}

function QuickAction({ icon, title, copy, onClick, tone }: { icon: string; title: string; copy: string; onClick: () => void; tone: string }) {
  return <button className="sv4-quick-action" onClick={onClick}><span className={`sv4-quick-icon sv4-tone-${tone}`}>{icon}</span><span><strong>{title}</strong><small>{copy}</small></span><b>→</b></button>;
}

function ConnectionCard({ initials, name, relation, color, onClick }: { initials: string; name: string; relation: string; color: string; onClick: () => void }) {
  return <button className="sv4-connection-card" onClick={onClick}><VisitorAvatar initials={initials} color={color} /><strong>{name}</strong><span>{relation}</span><VisitorStatus>Approved</VisitorStatus></button>;
}

function Recommendation({ icon, title, copy, action, onClick, tone }: { icon: string; title: string; copy: string; action: string; onClick: () => void; tone: string }) {
  return <article className="sv4-recommend-card"><span className={`sv4-recommend-icon sv4-tone-${tone}`}>{icon}</span><h3>{title}</h3><p>{copy}</p><button onClick={onClick}>{action} →</button></article>;
}

function GuidanceCard({ number, title, copy }: { number: string; title: string; copy: string }) {
  return <article className="sv4-guidance-card"><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div><b>↗</b></article>;
}

function Activity({ icon, title, time, tone }: { icon: string; title: string; time: string; tone: string }) {
  return <button className="sv4-activity-row" onClick={() => undefined}><span className={`sv4-activity-icon sv4-tone-${tone}`}>{icon}</span><span><strong>{title}</strong><small>{time}</small></span><b>→</b></button>;
}

function VisitorVisits({ onAction, onOpenVisit }: { onAction: (message: string, tone?: NoticeTone) => void; onOpenVisit: () => void }) {
  const [view, setView] = useState("Upcoming");
  return <div className="sv4-page sv4-inner-page"><div className="sv4-page-intro"><p className="sv4-kicker">Your visits</p><h1>Time together, made simple.</h1><p>Keep track of your upcoming visits, requests, and memories.</p></div><div className="sv4-segmented">{["Upcoming", "Requests", "History"].map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}{item === "Upcoming" && <b>1</b>}</button>)}</div>{view === "Upcoming" && <div className="sv4-visits-layout"><article className="sv4-visit-detail-card"><div className="sv4-card-overline"><span>Tomorrow · 10:00 WIB</span><VisitorStatus>APPROVED</VisitorStatus></div><div className="sv4-visit-person"><VisitorAvatar initials="AR" color="sage" /><div><h2>A. Rahman</h2><p>Family visit · Central Facility</p></div></div><div className="sv4-visit-meta"><span><small>Date</small><strong>14 August 2026</strong></span><span><small>Duration</small><strong>20 minutes</strong></span><span><small>Waiting room</small><strong>09:50 WIB</strong></span></div><VisitorButton primary onClick={onOpenVisit}>Prepare for visit <span>→</span></VisitorButton></article><JourneyCard onAction={onAction} /></div>}{view === "Requests" && <div className="sv4-empty-state"><span>↗</span><h2>No requests waiting</h2><p>When you request a new visit, you’ll see its progress here.</p><VisitorButton primary onClick={() => onAction("Choose a connection to start a visit request.", "info")}>Start a request</VisitorButton></div>}{view === "History" && <div className="sv4-history-list"><HistoryRow name="A. Rahman" date="08 August 2026" status="Completed" /><HistoryRow name="A. Rahman" date="25 July 2026" status="Completed" /><HistoryRow name="Central Facility" date="11 July 2026" status="Completed" /></div>}</div>;
}

function JourneyCard({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  const steps = [["Request submitted", "12 Aug · 09:10"], ["Visit approved", "12 Aug · 14:32"], ["Credit reserved", "12 Aug · 14:32"], ["Prepare for visit", "You are here"], ["Waiting room opens", "Tomorrow · 09:50"]];
  return <article className="sv4-journey-card"><div className="sv4-card-overline"><span>Your visit journey</span><span>4 of 5</span></div><h2>You’re nearly ready.</h2><div className="sv4-journey">{steps.map(([title, copy], index) => <div key={title} className={`sv4-journey-step ${index < 3 ? "done" : index === 3 ? "current" : ""}`}><span>{index < 3 ? "✓" : index + 1}</span><div><strong>{title}</strong><small>{copy}</small></div></div>)}</div><VisitorButton onClick={() => onAction("Device check is ready when you are.", "info")}>Test my device <span>→</span></VisitorButton></article>;
}

function HistoryRow({ name, date, status }: { name: string; date: string; status: string }) {
  return <div className="sv4-history-row"><VisitorAvatar initials={name === "A. Rahman" ? "AR" : "CF"} color="sage" /><span><strong>{name}</strong><small>{date} · Family visit</small></span><VisitorStatus tone="blue">{status}</VisitorStatus><b>→</b></div>;
}

function VisitorConnections({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <div className="sv4-page sv4-inner-page"><div className="sv4-page-intro sv4-intro-split"><div><p className="sv4-kicker">Your people</p><h1>Connections</h1><p>People you’re approved to visit, all in one place.</p></div><VisitorButton primary onClick={() => onAction("Connection requests are coming soon.", "info")}>＋ Add a connection</VisitorButton></div><article className="sv4-feature-connection"><div className="sv4-feature-art"><div className="sv4-feature-sun" /><div className="sv4-feature-person one">AR</div><div className="sv4-feature-person two">SA</div></div><div className="sv4-feature-copy"><VisitorStatus>CONNECTION APPROVED</VisitorStatus><h2>A. Rahman</h2><p>Family connection · Central Facility</p><div className="sv4-feature-rule" /><p className="sv4-feature-note">You can request a visit whenever you’re ready. We’ll let you know as soon as it’s approved.</p><VisitorButton primary onClick={() => onAction("Available times will appear here when booking opens.", "info")}>Find available times <span>→</span></VisitorButton></div></article><div className="sv4-section-heading sv4-connection-heading"><div><p className="sv4-kicker">Your circle</p><h2>All connections</h2></div></div><div className="sv4-connection-list"><ConnectionCard initials="AR" name="A. Rahman" relation="Family · Central Facility" color="sage" onClick={() => onAction("A. Rahman is ready for your next visit.", "info")} /><button className="sv4-new-connection" onClick={() => onAction("Connection requests are coming soon.", "info")}><span>＋</span><strong>Add someone new</strong><small>Start a secure connection request</small></button></div></div>;
}

function VisitorCredits({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <div className="sv4-page sv4-inner-page"><div className="sv4-page-intro"><p className="sv4-kicker">Visit credits</p><h1>Keep your visits going.</h1><p>Each credit gives you one secure video visit.</p></div><section className="sv4-credit-hero"><div><span className="sv4-hero-eyebrow">Available balance</span><strong>2</strong><p>Visit Credits</p></div><div className="sv4-credit-orbit">◇<small>1 reserved</small></div></section><div className="sv4-credit-note"><span>i</span><p><strong>One credit is reserved</strong><br />for your visit with A. Rahman tomorrow.</p></div><div className="sv4-section-heading"><div><p className="sv4-kicker">Your balance</p><h2>Credit activity</h2></div><VisitorButton primary onClick={() => onAction("Credit top-up is ready to connect.", "info")}>＋ Get more credits</VisitorButton></div><div className="sv4-credit-list"><div><span className="sv4-credit-dot green">+</span><span><strong>Credit added</strong><small>Purchase · 06 August 2026</small></span><b>+2</b></div><div><span className="sv4-credit-dot orange">−</span><span><strong>Credit reserved</strong><small>A. Rahman · Tomorrow’s visit</small></span><b>−1</b></div><div><span className="sv4-credit-dot blue">✓</span><span><strong>Credit returned</strong><small>Visit completed · 08 August 2026</small></span><b>+1</b></div></div></div>;
}

function VisitorAccount({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <div className="sv4-page sv4-inner-page"><div className="sv4-account-hero"><VisitorAvatar initials="SA" color="coral" /><div><p className="sv4-kicker">Your account</p><h1>Sarah Amelia</h1><p>Member since June 2026</p></div><VisitorStatus>PROFILE COMPLETE</VisitorStatus></div><div className="sv4-profile-progress"><div><strong>Your profile</strong><span>75% complete</span></div><div className="sv4-progress"><i /></div><p>Add an emergency contact to finish setting up your profile.</p></div><div className="sv4-account-list"><button onClick={() => onAction("Profile editing is ready for your details.", "info")}><span>◎</span><strong>Personal details</strong><small>Update your name, email, and phone</small><b>→</b></button><button onClick={() => onAction("Notification preferences opened.", "info")}><span>♢</span><strong>Notifications</strong><small>Choose how we keep you updated</small><b>→</b></button><button onClick={() => onAction("Privacy and security settings opened.", "info")}><span>⌁</span><strong>Privacy & security</strong><small>Manage your secure account</small><b>→</b></button><button onClick={() => onAction("Help center opened.", "info")}><span>?</span><strong>Help center</strong><small>Find answers and contact support</small><b>→</b></button></div><button className="sv4-signout" onClick={() => onAction("You are still signed in to this secure session.", "info")}>Sign out of SecureVisit</button></div>;
}

function VisitorNotifications({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <aside className="sv4-notifications"><div className="sv4-notifications-head"><div><p className="sv4-kicker">Your inbox</p><h2>Notifications</h2></div><span>2 new</span></div><button onClick={() => onAction("Your visit details are ready.", "info")}><span className="sv4-notification-icon orange">✓</span><span><strong>Visit approved</strong><small>Your visit with A. Rahman is tomorrow.</small><em>Yesterday</em></span><b>●</b></button><button onClick={() => onAction("Device check is ready when you are.", "info")}><span className="sv4-notification-icon blue">⌁</span><span><strong>Device check recommended</strong><small>Take a quick check before your visit.</small><em>Yesterday</em></span><b>●</b></button><button onClick={() => onAction("A credit was returned to your balance.", "success")}><span className="sv4-notification-icon sage">◇</span><span><strong>Credit returned</strong><small>Your completed visit returned one credit.</small><em>12 Aug</em></span></button><button className="sv4-notifications-all" onClick={() => onAction("All notifications marked as read.", "success")}>Mark all as read</button></aside>;
}

function VisitorVisitSheet({ onClose, onAction }: { onClose: () => void; onAction: (message: string, tone?: NoticeTone) => void }) {
  return <div className="sv4-sheet-backdrop" onClick={onClose}><aside className="sv4-visit-sheet" onClick={(event) => event.stopPropagation()}><button className="sv4-sheet-close" onClick={onClose} aria-label="Close visit details">×</button><div className="sv4-sheet-handle" /><div className="sv4-sheet-top"><VisitorStatus>APPROVED</VisitorStatus><span>Tomorrow · 10:00 WIB</span></div><div className="sv4-sheet-person"><VisitorAvatar initials="AR" color="sage" /><div><p className="sv4-kicker">Your next visit</p><h2>A. Rahman</h2><p>Family visit · Central Facility</p></div></div><div className="sv4-sheet-details"><span><small>Duration</small><strong>20 minutes</strong></span><span><small>Waiting room</small><strong>09:50 WIB</strong></span><span><small>Visit Credit</small><strong>1 reserved</strong></span></div><div className="sv4-sheet-note"><span>✦</span><p><strong>You’re all set.</strong><br />We’ll remind you when your waiting room opens.</p></div><VisitorButton primary onClick={() => onAction("Device check is ready when you are.", "info")}>Prepare for visit <span>→</span></VisitorButton></aside></div>;
}
