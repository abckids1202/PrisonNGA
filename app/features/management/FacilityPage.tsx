"use client";

import { useEffect, useState } from "react";
import FacilityClosures from "../../components/FacilityClosures";
import FacilityRestrictions from "../../components/FacilityRestrictions";
import { Button, PageHeader, Status } from "../../components/ControlPrimitives";
import VisitPolicyEditor from "../../components/VisitPolicyEditor";
import { formatDateValue } from "@/lib/date-format";

type NoticeTone = "success" | "warning" | "error" | "info";
type FacilityResource = {
  id: string;
  resource_type: string;
  display_name: string;
  status: string;
  room_id: string | null;
  health_state: string;
  last_heartbeat_at: string | null;
  version: number;
  active_appointment_id: string | null;
  has_active_kiosk_credential: number;
  kiosk_credential_last_used_at: string | null;
};
type FacilityRecord = { id: string; name: string; timezone: string; address: string | null; contactEmail: string | null; contactPhone: string | null; currentState: string; stateReason: string | null; version: number };

type FacilityPageProps = {
  facilityState: string;
  onFacilityStateChange: (state: string, reason?: string) => Promise<void>;
  onOpenResource: (resourceId: string) => void;
  onNotify: (message: string, tone?: NoticeTone) => void;
};

