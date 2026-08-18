"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type VisitState =
  | "under_review"
  | "approved"
  | "approved_device_ready"
  | "waiting_room_open"
  | "waiting"
  | "session_ready"
  | "in_progress"
  | "completed"
  | "reschedule_proposed"
  | "cancelled_by_facility"
  | "technical_failure";

type NoticeTone = "success" | "info" | "warning";
type InfoPanel = "connection" | "facility" | "credits" | "guidelines" | "help" | null;

const visit = {
  id: "SV-260814-018",
  connection: { displayName: "A. Rahman", relationshipLabel: "Sister", initials: "AR" },
  visitType: { name: "Family Visit", durationMinutes: 20 },
  schedule: { date: "Thursday, 14 August 2026", start: "10:00", end: "10:20", timezone: "WIB", waitingRoom: "09:50" },
  facility: { displayName: "Central Correctional Facility", city: "Jakarta" },
  credit: { amount: 1 },
};

const demoStates: { value: VisitState; label: string }[] = [
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Approved · device incomplete" },
  { value: "approved_device_ready", label: "Approved · device ready" },
  { value: "waiting_room_open", label: "Waiting room open" },
  { value: "waiting", label: "Checked in" },
  { value: "session_ready", label: "Session ready" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "reschedule_proposed", label: "New time suggested" },
  { value: "cancelled_by_facility", label: "Cancelled by facility" },
  { value: "technical_failure", label: "Technical issue" },
];

function stateHasDeviceReady(state: VisitState) {
  return ["approved_device_ready", "waiting_room_open", "waiting", "session_ready", "in_progress", "completed"].includes(state);
}

function getPresentation(state: VisitState) {
  const presentations: Record<VisitState, { eyebrow: string; title: string; copy: string; action: string; tone: "orange" | "blue" | "green" | "muted"; countdown: boolean }> = {
    under_review: { eyebrow: "VISIT REQUEST", title: "Your visit is being reviewed", copy: "We’ll let you know as soon as your visit with A. Rahman is approved.", action: "View My Visits", tone: "blue", countdown: false },
    approved: { eyebrow: "YOUR UPCOMING VISIT", title: "Your visit is tomorrow", copy: "You’re approved to see A. Rahman at Central Correctional Facility.", action: "Check my device", tone: "orange", countdown: true },
    approved_device_ready: { eyebrow: "YOUR UPCOMING VISIT", title: "You’re ready for your visit", copy: "Everything is set. Your waiting room opens 10 minutes before the visit.", action: "View waiting room", tone: "green", countdown: true },
    waiting_room_open: { eyebrow: "YOUR WAITING ROOM IS OPEN", title: "You can join when you’re ready", copy: "Your visit begins at 10:00 WIB. Take a breath, then enter the waiting room.", action: "Enter Waiting Room", tone: "orange", countdown: false },
    waiting: { eyebrow: "YOU’RE CHECKED IN", title: "You’re in the waiting room", copy: "Stay close. We’ll let you know when your visit is ready.", action: "Return to Waiting Room", tone: "green", countdown: false },
    session_ready: { eyebrow: "YOUR VISIT IS READY", title: "A. Rahman is ready to see you", copy: "Your secure video visit can begin now.", action: "Join Visit", tone: "orange", countdown: false },
    in_progress: { eyebrow: "VISIT IN PROGRESS", title: "You’re visiting A. Rahman", copy: "Your secure video visit is happening now.", action: "Return to Visit", tone: "orange", countdown: false },
    completed: { eyebrow: "VISIT COMPLETE", title: "That visit is complete", copy: "Thank you for taking the time to connect with A. Rahman.", action: "View Visit Summary", tone: "green", countdown: false },
    reschedule_proposed: { eyebrow: "A NEW TIME WAS SUGGESTED", title: "A new visit time is ready to review", copy: "The facility suggested Friday · 13:30 for your visit with A. Rahman.", action: "Review New Time", tone: "blue", countdown: false },
    cancelled_by_facility: { eyebrow: "VISIT CANCELLED BY THE FACILITY", title: "This visit can no longer take place", copy: "Your reserved Visit Credit has been returned automatically.", action: "Choose Another Time", tone: "blue", countdown: false },
    technical_failure: { eyebrow: "TECHNICAL ISSUE", title: "The visit ended because of a technical issue", copy: "The session could not continue. We’re sorry this interrupted your time together.", action: "Get Help", tone: "blue", countdown: false },
  };
  return presentations[state];
}

