"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import "./visitor-auth.css";

type Tab = "Home" | "Visits" | "Connections" | "Credits" | "Account";
type NoticeTone = "success" | "info";
type VisitorAppointmentRecord = { id: string; facility_id: string; prisoner_id: string; status: string; requested_start: string; requested_end: string; timezone: string; version: number; prisoner_name: string; appointment_type: string; created_at?: string; updated_at?: string };
type VisitorRelationshipRecord = { id: string; facility_id: string; prisoner_id: string; status: string; prisoner_name: string; relationship_type: string; facility_name?: string; verification_case_id?: string | null; verification_status?: string; evidence_count?: number; created_at?: string; updated_at?: string };
type VisitorPrisonerRecord = { id: string; facility_id: string; facility_name: string; prisoner_number: string; display_name: string; relationship_status: string };
type VisitorCreditAccount = { facility_id: string; available_credits: number; reserved_credits: number; facility_name: string };
type VisitorCreditLedgerEntry = { id: string; entry_type: string; amount: number; reason: string; created_at: string };
type VisitorPaymentIntent = { id: string; facility_id: string; status: string; credit_quantity: number; amount_minor: number; currency: string; checkout_url: string | null; created_at: string };
type VisitorFacility = { id: string; name: string; timezone: string; current_state: string };
type VisitorData = { appointments: VisitorAppointmentRecord[]; relationships: VisitorRelationshipRecord[]; credits: VisitorCreditAccount[]; unreadNotifications: number; loading: boolean; refreshAppointments: () => Promise<void> };

