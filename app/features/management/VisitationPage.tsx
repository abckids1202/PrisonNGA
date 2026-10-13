"use client";

import { useState } from "react";
import AppointmentTypesPanel from "../../components/AppointmentTypesPanel";
import FacilityClosures from "../../components/FacilityClosures";
import VisitPolicyEditor from "../../components/VisitPolicyEditor";
import { Button, PageHeader, Status } from "../../components/ControlPrimitives";

export default function VisitationPage({ timeZone, backendStatus = "unavailable" }: { timeZone?: string | null; backendStatus?: "connected" | "unavailable" }) {
  const [tab, setTab] = useState("Visit Policies");
  const tabs = ["Visit Policies", "Appointment Types", "Availability Rules", "Operating Hours", "Closures"];
  const connected = backendStatus === "connected";
  return <><PageHeader eyebrow="Management · Visitation policy" title="Visitation" description="Control the facility rules used to validate visitor booking requests." /><div className="sv3-policy-layout"><nav className="sv3-policy-nav">{tabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}><span>{item}</span><b>›</b></button>)}</nav><section className="sv3-policy-editor"><div className="sv3-policy-editor-head"><div><span className="sv3-eyebrow">Facility configuration</span><h2>{tab}</h2></div><Status tone={connected ? "green" : "orange"}>{connected ? "BACKEND CONNECTED" : "NOT YET CONNECTED"}</Status></div>{["Visit Policies", "Availability Rules", "Operating Hours"].includes(tab) ? <VisitPolicyEditor timeZone={timeZone} /> : tab === "Closures" ? <FacilityClosures timeZone={timeZone} /> : tab === "Appointment Types" ? <AppointmentTypesPanel /> : <div className="sv3-settings-surface"><strong>Appointment types need a dedicated policy model</strong><p>This section is intentionally unavailable until appointment-type eligibility, duration, credit cost, and approval rules can be persisted with version history.</p><Button onClick={() => setTab("Visit Policies")}>Open live visit policy</Button></div>}</section></div></>;
}