function formatCountdown(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(" : ");
}

function VisitorAvatar({ initials, onClick }: { initials: string; onClick?: () => void }) {
  const content = <span className="sv4-avatar sv4-avatar-sage">{initials}</span>;
  return onClick ? <button className="sv5-avatar-button" aria-label="Open connection details" onClick={onClick}>{content}</button> : content;
}

function VisitorStatus({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "blue" | "orange" }) {
  return <span className={"sv4-status sv4-status-" + tone}><i />{children}</span>;
}

export default function VisitDetailsPage() {
  const [state, setState] = useState<VisitState>(() => {
    if (typeof window === "undefined") return "approved";
    const requestedState = new URLSearchParams(window.location.search).get("state") as VisitState | null;
    if (requestedState && demoStates.some((item) => item.value === requestedState)) return requestedState;
    return window.localStorage.getItem("securevisit:device-check:" + visit.id) ? "approved_device_ready" : "approved";
  });
  const [seconds, setSeconds] = useState(18 * 3600 + 42 * 60 + 15);
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [infoPanel, setInfoPanel] = useState<InfoPanel>(null);
  const [expandedJourney, setExpandedJourney] = useState("prepare");
  const [demoMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1");
  const [showSticky, setShowSticky] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!["approved", "approved_device_ready"].includes(state)) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    const target = primaryActionRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setShowSticky(!entry.isIntersecting), { threshold: 0.1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [state]);

  function showNotice(message: string, tone: NoticeTone = "info") {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 3600);
  }

  function goBack() {
    window.location.href = "/visitor?section=Visits";
  }

  function runPrimaryAction() {
    if (state === "approved") {
      window.location.href = "/visitor/visits/" + visit.id + "/device-check";
      return;
    }
    if (state === "waiting_room_open") {
      setState("waiting");
      showNotice("You’re checked in. We’ll let you know when the visit is ready.", "success");
      return;
    }
    if (state === "waiting") {
      showNotice("Your waiting room is open in this demo.", "info");
      return;
    }
    if (state === "approved_device_ready") {
      showNotice("Your waiting room opens at 09:50 WIB.", "info");
      return;
    }
    if (state === "session_ready" || state === "in_progress") {
      window.location.href = "/visitor/visits/" + visit.id + "/live";
      return;
    }
    if (state === "cancelled_by_facility") {
      showNotice("Choose another time from My Visits when scheduling is available.", "info");
      return;
    }
    showNotice(getPresentation(state).action + " is ready for the next step.", "success");
  }

  const presentation = getPresentation(state);
  const deviceReady = stateHasDeviceReady(state);
  const completedPreparation = state === "under_review" ? 1 : deviceReady ? 5 : 4;
  const progress = Math.round((completedPreparation / 5) * 100);
  const journey = [
    { key: "request", title: "Request sent", copy: "13 Aug · 08:42", status: state === "under_review" ? "current" : "done" },
    { key: "approved", title: "Visit approved", copy: state === "under_review" ? "Waiting for review" : "13 Aug · 09:15", status: state === "under_review" ? "future" : "done" },
    { key: "credit", title: "Visit Credit reserved", copy: state === "cancelled_by_facility" ? "Credit returned automatically" : "1 Visit Credit", status: state === "cancelled_by_facility" ? "done" : state === "under_review" ? "future" : "done" },
    { key: "prepare", title: "Get ready for your visit", copy: deviceReady ? "Device check complete" : "Device check still recommended", status: deviceReady ? "done" : state === "under_review" ? "future" : "current" },
    { key: "waiting-room", title: "Enter waiting room", copy: state === "waiting_room_open" || state === "waiting" ? "Open now" : "Tomorrow · 09:50", status: ["waiting_room_open", "waiting", "session_ready", "in_progress", "completed"].includes(state) ? "done" : "future" },
    { key: "visit", title: "Visit begins", copy: state === "completed" ? "Completed · 19 minutes" : "Tomorrow · 10:00", status: state === "completed" ? "done" : state === "in_progress" ? "current" : "future" },
  ];

  return (
    <div className="sv3-visitor-app sv4-visitor-app sv5-details-app">
      <VisitorDetailsHeader />
      <main className="sv4-main sv5-details-main">
        <div className="sv5-details-page">
          <button className="sv5-back-link" onClick={goBack}>← <span>My Visits</span></button>
          <section className={"sv5-visit-hero sv5-visit-hero-" + presentation.tone}>
            <div className="sv5-hero-copy">
              <p className="sv4-kicker">{presentation.eyebrow}</p>
              <div className="sv5-hero-person"><VisitorAvatar initials={visit.connection.initials} onClick={() => setInfoPanel("connection")} /><div><h1>{presentation.title}</h1><p>{presentation.copy}</p></div></div>
              <div className="sv5-hero-meta"><VisitorStatus tone={presentation.tone === "orange" ? "orange" : presentation.tone === "blue" ? "blue" : "green"}>{state === "approved" || state === "approved_device_ready" ? "Visit approved" : presentation.eyebrow.toLowerCase()}</VisitorStatus><span>{visit.connection.displayName} · {visit.visitType.name} · {visit.visitType.durationMinutes} minutes</span></div>
              <button ref={primaryActionRef} className="sv4-button sv4-button-primary sv5-primary-action" onClick={runPrimaryAction}>{presentation.action} <span>→</span></button>
            </div>
            <div className="sv5-hero-art" aria-hidden="true"><div className="sv5-art-sun" /><div className="sv5-art-arc" /><div className="sv5-art-portrait"><span>AR</span><i /></div><div className="sv5-art-card"><span>SECURE VISIT</span><strong>{visit.schedule.start}</strong><small>{visit.schedule.timezone}</small></div></div>
            {presentation.countdown && <div className="sv5-countdown"><span>Starts in</span><strong>{formatCountdown(seconds)}</strong><small>Tomorrow · {visit.schedule.start} {visit.schedule.timezone}</small></div>}
          </section>

          <section className="sv5-prep-layout">
            <article className="sv5-panel sv5-preparation-panel">
              <div className="sv5-panel-heading"><div><p className="sv4-kicker">Your preparation</p><h2>{state === "under_review" ? "We’re checking your visit." : deviceReady ? "You’re ready." : "You’re almost ready."}</h2></div><strong>{completedPreparation} of 5</strong></div>
              <div className="sv5-progress-track" role="progressbar" aria-valuenow={completedPreparation} aria-valuemin={0} aria-valuemax={5} aria-label={"Visit preparation: " + completedPreparation + " of 5 steps complete"}><i style={{ width: progress + "%" }} /></div>
              <p className="sv5-progress-copy">{completedPreparation} of 5 steps complete <span>{progress}%</span></p>
              <div className="sv5-prep-list">
                <PreparationItem title="Account verified" state="Ready" done={completedPreparation > 0} />
                <PreparationItem title="Visit approved" state={state === "under_review" ? "In review" : "Ready"} done={state !== "under_review"} />
                <PreparationItem title="Visit Credit reserved" state={state === "cancelled_by_facility" ? "Returned" : state === "under_review" ? "Waiting" : "Ready"} done={state !== "under_review" && state !== "cancelled_by_facility"} />
                <PreparationItem title="Visit rules accepted" state={state === "under_review" ? "After approval" : "Ready"} done={state !== "under_review"} />
                <PreparationItem title="Device check" state={deviceReady ? "Ready" : "Needs attention"} done={deviceReady} current={!deviceReady && state !== "under_review"} />
              </div>
              {!deviceReady && state !== "under_review" && <div className="sv5-prep-callout"><span>!</span><p><strong>Check your device before tomorrow.</strong><br />Make sure your camera, microphone, and connection work.</p></div>}
              {!deviceReady && state !== "under_review" && <button className="sv4-button sv4-button-primary" onClick={() => { window.location.href = "/visitor/visits/" + visit.id + "/device-check"; }}>Check my device <span>→</span></button>}
            </article>
            <article className={"sv5-panel sv5-waiting-panel sv5-waiting-" + (state === "waiting_room_open" || state === "waiting" ? "open" : "closed")}>
              <div className="sv5-waiting-illustration"><span>◷</span><i /></div><p className="sv4-kicker">Waiting room</p><h2>{state === "waiting_room_open" ? "Your waiting room is open" : state === "waiting" ? "You’re checked in" : "Not open yet"}</h2><p>{state === "waiting_room_open" ? "Your visit begins at 10:00 WIB." : state === "waiting" ? "Stay close. We’ll let you know when your visit is ready." : "You can enter 10 minutes before your scheduled visit."}</p>
              {state !== "waiting_room_open" && state !== "waiting" && <div className="sv5-waiting-time"><span>Opens tomorrow at</span><strong>{visit.schedule.waitingRoom} WIB</strong></div>}
              <button className={"sv4-button " + (state === "waiting_room_open" ? "sv4-button-primary" : "sv5-button-disabled")} disabled={state !== "waiting_room_open"} onClick={runPrimaryAction}>{state === "waiting_room_open" ? "Enter Waiting Room →" : state === "waiting" ? "Waiting room open" : "Waiting room opens at 09:50"}</button>
            </article>
          </section>

          <section className="sv5-info-layout">
            <article className="sv5-panel sv5-info-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Visit information</p><h2>The details you need</h2></div><span className="sv5-info-icon">⌁</span></div><div className="sv5-detail-grid"><Detail label="Date" value={visit.schedule.date} /><Detail label="Time" value={visit.schedule.start + "–" + visit.schedule.end + " " + visit.schedule.timezone} /><Detail label="Type" value={visit.visitType.name} /><Detail label="Duration" value={visit.visitType.durationMinutes + " minutes"} /><Detail label="Facility" value={visit.facility.displayName} /><Detail label="Location" value={visit.facility.city} /></div><button className="sv5-inline-link" onClick={() => setInfoPanel("facility")}>View facility information →</button></article>
            <article className="sv5-panel sv5-credit-panel"><div className="sv5-credit-symbol">◇</div><p className="sv4-kicker">Visit Credit</p><h2>{state === "cancelled_by_facility" ? "Credit returned" : state === "completed" ? "1 Visit Credit used" : "1 Visit Credit reserved"}</h2><p>{state === "cancelled_by_facility" ? "Your reserved credit is available again automatically." : state === "completed" ? "This credit was used for your completed visit." : "This credit will be used when your visit is successfully completed."}</p><button className="sv5-inline-link" onClick={() => setInfoPanel("credits")}>View my credits →</button></article>
          </section>

          <section className="sv5-panel sv5-journey-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Your visit journey</p><h2>Here’s where you are</h2></div><span className="sv5-journey-count">{journey.filter((item) => item.status === "done").length} of {journey.length} steps</span></div><div className="sv5-journey-list">{journey.map((item) => <button className={"sv5-journey-item sv5-journey-" + item.status} key={item.key} onClick={() => setExpandedJourney(expandedJourney === item.key ? null : item.key)}><span className="sv5-journey-marker">{item.status === "done" ? "✓" : item.status === "current" ? "●" : "○"}</span><span><strong>{item.title}</strong><small>{item.copy}</small>{expandedJourney === item.key && <em>{item.status === "current" ? "This is your next step." : item.status === "done" ? "Complete and accounted for." : "This will unlock as your visit gets closer."}</em>}</span><b>{expandedJourney === item.key ? "−" : "+"}</b></button>)}</div></section>

          <section className="sv5-guidance-layout"><article className="sv5-panel sv5-guidelines-panel"><div className="sv5-panel-heading"><div><p className="sv4-kicker">Before your visit</p><h2>A few things to remember</h2></div></div><div className="sv5-guideline-list"><Guideline number="01" text="Join from a quiet, well-lit place." /><Guideline number="02" text="Keep your camera and microphone enabled." /><Guideline number="03" text="Only approved participants may be present." /><Guideline number="04" text="Join the waiting room 10 minutes early." /></div><button className="sv5-inline-link" onClick={() => setInfoPanel("guidelines")}>View all visit guidelines →</button></article><article className="sv5-help-panel"><span className="sv5-help-spark">✦</span><p className="sv4-kicker">Need a hand?</p><h2>We’re here for your visit.</h2><p>Having trouble preparing or have a question? Our visitor support team can help.</p><button className="sv4-button" onClick={() => setInfoPanel("help")}>Get Help <span>→</span></button></article></section>

          {demoMode && <aside className="sv5-demo-controls"><div><p className="sv4-kicker">Demo controls</p><strong>Preview visit states</strong></div><select aria-label="Preview visit state" value={state} onChange={(event) => { setState(event.target.value as VisitState); showNotice("Visit state updated for this demo.", "success"); }}>{demoStates.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></aside>}
        </div>
      </main>
      {showSticky && <div className="sv5-sticky-action"><button className="sv4-button sv4-button-primary" onClick={runPrimaryAction}>{presentation.action} <span>→</span></button></div>}
      {infoPanel && <VisitInfoDialog panel={infoPanel} onClose={() => setInfoPanel(null)} onAction={showNotice} />}
      {notice && <div className={"sv4-toast sv4-toast-" + notice.tone} role="status"><span>{notice.tone === "success" ? "✓" : notice.tone === "warning" ? "!" : "i"}</span>{notice.message}</div>}
    </div>
  );
}