const VisitorDataContext = createContext<VisitorData>({ appointments: [], relationships: [], credits: [], unreadNotifications: 0, loading: true, refreshAppointments: async () => undefined });

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
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "signed_out">("loading");
  const [visitorName, setVisitorName] = useState("Sarah");
  const [visitorData, setVisitorData] = useState<VisitorData>({ appointments: [], relationships: [], credits: [], unreadNotifications: 0, loading: true, refreshAppointments: async () => undefined });
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "Home";
    const requested = new URLSearchParams(window.location.search).get("section");
    return requested && ["Home", "Visits", "Connections", "Credits", "Account"].includes(requested) ? requested as Tab : "Home";
  });
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const syncVisitorCredits = useCallback((credits: VisitorCreditAccount[]) => setVisitorData((current) => ({ ...current, credits })), []);
  const refreshAppointments = useCallback(async () => {
    const response = await fetch("/api/visitor/appointments", { credentials: "include", headers: { accept: "application/json" } });
    const body = await response.json() as { appointments?: VisitorAppointmentRecord[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Could not refresh your visits.");
    setVisitorData((current) => ({ ...current, appointments: body.appointments || [] }));
  }, []);

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
      fetch("/api/visitor/appointments", { credentials: "include" }).then((response) => response.ok ? response.json() as Promise<{ appointments?: VisitorAppointmentRecord[] }> : { appointments: [] as VisitorAppointmentRecord[] }),
      fetch("/api/visitor/relationships", { credentials: "include" }).then((response) => response.ok ? response.json() as Promise<{ relationships?: VisitorRelationshipRecord[] }> : { relationships: [] as VisitorRelationshipRecord[] }),
      fetch("/api/visitor/credits", { credentials: "include" }).then((response) => response.ok ? response.json() as Promise<{ accounts?: VisitorCreditAccount[] }> : { accounts: [] as VisitorCreditAccount[] }),
      fetch("/api/visitor/notifications", { credentials: "include" }).then((response) => response.ok ? response.json() as Promise<{ notifications?: Array<{ status?: string }> }> : { notifications: [] as Array<{ status?: string }> }),
    ]).then(([appointments, relationships, credits, notifications]) => {
      if (!active) return;
      setVisitorData((current) => ({ ...current, appointments: appointments.appointments || [], relationships: relationships.relationships || [], credits: credits.accounts || [], unreadNotifications: (notifications.notifications || []).filter((item: { status?: string }) => item.status !== "READ").length, loading: false }));
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

  if (authState !== "authenticated") return <VisitorAuthGate loading={authState === "loading"} onAuthenticated={(name) => { setVisitorName(name); setAuthState("authenticated"); }} />;

  return (
    <VisitorDataContext.Provider value={{ ...visitorData, refreshAppointments }}>
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
        {tab === "Home" && <VisitorHome visitorName={visitorName} onAction={action} onOpenVisit={() => navigate("Visits")} onNavigate={navigate} />}
        {tab === "Visits" && <VisitorVisits onAction={action} onNavigate={navigate} />}
        {tab === "Connections" && <VisitorConnections onAction={action} onRelationshipAdded={(relationship) => setVisitorData((current) => ({ ...current, relationships: [relationship, ...current.relationships.filter((item) => item.id !== relationship.id)] }))} />}
        {tab === "Credits" && <VisitorCredits onAction={action} onCreditsLoaded={syncVisitorCredits} />}
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
  visitorName,
  onAction,
  onOpenVisit,
  onNavigate,
}: {
  visitorName: string;
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
  const recentActivity = [
    ...appointments.map((item) => ({ id: `appointment:${item.id}`, title: item.status === "APPROVED" ? `Visit approved with ${item.prisoner_name}` : item.status === "COMPLETED" ? `Visit completed with ${item.prisoner_name}` : `Visit request · ${item.prisoner_name} · ${visitorVisitStatus(item.status)}`, time: activityTime(item.updated_at || item.created_at), timestamp: Date.parse(item.updated_at || item.created_at || ""), tone: item.status === "APPROVED" || item.status === "COMPLETED" ? "green" : "orange", icon: item.status === "APPROVED" || item.status === "COMPLETED" ? "✓" : "◷" })),
    ...relationships.map((item) => ({ id: `relationship:${item.id}`, title: `Connection ${visitorVisitStatus(item.status).toLowerCase()} · ${item.prisoner_name}`, time: activityTime(item.updated_at || item.created_at), timestamp: Date.parse(item.updated_at || item.created_at || ""), tone: item.status === "APPROVED" ? "blue" : "sage", icon: "↔" })),
  ].sort((a, b) => (Number.isFinite(b.timestamp) ? b.timestamp : 0) - (Number.isFinite(a.timestamp) ? a.timestamp : 0)).slice(0, 4);
  const slides = [
    { eyebrow: "Your next visit", title: nextVisit ? "Your visit is scheduled" : "Plan your first visit", copy: nextVisit ? `${nextVisit.prisoner_name} is ready to see you.` : "Start by adding a connection and submitting a visit request.", button: nextVisit ? "View my visits" : "View connections", status: nextVisit ? "VISIT APPROVED" : "GET STARTED", theme: "peach", action: nextVisit ? onOpenVisit : () => onNavigate("Connections") },
    { eyebrow: "Before your visit", title: "Make sure you’re ready", copy: "Test your camera, microphone, and connection before your scheduled visit.", button: "View my visits", status: "RECOMMENDED", theme: "blue", action: () => onNavigate("Visits") },
    { eyebrow: "Good to know", title: "Join a little early", copy: "The waiting room opens shortly before your scheduled visit so you have time to settle in.", button: "View visit guidelines", status: "READY WHEN YOU ARE", theme: "sage", action: () => onAction("Visit guidance will be available with your appointment details.", "info") },
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
        <div><p className="sv4-kicker">Your visitor account</p><h1>Hello, {visitorName}</h1><p className="sv4-lead">Here’s the latest from your visits and connections.</p></div>
        <button className="sv4-help-link" onClick={() => onAction("Our visitor support team is here to help.", "info")}>Need a hand? <span>Visit support →</span></button>
      </section>

      <section className={`sv4-hero sv4-hero-${current.theme}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="sv4-hero-copy"><span className="sv4-hero-eyebrow">{current.eyebrow}</span><h2>{current.title}</h2><p>{current.copy}</p><VisitorButton primary onClick={current.action}>{current.button} <span>→</span></VisitorButton><span className="sv4-hero-status">{current.status}</span></div>
        <div className="sv4-hero-art" aria-hidden="true"><div className="sv4-art-grid" /><div className="sv4-art-path" /><div className="sv4-art-avatar"><span>AR</span></div><div className="sv4-art-device"><span>●</span><i /><i /><i /></div></div>
        <div className="sv4-hero-controls"><button onClick={() => setSlide((slide + slides.length - 1) % slides.length)} aria-label="Previous story">←</button><span>{slides.map((_, index) => <i key={index} className={index === slide ? "active" : ""} />)}</span><button onClick={() => setSlide((slide + 1) % slides.length)} aria-label="Next story">→</button></div>
      </section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Make it easy</p><h2>What would you like to do?</h2></div><button className="sv4-text-link" onClick={() => onNavigate("Visits")}>See all visits →</button></div><div className="sv4-action-grid">
        <QuickAction icon="＋" title="Book a visit" copy="Find a time to see someone" onClick={() => onNavigate("Visits")} tone="orange" />
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

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">People in your circle</p><h2>Your connections</h2></div><button className="sv4-text-link" onClick={() => onNavigate("Connections")}>Manage connections →</button></div><div className="sv4-connection-scroll">{connection ? <ConnectionCard initials={connection.prisoner_name.split(" ").map((part) => part[0]).join("").slice(0, 2)} name={connection.prisoner_name} relation={connection.relationship_type} color="sage" onClick={() => onNavigate("Connections")} /> : <div className="sv4-empty-inline">{loading ? "Loading connections…" : "No approved connections yet."}</div>}<button className="sv4-add-card" onClick={() => onNavigate("Connections")}><span>＋</span><strong>Add a connection</strong><small>Who would you like to see?</small></button></div></section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">A little help along the way</p><h2>For you</h2></div></div><div className="sv4-recommend-grid"><Recommendation icon="⌁" title="Device ready" copy="Take a quick check before you join." action="View my visits" onClick={() => onNavigate("Visits")} tone="blue" /><Recommendation icon="◷" title={nextVisit ? "Visit scheduled" : "Plan a visit"} copy={nextVisit ? "Everything is in place for your visit." : "Add a connection to get started."} action={nextVisit ? "View my visits" : "View connections"} onClick={nextVisit ? onOpenVisit : () => onNavigate("Connections")} tone="orange" /><Recommendation icon="◇" title={`${availableCredits} Visit Credit${availableCredits === 1 ? "" : "s"}`} copy={availableCredits ? "Available for an approved visit." : "Top up when you are ready to book."} action="View credits" onClick={() => onNavigate("Credits")} tone="sage" /></div></section>

      <section className="sv4-section sv4-guidance-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Feel ready</p><h2>Before your visit</h2></div><button className="sv4-text-link" onClick={() => onAction("All visit guidance opened.", "info")}>See all guidance →</button></div><div className="sv4-guidance-grid"><GuidanceCard number="01" title="Find a quiet place" copy="A calm space helps you focus on the conversation." /><GuidanceCard number="02" title="Test your connection" copy="Check your camera, microphone, and internet." /><GuidanceCard number="03" title="Join a little early" copy="Your waiting room opens ten minutes before." /></div></section>

      <section className="sv4-section sv4-activity-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">Your SecureVisit story</p><h2>Recent activity</h2></div></div><div className="sv4-activity-list">{recentActivity.length ? recentActivity.map((item) => <Activity key={item.id} icon={item.icon} title={item.title} time={item.time} tone={item.tone} />) : <div className="sv4-empty-inline">Your visit and connection updates will appear here.</div>}</div></section>
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
  return <div className="sv4-activity-row"><span className={`sv4-activity-icon sv4-tone-${tone}`}>{icon}</span><span><strong>{title}</strong><small>{time}</small></span></div>;
}

function activityTime(value?: string) {
  if (!value) return "Recently";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  if (elapsedMinutes < 1440) {
    const hours = Math.floor(elapsedMinutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(timestamp));
}

function visitorLocalDate(date: Date, timeZone?: string) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function visitorVisitStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visitorVisitTime(value: string, timeZone?: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(date);
}

function VisitorVisits({ onAction, onNavigate }: { onAction: (message: string, tone?: NoticeTone) => void; onNavigate: (tab: Tab) => void }) {
  const { appointments, relationships, credits, loading, refreshAppointments } = useContext(VisitorDataContext);
  const [view, setView] = useState("Upcoming");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<VisitorAppointmentRecord | null>(null);
  const [relationshipId, setRelationshipId] = useState("");
  const [bookingDate, setBookingDate] = useState(() => visitorLocalDate(new Date(Date.now() + 86400000)));
  const [duration, setDuration] = useState(15);
  const [slots, setSlots] = useState<string[]>([]);
  const [availabilityTimezone, setAvailabilityTimezone] = useState("Asia/Jakarta");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const requestKey = useRef<string | null>(null);
  const approvedRelationships = relationships.filter((item) => item.status === "APPROVED");
  const selectedRelationship = approvedRelationships.find((item) => item.id === relationshipId);
  const availableCredits = credits.find((item) => item.facility_id === selectedRelationship?.facility_id)?.available_credits || 0;

  useEffect(() => {
    if (!bookingOpen || !selectedRelationship) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ facilityId: selectedRelationship.facility_id, prisonerId: selectedRelationship.prisoner_id, date: bookingDate, duration: String(duration) });
    if (rescheduleTarget) query.set("excludeAppointmentId", rescheduleTarget.id);
    fetch(`/api/visitor/availability?${query}`, { credentials: "include", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { slots?: string[]; timezone?: string; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load visit availability.");
        setSlots((body.slots || []).filter((slot) => !rescheduleTarget || slot !== rescheduleTarget.requested_start));
        setAvailabilityTimezone(body.timezone || "Asia/Jakarta");
        setSelectedSlot("");
        setAvailabilityError("");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSlots([]);
        setAvailabilityError(error instanceof Error ? error.message : "Could not load visit availability.");
      })
      .finally(() => !controller.signal.aborted && setAvailabilityLoading(false));
    return () => controller.abort();
  }, [appointments, bookingDate, bookingOpen, duration, rescheduleTarget, selectedRelationship]);

  const requests = appointments.filter((item) => ["SUBMITTED", "UNDER_REVIEW"].includes(item.status));
  const upcoming = appointments.filter((item) => ["APPROVED", "WAITING", "IN_PROGRESS"].includes(item.status));
  const history = appointments.filter((item) => ["COMPLETED", "CANCELLED_BY_VISITOR", "CANCELLED_BY_FACILITY", "REJECTED", "FAILED", "NO_SHOW"].includes(item.status));

  function openBooking() {
    setFormError("");
    setRescheduleTarget(null);
    if (!approvedRelationships.length) {
      onNavigate("Connections");
      onAction("A connection must be approved by the facility before you can request a visit.", "info");
      return;
    }
    setRelationshipId((current) => current || approvedRelationships[0].id);
    setSlots([]);
    setSelectedSlot("");
    setAvailabilityLoading(true);
    setAvailabilityError("");
    setBookingOpen(true);
  }

  function openReschedule(appointment: VisitorAppointmentRecord) {
    const relationship = approvedRelationships.find((item) => item.facility_id === appointment.facility_id && item.prisoner_id === appointment.prisoner_id);
    if (!relationship) {
      onAction("This connection is no longer approved. Contact the facility before changing the visit time.", "info");
      return;
    }
    setFormError("");
    setRescheduleTarget(appointment);
    setRelationshipId(relationship.id);
    setBookingDate(visitorLocalDate(new Date(appointment.requested_start), appointment.timezone || "Asia/Jakarta"));
    setDuration(Math.round((Date.parse(appointment.requested_end) - Date.parse(appointment.requested_start)) / 60_000));
    setSlots([]);
    setSelectedSlot("");
    setAvailabilityLoading(true);
    setAvailabilityError("");
    requestKey.current = null;
    setView("Requests");
    setBookingOpen(true);
  }

  function closeBooking() {
    setBookingOpen(false);
    setSlots([]);
    setSelectedSlot("");
    setAvailabilityLoading(false);
    setAvailabilityError("");
    requestKey.current = null;
    setRescheduleTarget(null);
  }

  async function submitVisitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRelationship || !selectedSlot) return setFormError("Choose an available time before continuing.");
    if (!rescheduleTarget && availableCredits < 1) return setFormError("Add at least one Visit Credit for this facility before requesting a visit.");
    setSubmitting(true);
    setFormError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const start = new Date(selectedSlot);
      const end = new Date(start.getTime() + duration * 60_000);
      const rescheduleBody = rescheduleTarget ? {
        appointmentId: rescheduleTarget.id,
        action: "reschedule",
        requestedStart: start.toISOString(),
        requestedEnd: end.toISOString(),
        expectedVersion: rescheduleTarget.version,
      } : null;
      const response = await fetch("/api/visitor/appointments", {
        method: rescheduleTarget ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "Idempotency-Key": requestKey.current },
        body: JSON.stringify(rescheduleBody || { relationshipId: selectedRelationship.id, requestedStart: start.toISOString(), requestedEnd: end.toISOString(), appointmentType: "FAMILY" }),
      });
      const body = await response.json() as { appointmentId?: string; error?: string };
      if (!response.ok) throw new Error(body.error || (rescheduleTarget ? "Your new time could not be requested." : "Your visit request could not be sent."));
      requestKey.current = null;
      closeBooking();
      setView("Requests");
      await refreshAppointments();
      onAction(rescheduleTarget ? "Your new visit time was sent to the facility for review." : "Your request was sent to the facility for review.", "success");
    } catch (error) {
      setFormError(error instanceof Error ? error.message.replaceAll("_", " ") : rescheduleTarget ? "Your new time could not be requested. Please retry." : "Your visit request could not be sent. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelVisit(appointment: VisitorAppointmentRecord) {
    if (!window.confirm("Cancel this visit request? The facility will see that it was cancelled.")) return;
    try {
      const response = await fetch("/api/visitor/appointments", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ appointmentId: appointment.id, action: "cancel", expectedVersion: appointment.version }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "This visit could not be cancelled.");
      await refreshAppointments();
      onAction("Your visit request has been cancelled.", "success");
    } catch (error) {
      onAction(error instanceof Error ? error.message.replaceAll("_", " ") : "This visit could not be cancelled.", "info");
    }
  }

  const tabs = ["Upcoming", "Requests", "History"];
  const visibleAppointments = view === "Requests" ? requests : view === "History" ? history : upcoming;

  return <div className="sv4-page sv4-inner-page">
    <div className="sv4-page-intro sv4-visits-intro"><div><p className="sv4-kicker">Your visits</p><h1>Time together, made simple.</h1><p>Request a time, follow the facility’s decision, and prepare when your visit is approved.</p></div><VisitorButton primary onClick={openBooking}>＋ Request a visit</VisitorButton></div>
    <div className="sv4-segmented">{tabs.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}{item === "Requests" && requests.length > 0 && <b>{requests.length}</b>}{item === "Upcoming" && upcoming.length > 0 && <b>{upcoming.length}</b>}</button>)}</div>
    {bookingOpen && <section className="sv4-visit-booking" aria-labelledby="sv4-booking-title"><div className="sv4-booking-heading"><div><p className="sv4-kicker">A few simple steps</p><h2 id="sv4-booking-title">{rescheduleTarget ? "Choose a new time" : "Request a visit"}</h2><p>{rescheduleTarget ? "The facility will review your updated request before confirming a visit." : "Choose an approved connection and an available time. The facility makes the final decision."}</p></div><button type="button" className="sv11-back-button" onClick={closeBooking} disabled={submitting}>Close</button></div>
      <form onSubmit={submitVisitRequest}>
        <label>Who would you like to see?<select value={relationshipId} disabled={Boolean(rescheduleTarget)} onChange={(event) => { setRelationshipId(event.target.value); setSlots([]); setSelectedSlot(""); setAvailabilityLoading(true); setAvailabilityError(""); requestKey.current = null; }} required>{approvedRelationships.map((item) => <option key={item.id} value={item.id}>{item.prisoner_name} · {item.facility_name}</option>)}</select></label>
        <div className="sv4-booking-fields"><label>Choose a day<input type="date" min={visitorLocalDate(new Date())} value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setSlots([]); setSelectedSlot(""); setAvailabilityLoading(true); setAvailabilityError(""); requestKey.current = null; }} required /></label><label>Visit length<select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setSlots([]); setSelectedSlot(""); setAvailabilityLoading(true); setAvailabilityError(""); requestKey.current = null; }}><option value={15}>15 minutes</option><option value={30}>30 minutes</option></select></label></div>
        <div className="sv4-available-times"><div><strong>Available times</strong><span>{rescheduleTarget ? "Existing request · no new credit needed" : `${availableCredits} Visit Credit${availableCredits === 1 ? "" : "s"} available`}</span></div>{availabilityLoading ? <p className="sv4-booking-message">Checking the facility schedule…</p> : availabilityError ? <p className="sv4-request-error" role="alert">{availabilityError.replaceAll("_", " ")}</p> : slots.length ? <div className="sv4-slot-grid" role="radiogroup" aria-label="Available visit times">{slots.map((slot) => <label key={slot} className={selectedSlot === slot ? "selected" : ""}><input type="radio" name="visit-time" value={slot} checked={selectedSlot === slot} onChange={() => { setSelectedSlot(slot); requestKey.current = null; }} /><span>{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: availabilityTimezone }).format(new Date(slot))}</span></label>)}</div> : <p className="sv4-booking-message">No available times for this day. Try another date.</p>}</div>
        {!rescheduleTarget && availableCredits < 1 && <div className="sv4-booking-credit-note"><span>You’ll need a Visit Credit before sending this request.</span><button type="button" onClick={() => onNavigate("Credits")}>View credits →</button></div>}
        {formError && <p className="sv4-request-error" role="alert">{formError}</p>}
        <div className="sv4-request-actions"><button type="button" className="sv11-back-button" onClick={closeBooking} disabled={submitting}>Not now</button><button className="sv4-button sv4-button-primary" disabled={submitting || availabilityLoading || !selectedSlot || (!rescheduleTarget && availableCredits < 1)}>{submitting ? "Sending request…" : rescheduleTarget ? "Request new time" : "Send visit request"}</button></div>
      </form>
    </section>}
    {loading ? <div className="sv4-empty-inline">Loading your visits…</div> : visibleAppointments.length ? <div className="sv4-appointment-list">{visibleAppointments.map((appointment) => <article className="sv4-appointment-card" key={appointment.id}><div className="sv4-appointment-date"><strong>{new Intl.DateTimeFormat("en", { day: "2-digit", timeZone: appointment.timezone || "Asia/Jakarta" }).format(new Date(appointment.requested_start))}</strong><span>{new Intl.DateTimeFormat("en", { month: "short", timeZone: appointment.timezone || "Asia/Jakarta" }).format(new Date(appointment.requested_start))}</span></div><div className="sv4-appointment-copy"><div className="sv4-appointment-title"><h2>{appointment.prisoner_name}</h2><VisitorStatus tone={["APPROVED", "WAITING", "IN_PROGRESS"].includes(appointment.status) ? "green" : ["REJECTED", "CANCELLED_BY_VISITOR", "CANCELLED_BY_FACILITY", "FAILED"].includes(appointment.status) ? "blue" : "orange"}>{visitorVisitStatus(appointment.status)}</VisitorStatus></div><p>{visitorVisitTime(appointment.requested_start, appointment.timezone)} · {Math.round((Date.parse(appointment.requested_end) - Date.parse(appointment.requested_start)) / 60000)} minutes</p><small>Request ID · {appointment.id}</small></div><div className="sv4-appointment-actions"><Link className="muted" href={`/visitor/visits/${encodeURIComponent(appointment.id)}`}>View details</Link>{["SUBMITTED", "UNDER_REVIEW"].includes(appointment.status) && <button className="muted" onClick={() => openReschedule(appointment)}>Change time</button>}{["SUBMITTED", "UNDER_REVIEW", "APPROVED", "WAITING"].includes(appointment.status) && <button className="muted" onClick={() => void cancelVisit(appointment)}>Cancel</button>}</div></article>)}</div> : <div className="sv4-empty-state"><span>{view === "History" ? "◷" : view === "Requests" ? "↗" : "＋"}</span><h2>{view === "History" ? "No past visits yet" : view === "Requests" ? "No requests in review" : "Nothing scheduled yet"}</h2><p>{view === "History" ? "Completed and cancelled visits will appear here." : view === "Requests" ? "New requests and facility decisions will appear here." : "Start with one of your approved connections to find a time."}</p>{view === "Upcoming" && <VisitorButton primary onClick={openBooking}>Request a visit <span>→</span></VisitorButton>}</div>}
  </div>;
}

function VisitorConnections({ onAction, onRelationshipAdded }: { onAction: (message: string, tone?: NoticeTone) => void; onRelationshipAdded: (relationship: VisitorRelationshipRecord) => void }) {
  const { relationships, loading } = useContext(VisitorDataContext);
  const [prisoners, setPrisoners] = useState<VisitorPrisonerRecord[]>([]);
  const [prisonersLoading, setPrisonersLoading] = useState(true);
  const [prisonerError, setPrisonerError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [prisonerId, setPrisonerId] = useState("");
  const [relationshipType, setRelationshipType] = useState("Family member");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [uploadingCaseId, setUploadingCaseId] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/visitor/prisoners", { credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { prisoners?: VisitorPrisonerRecord[]; error?: string };
        if (!response.ok) throw new Error(body.error || "We couldn’t load the facility directory.");
        if (active) setPrisoners(body.prisoners || []);
      })
      .catch((error: unknown) => active && setPrisonerError(error instanceof Error ? error.message : "We couldn’t load the facility directory."))
      .finally(() => active && setPrisonersLoading(false));
    return () => { active = false; };
  }, []);

  const matchingPrisoners = prisoners.filter((person) => `${person.display_name} ${person.prisoner_number}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedPrisoner = prisoners.find((person) => person.id === prisonerId);
  const statusLabel = (status: string) => status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Not approved" : status === "NEEDS_INFO" ? "More information needed" : "In review";
  const statusTone = (status: string): "green" | "orange" | "blue" => status === "APPROVED" ? "green" : status === "REJECTED" ? "blue" : "orange";
  const displayStatus = (relationship: VisitorRelationshipRecord) => relationship.verification_status === "MORE_INFO" ? "NEEDS_INFO" : relationship.status;

  async function uploadEvidence(verificationCaseId: string, file: File) {
    if (file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) throw new Error("Choose a JPG, PNG, or PDF up to 10 MB.");
    const form = new FormData();
    form.set("verificationCaseId", verificationCaseId);
    form.set("file", file);
    const response = await fetch("/api/visitor/verification/evidence", { method: "POST", credentials: "include", body: form });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error === "EVIDENCE_STORAGE_NOT_CONFIGURED" ? "Secure document upload is not available yet. Your request is saved; try again when the facility enables uploads." : body.error || "We couldn’t upload this document.");
    const relationship = relationships.find((item) => item.verification_case_id === verificationCaseId);
    if (relationship) onRelationshipAdded({ ...relationship, evidence_count: Number(relationship.evidence_count || 0) + 1 });
  }

  async function submitRelationship(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPrisoner) return setFormError("Choose a person from the facility directory.");
    if (!evidenceFile) return setFormError("Choose an identity or relationship document to send with your request.");
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/visitor/relationships", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ facilityId: selectedPrisoner.facility_id, prisonerId: selectedPrisoner.id, relationshipType }),
      });
      const body = await response.json() as { relationshipId?: string; verificationId?: string; status?: string; error?: string };
      if (!response.ok || !body.relationshipId) throw new Error(body.error || "We couldn’t submit this connection request.");
      const relationship = { id: body.relationshipId, facility_id: selectedPrisoner.facility_id, prisoner_id: selectedPrisoner.id, status: body.status || "PENDING", prisoner_name: selectedPrisoner.display_name, relationship_type: relationshipType, facility_name: selectedPrisoner.facility_name, verification_case_id: body.verificationId || null, evidence_count: 0 };
      onRelationshipAdded(relationship);
      if (relationship.status !== "APPROVED") {
        if (!body.verificationId) throw new Error("Your request was saved, but its review case could not be opened. Refresh Connections before continuing.");
        await uploadEvidence(body.verificationId, evidenceFile);
        onRelationshipAdded({ ...relationship, evidence_count: 1 });
      }
      setFormOpen(false);
      setPrisonerId("");
      setSearch("");
      setEvidenceFile(null);
      onAction(relationship.status === "APPROVED" ? "This connection is already approved." : "Request and supporting document sent. The facility team will review your connection.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We couldn’t submit this connection request.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="sv4-page sv4-inner-page">
    <div className="sv4-page-intro sv4-intro-split"><div><p className="sv4-kicker">Your people</p><h1>Connections</h1><p>Request permission to visit someone. The facility team reviews every connection.</p></div><VisitorButton primary onClick={() => { setFormOpen((open) => !open); setFormError(""); }}>＋ Request a connection</VisitorButton></div>
    {formOpen && <form className="sv4-connection-request" onSubmit={submitRelationship}>
      <div><p className="sv4-kicker">New connection</p><h2>Who would you like to visit?</h2><p>We’ll send your request to the facility team for review.</p></div>
      {prisonerError && <p className="sv4-request-error" role="alert">{prisonerError}</p>}
      <label>Find the person<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPrisonerId(""); }} placeholder="Search by name or prisoner ID" disabled={prisonersLoading || !!prisonerError} /></label>
      <div className="sv4-prisoner-options" role="radiogroup" aria-label="Available people">
        {prisonersLoading ? <p className="sv4-request-hint">Loading the facility directory…</p> : matchingPrisoners.length ? matchingPrisoners.map((person) => <label key={person.id} className={`sv4-prisoner-option ${prisonerId === person.id ? "selected" : ""} ${person.relationship_status !== "NOT_CONNECTED" ? "unavailable" : ""}`}><input type="radio" name="prisoner" value={person.id} checked={prisonerId === person.id} disabled={person.relationship_status !== "NOT_CONNECTED"} onChange={() => setPrisonerId(person.id)} /><span><strong>{person.display_name}</strong><small>{person.facility_name} · ID {person.prisoner_number}</small></span>{person.relationship_status !== "NOT_CONNECTED" && <em>{statusLabel(person.relationship_status)}</em>}</label>) : <p className="sv4-request-hint">No available people match that search.</p>}
      </div>
      <label>Your relationship<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option>Family member</option><option>Spouse or partner</option><option>Friend</option><option>Legal representative</option><option>Other</option></select></label>
      <label>Identity or relationship document<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} required /><small>JPG, PNG, or PDF · up to 10 MB. Files are stored in protected facility storage.</small></label>
      <p className="sv4-request-hint">Your document is shared with authorized facility reviewers for this request. Don’t upload unrelated records.</p>
      {formError && <p className="sv4-request-error" role="alert">{formError}</p>}
      <div className="sv4-request-actions"><button type="button" className="sv11-back-button" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button><button className="sv4-button sv4-button-primary" disabled={submitting || prisonersLoading || !prisonerId}>{submitting ? "Sending request…" : "Send for review"}</button></div>
    </form>}
    {relationships[0] && <article className="sv4-feature-connection"><div className="sv4-feature-art"><div className="sv4-feature-sun" /><div className="sv4-feature-person one">{relationships[0].prisoner_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div className="sv4-feature-person two">{displayStatus(relationships[0]) === "APPROVED" ? "✓" : "…"}</div></div><div className="sv4-feature-copy"><VisitorStatus tone={statusTone(displayStatus(relationships[0]))}>{statusLabel(displayStatus(relationships[0])).toUpperCase()}</VisitorStatus><h2>{relationships[0].prisoner_name}</h2><p>{relationships[0].relationship_type} · {relationships[0].facility_name || "Facility review"}</p><div className="sv4-feature-rule" /><p className="sv4-feature-note">{displayStatus(relationships[0]) === "APPROVED" ? "This connection is approved. You can request a visit when booking is available." : displayStatus(relationships[0]) === "NEEDS_INFO" ? "The facility team needs more information. Add the requested document to continue the review." : "Your request is saved. We’ll update your account when the facility team has reviewed it."}</p></div></article>}
    <div className="sv4-section-heading sv4-connection-heading"><div><p className="sv4-kicker">Your circle</p><h2>All connection requests</h2></div></div>
    {loading ? <div className="sv4-empty-inline">Loading your connections…</div> : relationships.length ? <div className="sv4-connection-list sv4-relationship-list">{relationships.map((relationship) => { const state = displayStatus(relationship); const canAddEvidence = state !== "APPROVED" && state !== "REJECTED"; const needsMoreEvidence = Number(relationship.evidence_count || 0) === 0 || state === "NEEDS_INFO"; return <article key={relationship.id} className="sv4-relationship-card"><VisitorAvatar initials={relationship.prisoner_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()} color="sage" /><span><strong>{relationship.prisoner_name}</strong><small>{relationship.relationship_type} · {relationship.facility_name || "Facility review"}</small>{canAddEvidence && <small>{Number(relationship.evidence_count || 0) > 0 ? `${relationship.evidence_count} supporting document${relationship.evidence_count === 1 ? "" : "s"} received` : "Supporting document still needed"}</small>}</span><VisitorStatus tone={statusTone(state)}>{statusLabel(state)}</VisitorStatus>{canAddEvidence && needsMoreEvidence && relationship.verification_case_id && <label className="sv4-evidence-retry">{state === "NEEDS_INFO" ? "Add information" : "Add document"}<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={uploadingCaseId === relationship.verification_case_id} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const caseId = relationship.verification_case_id!; setUploadingCaseId(caseId); try { await uploadEvidence(caseId, file); onAction("Supporting document uploaded."); } catch (error) { onAction(error instanceof Error ? error.message : "We couldn’t upload this document.", "info"); } finally { setUploadingCaseId(""); event.target.value = ""; } }} />{uploadingCaseId === relationship.verification_case_id ? "Uploading…" : ""}</label>}</article>; })}</div> : <div className="sv4-empty-state"><span>↔</span><h2>Your connections will appear here</h2><p>Send a request to begin the facility’s identity and relationship review.</p></div>}
    {!formOpen && <button className="sv4-new-connection" onClick={() => setFormOpen(true)}><span>＋</span><strong>Request another connection</strong><small>Start a secure facility review</small></button>}
  </div>;
}

