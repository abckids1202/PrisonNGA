"use client";

import { useEffect, useState, type ReactNode } from "react";

type Tab = "Home" | "Visits" | "Connections" | "Credits" | "Account";
type NoticeTone = "success" | "info";

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
  const [tab, setTab] = useState<Tab>("Home");
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("section");
    if (requested && ["Home", "Visits", "Connections", "Credits", "Account"].includes(requested)) {
      setTab(requested as Tab);
    }
  }, []);

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

  return (
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
            <button className={`sv4-icon-button ${notificationsOpen ? "active" : ""}`} onClick={() => setNotificationsOpen((value) => !value)} aria-label="Open notifications">♢<b>2</b></button>
            <button className="sv4-profile-chip" onClick={() => navigate("Account")} aria-label="Open account">
              <VisitorAvatar initials="SA" color="coral" /><span>Sarah</span><em>⌄</em>
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
  );
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
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const slides = [
    { eyebrow: "Your next visit", title: "Your visit is tomorrow", copy: "A. Rahman is ready to see you at Central Facility.", button: "Prepare for visit", status: "VISIT APPROVED", theme: "peach", action: onOpenVisit },
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

      <section className="sv4-next-visit-card" aria-label="NEXT VISIT: See you tomorrow with A. Rahman" onClick={onOpenVisit} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenVisit()}>
        <div className="sv4-next-visit-main"><div className="sv4-card-overline"><span>Your next visit</span><VisitorStatus>APPROVED</VisitorStatus></div><h2>See you tomorrow</h2><div className="sv4-person-row"><VisitorAvatar initials="AR" /><div><strong>A. Rahman</strong><span>Family visit · Central Facility</span></div></div></div>
        <div className="sv4-next-visit-time"><span>Tomorrow</span><strong>10:00–10:20</strong><small>Waiting room opens at 09:50</small></div><span className="sv4-round-arrow">→</span>
      </section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">People in your circle</p><h2>Your connections</h2></div><button className="sv4-text-link" onClick={() => onNavigate("Connections")}>Manage connections →</button></div><div className="sv4-connection-scroll"><ConnectionCard initials="AR" name="A. Rahman" relation="Family" color="sage" onClick={onOpenVisit} /><button className="sv4-add-card" onClick={() => onAction("Start a new connection request from the Connections page.", "info")}><span>＋</span><strong>Add a connection</strong><small>Who would you like to see?</small></button></div></section>

      <section className="sv4-section"><div className="sv4-section-heading"><div><p className="sv4-kicker">A little help along the way</p><h2>For you</h2></div></div><div className="sv4-recommend-grid"><Recommendation icon="⌁" title="Device ready" copy="Take a quick check before you join." action="Check device" onClick={() => onAction("Device check is ready when you are.", "info")} tone="blue" /><Recommendation icon="◷" title="Visit tomorrow" copy="Everything is in place for your visit." action="View details" onClick={onOpenVisit} tone="orange" /><Recommendation icon="◇" title="2 Visit Credits" copy="You have enough for your next two visits." action="View credits" onClick={() => onNavigate("Credits")} tone="sage" /></div></section>

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