function VisitorDetailsHeader() {
  return <header className="sv4-header"><div className="sv4-header-inner"><button className="sv4-brand" onClick={() => { window.location.href = "/visitor"; }}><span className="sv4-brand-mark">+</span><span><strong>SecureVisit</strong><small>Visitor</small></span></button><nav className="sv4-desktop-nav" aria-label="Visitor navigation"><button onClick={() => { window.location.href = "/visitor"; }}>Home</button><button className="active">Visits <b>1</b></button><button onClick={() => { window.location.href = "/visitor?section=Connections"; }}>Connections</button><button onClick={() => { window.location.href = "/visitor?section=Credits"; }}>Credits</button></nav><div className="sv4-header-actions"><span className="sv4-secure-note"><i />Secure session</span><button className="sv4-icon-button" aria-label="Notifications" onClick={() => undefined}>♢</button><button className="sv4-profile-chip" onClick={() => { window.location.href = "/visitor?section=Account"; }}><span className="sv4-avatar sv4-avatar-coral">SA</span><span>Sarah</span><em>⌄</em></button></div></div></header>;
}

function PreparationItem({ title, state, done, current = false }: { title: string; state: string; done: boolean; current?: boolean }) {
  return <div className={"sv5-prep-item " + (done ? "done" : current ? "current" : "future")}><span>{done ? "✓" : current ? "!" : "○"}</span><strong>{title}</strong><small>{state}</small></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="sv5-detail-item"><small>{label}</small><strong>{value}</strong></div>;
}