function VisitorCredits({ onAction, onCreditsLoaded }: { onAction: (message: string, tone?: NoticeTone) => void; onCreditsLoaded: (credits: VisitorCreditAccount[]) => void }) {
  const { credits: cachedCredits } = useContext(VisitorDataContext);
  const [accounts, setAccounts] = useState(cachedCredits);
  const [ledger, setLedger] = useState<VisitorCreditLedgerEntry[]>([]);
  const [payments, setPayments] = useState<VisitorPaymentIntent[]>([]);
  const [facilities, setFacilities] = useState<VisitorFacility[]>([]);
  const [pricePerCredit, setPricePerCredit] = useState<number | null>(null);
  const [demoPrice, setDemoPrice] = useState(false);
  const [facilityId, setFacilityId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/visitor/credits", { credentials: "include" }).then(async (response) => { const body = await response.json() as { accounts?: VisitorCreditAccount[]; ledger?: VisitorCreditLedgerEntry[]; error?: string }; if (!response.ok) throw new Error(body.error || "Couldn’t load your credit balance."); return body; }),
      fetch("/api/visitor/payments", { credentials: "include" }).then(async (response) => { const body = await response.json() as { paymentIntents?: VisitorPaymentIntent[]; pricing?: { perCreditMinor: number; currency: string; demo: boolean }; error?: string }; if (!response.ok) throw new Error(body.error || "Couldn’t load payment options."); return body; }),
      fetch("/api/visitor/facilities", { credentials: "include" }).then(async (response) => { const body = await response.json() as { facilities?: VisitorFacility[]; error?: string }; if (!response.ok) throw new Error(body.error || "Couldn’t load available facilities."); return body; }),
    ]).then(([creditBody, paymentBody, facilityBody]) => {
      if (!active) return;
      const nextAccounts = creditBody.accounts || [];
      setAccounts(nextAccounts);
      setLedger(creditBody.ledger || []);
      onCreditsLoaded(nextAccounts);
      setPayments(paymentBody.paymentIntents || []);
      setPricePerCredit(paymentBody.pricing?.perCreditMinor ?? null);
      setDemoPrice(paymentBody.pricing?.demo ?? false);
      const nextFacilities = facilityBody.facilities || [];
      setFacilities(nextFacilities);
      setFacilityId((current) => current || nextFacilities[0]?.id || "");
      setError("");
    }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Couldn’t load your Visit Credits."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [onCreditsLoaded, refreshTick]);

  async function startPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!facilityId || pricePerCredit === null) return setError("Choose an available facility before continuing.");
    const fingerprint = `${facilityId}:${quantity}`;
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) idempotencyRef.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/visitor/payments", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": idempotencyRef.current.key },
        body: JSON.stringify({ facilityId, creditQuantity: quantity }),
      });
      const body = await response.json() as { paymentIntent?: { id: string; status: string; checkoutUrl?: string | null; checkout_url?: string | null }; error?: string };
      if (!response.ok || !body.paymentIntent) {
        const friendly = body.error === "PAYMENT_PROVIDER_NOT_CONFIGURED" ? "Secure checkout isn’t enabled yet. Your balance has not been charged." : body.error === "VISIT_CREDIT_PRICE_NOT_CONFIGURED" ? "The facility has not configured its Visit Credit price yet." : body.error || "We couldn’t start checkout. Please try again.";
        throw new Error(friendly);
      }
      const checkoutUrl = body.paymentIntent.checkoutUrl || body.paymentIntent.checkout_url;
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setNotice("Payment request saved. Refresh this page after completing checkout to see the confirmed credit balance.");
      setRefreshTick((value) => value + 1);
      onAction("Your payment request is ready.", "info");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t start checkout. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const available = accounts.reduce((sum, account) => sum + Number(account.available_credits || 0), 0);
  const reserved = accounts.reduce((sum, account) => sum + Number(account.reserved_credits || 0), 0);
  const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const entryLabel = (entry: VisitorCreditLedgerEntry) => entry.entry_type === "PURCHASE" ? "Visit Credits added" : entry.entry_type === "RESERVATION" ? "Visit Credit reserved" : entry.entry_type === "CONSUMPTION" ? "Visit completed" : entry.entry_type === "RESERVATION_RELEASE" ? "Visit Credit returned" : entry.entry_type === "REFUND" ? "Purchase refunded" : entry.entry_type.replaceAll("_", " ").toLowerCase();

  return <div className="sv4-page sv4-inner-page">
    <div className="sv4-page-intro"><p className="sv4-kicker">Visit Credits</p><h1>Keep your visits going.</h1><p>One Visit Credit covers one approved video visit. Your balance only changes after a confirmed payment or visit outcome.</p></div>
    <section className="sv4-credit-hero"><div><span className="sv4-hero-eyebrow">Available balance</span><strong>{loading ? "—" : available}</strong><p>Visit Credits</p></div><div className="sv4-credit-orbit">◇<small>{loading ? "…" : `${reserved} reserved`}</small></div></section>
    {reserved > 0 && <div className="sv4-credit-note"><span>i</span><p><strong>{reserved} {reserved === 1 ? "credit is" : "credits are"} reserved</strong><br />for approved or upcoming visits.</p></div>}
    <section className="sv4-credit-purchase"><div><p className="sv4-kicker">Top up securely</p><h2>Choose a credit pack</h2><p>Checkout opens with the configured payment service. Credits are added only after its signed confirmation.</p></div>
      {demoPrice && <p className="sv4-request-hint">Development example price: {pricePerCredit === null ? "—" : currency.format(pricePerCredit)} per credit. This is not an approved production tariff.</p>}
      <form onSubmit={startPurchase}>
        <label>Facility<select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); idempotencyRef.current = null; }} disabled={loading || !facilities.length} required>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
        <div className="sv4-credit-packs" role="radiogroup" aria-label="Visit Credit quantity">{[1, 3, 5].map((pack) => <label key={pack} className={`sv4-credit-pack ${quantity === pack ? "selected" : ""}`}><input type="radio" name="credit-pack" checked={quantity === pack} onChange={() => { setQuantity(pack); idempotencyRef.current = null; }} /><strong>{pack}</strong><span>{pack === 1 ? "credit" : "credits"}</span>{pricePerCredit !== null && <small>{currency.format(pricePerCredit * pack)}</small>}</label>)}</div>
        {error && <p className="sv4-request-error" role="alert">{error}</p>}{notice && <p className="sv4-request-success" role="status">{notice}</p>}
        <button className="sv4-button sv4-button-primary" disabled={loading || busy || !facilityId || pricePerCredit === null}>{busy ? "Preparing secure checkout…" : `Continue · ${pricePerCredit === null ? "price unavailable" : currency.format(pricePerCredit * quantity)}`}</button>
        {!facilities.length && !loading && <p className="sv4-request-hint">No facility is currently accepting Visit Credit purchases.</p>}
      </form>
    </section>
    <div className="sv4-section-heading"><div><p className="sv4-kicker">Your balance</p><h2>Credit activity</h2></div></div>
    {ledger.length ? <div className="sv4-credit-list">{ledger.map((entry) => <div key={entry.id}><span className={`sv4-credit-dot ${entry.amount > 0 ? "green" : entry.amount < 0 ? "orange" : "blue"}`}>{entry.amount > 0 ? "+" : entry.amount < 0 ? "−" : "✓"}</span><span><strong>{entryLabel(entry)}</strong><small>{entry.reason} · {new Date(entry.created_at).toLocaleDateString("id-ID")}</small></span><b>{entry.amount > 0 ? "+" : ""}{entry.amount}</b></div>)}</div> : <div className="sv4-empty-inline">{loading ? "Loading credit activity…" : "Your confirmed credit activity will appear here."}</div>}
    <div className="sv4-section-heading"><div><p className="sv4-kicker">Payments</p><h2>Checkout history</h2></div><button className="sv4-text-link" onClick={() => setRefreshTick((value) => value + 1)} disabled={loading}>Refresh status ↻</button></div>
    {payments.length ? <div className="sv4-payment-list">{payments.map((payment) => <div key={payment.id}><span><strong>{payment.credit_quantity} {payment.credit_quantity === 1 ? "Visit Credit" : "Visit Credits"}</strong><small>{new Date(payment.created_at).toLocaleString("id-ID")} · {currency.format(payment.amount_minor)}</small></span><VisitorStatus tone={payment.status === "SUCCEEDED" ? "green" : payment.status === "FAILED" || payment.status === "REFUNDED" ? "blue" : "orange"}>{payment.status.replaceAll("_", " ")}</VisitorStatus>{payment.status === "CHECKOUT_CREATED" && payment.checkout_url && <button type="button" onClick={() => window.location.assign(payment.checkout_url!)}>Continue checkout →</button>}</div>)}</div> : <div className="sv4-empty-inline">Your payment attempts will appear here.</div>}
  </div>;
}