export default function FacilityPage({ facilityState, onFacilityStateChange, onOpenResource, onNotify }: FacilityPageProps) {
  const [tab, setTab] = useState("Profile");
  const [facility, setFacility] = useState<FacilityRecord | null>(null);
  const [resources, setResources] = useState<FacilityResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: "", timezone: "", address: "", contactEmail: "", contactPhone: "", reason: "Facility identity updated after institutional review." });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/facility/state", { cache: "no-store" }),
      fetch("/api/control/resources", { cache: "no-store" }),
    ]).then(async ([facilityResponse, resourceResponse]) => {
      const facilityBody = await facilityResponse.json() as { facility?: FacilityRecord; error?: string };
      const resourceBody = await resourceResponse.json() as { resources?: FacilityResource[]; error?: string };
      if (!facilityResponse.ok || !resourceResponse.ok) throw new Error(facilityBody.error || resourceBody.error || "Unable to load facility records.");
      if (active) {
        setFacility(facilityBody.facility || null);
        if (facilityBody.facility) setProfileDraft((current) => ({ ...current, name: facilityBody.facility!.name, timezone: facilityBody.facility!.timezone, address: facilityBody.facility!.address || "", contactEmail: facilityBody.facility!.contactEmail || "", contactPhone: facilityBody.facility!.contactPhone || "" }));
        setResources(resourceBody.resources || []);
        setLoading(false);
      }
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "Unable to load facility records.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const state = facility?.currentState || facilityState;
  const stateLabel = state.replaceAll("_", " ");
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const devices = resources.filter((resource) => resource.resource_type === "DEVICE");
  const visible = tab === "Rooms" ? rooms : devices;
  const healthTone = (resource: FacilityResource) => resource.health_state === "HEALTHY" && ["AVAILABLE", "ONLINE"].includes(resource.status) ? "green" : resource.health_state === "FAILED" || resource.status === "OFFLINE" ? "red" : "orange";
  const formatHeartbeat = (value: string | null) => value ? formatDateValue(value, { dateStyle: "medium", timeStyle: "short" }, facility?.timezone, "Heartbeat unavailable") : "No heartbeat recorded";
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!facility || profileDraft.name.trim().length < 2 || profileDraft.timezone.trim().length < 3 || profileDraft.reason.trim().length < 8) return;
    setSavingProfile(true);
    try {
      const response = await fetch(`/api/control/facilities/${encodeURIComponent(facility.id)}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-profile-${facility.id}-${facility.version}-${crypto.randomUUID()}` }, body: JSON.stringify({ ...profileDraft, expectedVersion: facility.version }) });
      const body = await response.json() as { facility?: FacilityRecord; error?: string };
      if (!response.ok) throw new Error(body.error === "PERMISSION_DENIED" ? "Only an organization administrator can edit facility identity details." : body.error || "Facility details could not be saved.");
      if (body.facility) { setFacility((current) => current ? { ...current, ...body.facility } : body.facility!); setProfileDraft((current) => ({ ...current, name: body.facility!.name, timezone: body.facility!.timezone, address: body.facility!.address || "", contactEmail: body.facility!.contactEmail || "", contactPhone: body.facility!.contactPhone || "" })); }
      onNotify("Facility identity details were saved and audited.", "success");
    } catch (reason: unknown) { onNotify(reason instanceof Error ? reason.message : "Facility details could not be saved.", "error"); }
    finally { setSavingProfile(false); }
  };

  return <>
    <PageHeader eyebrow="Management · Facility configuration" title="Facility" description="Read the current facility identity, operational state, and resource health from authoritative records." actions={<Status tone={state === "NORMAL_OPERATIONS" ? "green" : "red"}>{stateLabel}</Status>} />
    <div className="sv3-facility-layout">
      <nav className="sv3-facility-nav">
        {["Profile", "Operating Hours", "Rooms", "Devices", "Restrictions", "Closures", "Visit Policies"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}<b>›</b></button>)}
      </nav>
      <section className="sv3-facility-editor">
        <div className="sv3-facility-editor-head"><div><span className="sv3-eyebrow">{facility?.name || "Facility record"}</span><h2>{tab}</h2></div><Status tone={state === "NORMAL_OPERATIONS" ? "green" : "red"}>{stateLabel}</Status></div>
        {error ? <div className="sv3-settings-surface"><strong>Facility records unavailable</strong><p>{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div>
          : tab === "Profile" ? <div className="sv3-facility-profile">{loading ? <div className="sv3-empty"><strong>Loading facility record…</strong></div> : <><div className="sv3-facility-map"><span>{facility?.name?.slice(0, 3).toUpperCase() || "FAC"}</span><small>{facility?.id || "Facility ID unavailable"}</small><i>⌖</i></div><form className="sv3-form-grid" onSubmit={saveProfile}><label>Facility name<input required value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label><label>Timezone<input required value={profileDraft.timezone} onChange={(event) => setProfileDraft({ ...profileDraft, timezone: event.target.value })} /></label><label className="sv3-form-wide">Address<textarea value={profileDraft.address} onChange={(event) => setProfileDraft({ ...profileDraft, address: event.target.value })} /></label><label>Contact email<input type="email" value={profileDraft.contactEmail} onChange={(event) => setProfileDraft({ ...profileDraft, contactEmail: event.target.value })} /></label><label>Contact phone<input type="tel" value={profileDraft.contactPhone} onChange={(event) => setProfileDraft({ ...profileDraft, contactPhone: event.target.value })} /></label><label>Facility reference<input value={facility?.id || ""} readOnly /></label><label>Operational state<input value={stateLabel} readOnly /></label><label className="sv3-form-wide">State reason<textarea value={facility?.stateReason || "No active state reason recorded."} readOnly /></label><label className="sv3-form-wide">Reason for identity update<textarea required minLength={8} maxLength={500} value={profileDraft.reason} onChange={(event) => setProfileDraft({ ...profileDraft, reason: event.target.value })} /></label><div><Button variant="primary" type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save facility details"}</Button></div></form></>}</div>
          : tab === "Operating Hours" || tab === "Visit Policies" ? <VisitPolicyEditor timeZone={facility?.timezone} />
            : ["Rooms", "Devices"].includes(tab) ? <div className="sv3-facility-table">{loading ? <div className="sv3-empty"><strong>Loading resource health…</strong></div> : visible.length ? visible.map((resource) => <button key={resource.id} onClick={() => onOpenResource(resource.id)} aria-label={`Open ${resource.display_name} in Resources`}><strong>{resource.display_name}</strong><span>{tab === "Devices" ? (resource.room_id ? rooms.find((room) => room.id === resource.room_id)?.display_name || "Assigned room unavailable" : "Unassigned") : `${resource.status} · ${resource.active_appointment_id ? `Appointment ${resource.active_appointment_id}` : "No active appointment"}`}</span><span>{tab === "Devices" ? `Heartbeat · ${formatHeartbeat(resource.last_heartbeat_at)}` : `Version ${resource.version}`}</span><Status tone={healthTone(resource)}>{resource.health_state}</Status><b>→</b></button>) : <div className="sv3-empty"><strong>No {tab.toLowerCase()} records</strong><p>This facility has no persisted resources of this type.</p></div>}</div>
                : tab === "Restrictions" ? <FacilityRestrictions key={state} state={state} onChange={async (nextState, reason) => { await onFacilityStateChange(nextState, reason); setFacility((current) => current ? { ...current, currentState: nextState, stateReason: reason, version: current.version + 1 } : current); onNotify(`Facility state change requested: ${nextState.replaceAll("_", " ")}.`, nextState === "NORMAL_OPERATIONS" ? "success" : "warning"); }} />
                : tab === "Closures" ? <FacilityClosures timeZone={facility?.timezone} />
                  : <div className="sv3-settings-surface"><Status tone="orange">NOT CONNECTED</Status><strong>{tab} is not yet backed by a persisted facility configuration workflow.</strong><p>This section is intentionally unavailable until its data model, permissions, history, and operational effects are implemented. Resource health is available in Rooms and Devices.</p><Button onClick={() => setTab("Profile")}>Open an available facility view</Button></div>}
      </section>
    </div>
  </>;
}