function Guideline({ number, text }: { number: string; text: string }) {
  return <div className="sv5-guideline"><span>{number}</span><p>{text}</p><b>✓</b></div>;
}

function VisitInfoDialog({ panel, onClose, onAction }: { panel: Exclude<InfoPanel, null>; onClose: () => void; onAction: (message: string, tone?: NoticeTone) => void }) {
  const content: Record<Exclude<InfoPanel, null>, { eyebrow: string; title: string; body: ReactNode }> = {
    connection: { eyebrow: "Your connection", title: "A. Rahman", body: <><p>Your approved connection is the person you’re visiting through SecureVisit.</p><div className="sv5-dialog-fact"><span>Relationship</span><strong>Sister</strong></div><div className="sv5-dialog-fact"><span>Visit type</span><strong>Family Visit</strong></div></> },
    facility: { eyebrow: "Visitor information", title: "Central Correctional Facility", body: <><p>Central Correctional Facility hosts secure video visits for approved connections.</p><div className="sv5-dialog-fact"><span>Location</span><strong>Jakarta</strong></div><div className="sv5-dialog-fact"><span>Time zone</span><strong>WIB · UTC+7</strong></div></> },
    credits: { eyebrow: "Visit Credits", title: "How Visit Credits work", body: <><p>One Visit Credit supports one secure video visit. Your credit is reserved for this visit and is used when the visit is successfully completed.</p><div className="sv5-dialog-fact"><span>Reserved for this visit</span><strong>1 Visit Credit</strong></div></> },
    guidelines: { eyebrow: "Before your visit", title: "Visit guidelines", body: <><p>These simple guidelines help keep your visit comfortable and secure.</p><div className="sv5-dialog-rule">Find a quiet, well-lit place.</div><div className="sv5-dialog-rule">Keep your camera and microphone enabled.</div><div className="sv5-dialog-rule">Only approved participants may be present.</div><div className="sv5-dialog-rule">Join the waiting room 10 minutes early.</div></> },
    help: { eyebrow: "Visitor support", title: "Need help with your visit?", body: <><p>Our visitor support team can help with preparing for your visit, understanding the next step, or answering a question.</p><div className="sv5-dialog-fact"><span>Typical response</span><strong>Within one business day</strong></div></> },
  };
  const current = content[panel];
  return <div className="sv5-dialog-backdrop" onClick={onClose}><aside className="sv5-info-dialog" onClick={(event) => event.stopPropagation()}><button className="sv5-dialog-close" aria-label="Close" onClick={onClose}>×</button><p className="sv4-kicker">{current.eyebrow}</p><h2>{current.title}</h2><div className="sv5-dialog-body">{current.body}</div><div className="sv5-dialog-actions">{panel === "help" && <button className="sv4-button sv4-button-primary" onClick={() => { onClose(); onAction("Support request started. We’ll be in touch.", "success"); }}>Contact support</button>}<button className="sv4-button" onClick={onClose}>Close</button></div></aside></div>;
}
