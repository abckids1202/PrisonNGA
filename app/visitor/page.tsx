"use client";

import { useState } from "react";

type Tab = "Home" | "Visits" | "Connections" | "Credits" | "Account";

function VisitorButton({ children, primary = false, onClick }: { children: React.ReactNode; primary?: boolean; onClick?: () => void }) {
  return <button className={`sv3-visitor-button ${primary ? "primary" : ""}`} onClick={onClick}>{children}</button>;
}

export default function VisitorPage() {
  const [tab, setTab] = useState<Tab>("Home");
  const [notice, setNotice] = useState("");

  function action(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3600);
  }

  return <div className="sv3-visitor-app"><header className="sv3-visitor-header"><button className="sv3-visitor-brand" onClick={() => setTab("Home")}><span>+</span><strong>SecureVisit</strong><small>VISITOR</small></button><div className="sv3-visitor-header-actions"><span className="sv3-visitor-secure">▣ Secure session</span><button aria-label="Open account" onClick={() => setTab("Account")}>SA</button></div></header><main className="sv3-visitor-main">{tab === "Home" ? <VisitorHome onNavigate={setTab} onAction={action} /> : tab === "Visits" ? <VisitorVisits onAction={action} /> : tab === "Connections" ? <VisitorConnections onAction={action} /> : tab === "Credits" ? <VisitorCredits onAction={action} /> : <VisitorAccount onAction={action} />}</main><nav className="sv3-visitor-nav" aria-label="Visitor navigation">{(["Home", "Visits", "Connections", "Credits", "Account"] as Tab[]).map((item, index) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}><span>{["⌂", "◷", "↔", "¤", "○"][index]}</span><small>{item}</small>{item === "Visits" ? <i>1</i> : null}</button>)}</nav>{notice ? <div className="sv3-visitor-toast">✓ {notice}</div> : null}</div>;
}

function VisitorHome({ onNavigate, onAction }: { onNavigate: (tab: Tab) => void; onAction: (message: string) => void }) {
  return <><div className="sv3-visitor-greeting"><span className="sv3-visitor-kicker">WEDNESDAY · 13 AUGUST 2026</span><h1>Hello, Sarah</h1><p>Your next visit and the few things needed before you arrive.</p></div><section className="sv3-next-visit"><div className="sv3-next-visit-top"><span className="sv3-visitor-kicker">NEXT VISIT</span><span className="sv3-visitor-approved">APPROVED</span></div><div className="sv3-visit-person"><div className="sv3-visitor-avatar">AR</div><div><h2>A. Rahman</h2><p>Family visit · 20 minutes</p></div><span>›</span></div><div className="sv3-visit-details"><div><span>When</span><strong>Tomorrow · 10:00–10:20</strong></div><div><span>Waiting room opens</span><strong>09:50 WIB</strong></div><div><span>Location</span><strong>Secure video visit</strong></div></div><VisitorButton primary onClick={() => onNavigate("Visits")}>View visit details →</VisitorButton></section><section className="sv3-visitor-actions"><div className="sv3-visitor-section-head"><span className="sv3-visitor-kicker">YOUR ACTIONS</span><button onClick={() => onAction("All actions are up to date.")}>See all</button></div><button onClick={() => onAction("Document upload flow opened.")}><span className="visitor-action-icon orange">↑</span><span><strong>Upload requested document</strong><small>One document needs review</small></span><b>›</b></button><button onClick={() => onAction("Device check started. Camera and microphone permissions are ready.")}><span className="visitor-action-icon blue">⌁</span><span><strong>Complete device check</strong><small>Recommended before your visit</small></span><b>›</b></button></section><section className="sv3-visitor-connections"><div className="sv3-visitor-section-head"><span className="sv3-visitor-kicker">CONNECTIONS</span><button onClick={() => onNavigate("Connections")}>View all</button></div><div className="sv3-connection-card"><div className="sv3-visitor-avatar small">AR</div><div><strong>A. Rahman</strong><small>Sister · Approved</small></div><span className="sv3-connection-check">✓</span></div></section></>;
}