function VisitorAccount({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <div className="sv4-page sv4-inner-page"><div className="sv4-account-hero"><VisitorAvatar initials="SA" color="coral" /><div><p className="sv4-kicker">Your account</p><h1>Sarah Amelia</h1><p>Member since June 2026</p></div><VisitorStatus>PROFILE COMPLETE</VisitorStatus></div><div className="sv4-profile-progress"><div><strong>Your profile</strong><span>75% complete</span></div><div className="sv4-progress"><i /></div><p>Add an emergency contact to finish setting up your profile.</p></div><div className="sv4-account-list"><button onClick={() => onAction("Profile editing is ready for your details.", "info")}><span>◎</span><strong>Personal details</strong><small>Update your name, email, and phone</small><b>→</b></button><button onClick={() => onAction("Notification preferences opened.", "info")}><span>♢</span><strong>Notifications</strong><small>Choose how we keep you updated</small><b>→</b></button><button onClick={() => onAction("Privacy and security settings opened.", "info")}><span>⌁</span><strong>Privacy & security</strong><small>Manage your secure account</small><b>→</b></button><button onClick={() => onAction("Help center opened.", "info")}><span>?</span><strong>Help center</strong><small>Find answers and contact support</small><b>→</b></button></div><button className="sv4-signout" onClick={() => onAction("You are still signed in to this secure session.", "info")}>Sign out of SecureVisit</button></div>;
}

function VisitorNotifications({ onAction }: { onAction: (message: string, tone?: NoticeTone) => void }) {
  return <aside className="sv4-notifications"><div className="sv4-notifications-head"><div><p className="sv4-kicker">Your inbox</p><h2>Notifications</h2></div><span>2 new</span></div><button onClick={() => onAction("Your visit details are ready.", "info")}><span className="sv4-notification-icon orange">✓</span><span><strong>Visit approved</strong><small>Your visit with A. Rahman is tomorrow.</small><em>Yesterday</em></span><b>●</b></button><button onClick={() => onAction("Device check is ready when you are.", "info")}><span className="sv4-notification-icon blue">⌁</span><span><strong>Device check recommended</strong><small>Take a quick check before your visit.</small><em>Yesterday</em></span><b>●</b></button><button onClick={() => onAction("A credit was returned to your balance.", "success")}><span className="sv4-notification-icon sage">◇</span><span><strong>Credit returned</strong><small>Your completed visit returned one credit.</small><em>12 Aug</em></span></button><button className="sv4-notifications-all" onClick={() => onAction("All notifications marked as read.", "success")}>Mark all as read</button></aside>;
}