function VisitorVisits({ onAction }: { onAction: (message: string) => void }) {
  const [tab, setTab] = useState("Upcoming");
  return <><div className="sv3-visitor-title"><span className="sv3-visitor-kicker">YOUR VISITS</span><h1>Visits</h1><p>Requests, approved visits, and your visit history.</p></div><div className="sv3-visitor-segmented">{["Upcoming", "Requests", "History"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Upcoming" ? <div className="sv3-visitor-visit-list"><article><div className="sv3-visit-date"><strong>14</strong><span>AUG<br />FRI</span></div><div><StatusLine label="APPROVED" /><h2>A. Rahman</h2><p>Tomorrow · 10:00–10:20</p><small>Family visit · Waiting room opens 09:50</small></div><button onClick={() => onAction("Visit details opened.")}>›</button></article><article className="muted"><div className="sv3-visit-date"><strong>21</strong><span>AUG<br />FRI</span></div><div><StatusLine label="UNDER REVIEW" tone="orange" /><h2>R. Santoso</h2><p>21 Aug · 14:00–14:20</p><small>Family visit · Awaiting facility approval</small></div><button onClick={() => onAction("Request details opened.")}>›</button></article></div> : <div className="sv3-visitor-empty"><span>◷</span><h2>{tab === "Requests" ? "No other requests" : "No visit history yet"}</h2><p>{tab === "Requests" ? "New requests and their approval status will appear here." : "Completed visits will remain available in your history."}</p><VisitorButton onClick={() => onAction("New visit request flow opened.")}>Request a visit</VisitorButton></div>}</>;
}

function StatusLine({ label, tone = "green" }: { label: string; tone?: string }) {
  return <span className={`sv3-visitor-status ${tone}`}><i />{label}</span>;
}

function VisitorConnections({ onAction }: { onAction: (message: string) => void }) {
  return <><div className="sv3-visitor-title"><span className="sv3-visitor-kicker">APPROVED CONTACTS</span><h1>Connections</h1><p>People you are approved to visit. There is no public prisoner directory.</p></div><div className="sv3-visitor-connection-list"><article><div className="sv3-visitor-avatar">AR</div><div><h2>A. Rahman</h2><p>Sister · Approved 02 Aug 2026</p><small>Central Correctional Facility</small></div><StatusLine label="APPROVED" /><button onClick={() => onAction("A. Rahman connection details opened.")}>›</button></article></div><VisitorButton primary onClick={() => onAction("Connection request form opened. Facility, prisoner reference, relationship, and supporting document are required.")}>+ Request connection</VisitorButton></>;
}

function VisitorCredits({ onAction }: { onAction: (message: string) => void }) {
  return <><div className="sv3-visitor-title"><span className="sv3-visitor-kicker">VISIT CREDITS</span><h1>Credits</h1><p>Simple visit balance for your approved and requested visits.</p></div><section className="sv3-credit-balance"><span>AVAILABLE</span><strong>2</strong><small>Visit Credits</small><div><span>1 reserved</span><VisitorButton primary onClick={() => onAction("Purchase credits flow opened.")}>Purchase credits</VisitorButton></div></section><section className="sv3-credit-activity"><div className="sv3-visitor-section-head"><span className="sv3-visitor-kicker">RECENT ACTIVITY</span><button onClick={() => onAction("Credit ledger is protected and append-only.")}>About credits</button></div>{[["+3", "Purchased", "08 Aug 2026", "positive"], ["−1", "Reserved · A. Rahman", "08 Aug 2026", "negative"], ["+1", "Released · facility cancellation", "02 Aug 2026", "positive"]].map((row) => <div key={row[1]}><strong className={row[3]}>{row[0]}</strong><span><b>{row[1]}</b><small>{row[2]}</small></span><b>›</b></div>)}</section></>;
}

function VisitorAccount({ onAction }: { onAction: (message: string) => void }) {
  return <><div className="sv3-visitor-title"><span className="sv3-visitor-kicker">ACCOUNT</span><h1>Sarah Amelia</h1><p>Manage your identity, notifications, and secure session.</p></div><div className="sv3-account-card"><div className="sv3-account-profile"><div className="sv3-visitor-avatar large">SA</div><div><h2>Sarah Amelia</h2><p>sarah.amelia@example.test</p><StatusLine label="IDENTITY VERIFIED" /></div></div>{["Personal information", "Identity documents", "Notifications", "Help & privacy"].map((item) => <button key={item} onClick={() => onAction(`${item} opened.`)}><span>{item}</span><b>›</b></button>)}<button className="signout" onClick={() => onAction("Secure sign-out requested.")}>Sign out securely</button></div><div className="sv3-visitor-trust">▣ Your visitor information is scoped to your approved facility relationships.</div></>;
}
