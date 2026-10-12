"use client";

import { useEffect, useState } from "react";
import { Avatar, Button, CopyableId, DrawerFooter, DrawerSection, EmptyState, Status } from "../../components/ControlPrimitives";
import type { Appointment } from "./model";

export type DrawerPayload =
  | { kind: "appointment"; appointment: Appointment }
  | { kind: "device"; device: string }
  | { kind: "waiting"; visitor: string }
  | { kind: "incident"; id: string }
  | { kind: "activity"; event: string; source: string; relatedId: string };

type DrawerResource = { id: string; display_name: string; status: string; resource_type: string; health_state: string; room_id?: string | null; last_heartbeat_at?: string | null; active_appointment_id?: string | null; version: number };
type DrawerWaitingVisit = { id: string; visitor_name?: string | null; prisoner_name?: string | null; state?: string | null; assigned_room_name?: string | null; assigned_kiosk_name?: string | null; visitor_presence?: string | null; prisoner_presence?: string | null; staff_notes?: string | null; version?: number | null };
type DrawerIncident = { id: string; incident_type: string; severity: string; status: string; title: string; description: string; appointment_id?: string | null; resource_id?: string | null; reporter_name?: string | null; assignee_name?: string | null; resolution?: string | null; version: number };

type ContextDrawerProps = {
  payload: DrawerPayload;
  onClose: () => void;
  onOpenAppointment: (appointment: Appointment) => void;
  onRequestApproval: (appointment: Appointment) => void;
};

export default function ContextDrawer({ payload, onClose, onOpenAppointment, onRequestApproval }: ContextDrawerProps) {
  const [remote, setRemote] = useState<{ kind: "resource"; record: DrawerResource } | { kind: "waiting"; record: DrawerWaitingVisit } | { kind: "incident"; record: DrawerIncident } | null>(null);
  const [loading, setLoading] = useState(payload.kind !== "appointment" && payload.kind !== "activity");
  const [error, setError] = useState("");

  useEffect(() => {
    if (payload.kind === "appointment" || payload.kind === "activity") return;
    let active = true;
    const load = async () => {
      try {
        const endpoint = payload.kind === "device" ? "/api/control/resources" : payload.kind === "waiting" ? "/api/control/waiting-room" : "/api/control/incidents";
        const response = await fetch(endpoint, { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
        const body = await response.json() as { resources?: DrawerResource[]; visits?: DrawerWaitingVisit[]; incidents?: DrawerIncident[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Protected record unavailable.");
        const record = payload.kind === "device"
          ? body.resources?.find((item) => item.display_name === payload.device)
          : payload.kind === "waiting"
            ? body.visits?.find((item) => item.visitor_name === payload.visitor)
            : body.incidents?.find((item) => item.id === payload.id);
        if (active) {
          setRemote(record ? { kind: payload.kind === "device" ? "resource" : payload.kind, record: record as DrawerResource & DrawerWaitingVisit & DrawerIncident } : null);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Protected record unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [payload]);

  const title = payload.kind === "appointment" ? payload.appointment.id : payload.kind === "activity" ? payload.event : payload.kind === "device" ? payload.device : payload.kind === "waiting" ? payload.visitor : payload.id;
  const eyebrow = payload.kind === "appointment" ? "Appointment review" : payload.kind === "activity" ? "Related activity" : payload.kind === "device" ? "Persisted resource" : payload.kind === "waiting" ? "Waiting Room record" : "Persisted incident";

  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer sv3-context-drawer" role="dialog" aria-modal="true" aria-labelledby="context-drawer-title" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">{eyebrow}</span><h2 id="context-drawer-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close context drawer">×</button></div>{payload.kind === "appointment" ? <><div className="sv3-drawer-person"><Avatar initials={payload.appointment.visitorInitials} tone="orange" /><div><strong>{payload.appointment.visitor}</strong><span>{payload.appointment.type} visit with {payload.appointment.prisoner}</span></div><Status tone={payload.appointment.status === "Blocked" ? "red" : payload.appointment.status === "Live" ? "green" : "orange"}>{payload.appointment.status}</Status></div><DrawerSection title="Persisted appointment"><DetailRow label="Requested" value={`${payload.appointment.date} · ${payload.appointment.time}`} mono /><DetailRow label="Resources" value={`${payload.appointment.room} · ${payload.appointment.kiosk}`} /><DetailRow label="Relationship" value={payload.appointment.relationshipStatus || "Unavailable"} positive={payload.appointment.relationshipStatus === "APPROVED"} /><DetailRow label="Visit credit" value={payload.appointment.activeCreditReservation ? "Reserved" : `${payload.appointment.availableCredits ?? 0} available`} /></DrawerSection><DrawerSection title="Audit reference"><CopyableId value={payload.appointment.id} /><small>Decisions are recorded against the facility audit trail.</small></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button onClick={() => onOpenAppointment(payload.appointment)}>Full appointment</Button>{payload.appointment.status !== "Approved" && payload.appointment.status !== "Live" ? <Button variant="primary" onClick={() => onRequestApproval(payload.appointment)}>Review decision</Button> : null}</DrawerFooter></> : payload.kind === "activity" ? <><DrawerSection title="Recorded event"><DetailRow label="Source" value={payload.source} /><CopyableId value={payload.relatedId} /><p>This event is linked to a persisted operational record.</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : loading ? <EmptyState title="Loading protected record" body="Reading the facility-scoped operational record." /> : error ? <EmptyState title="Record unavailable" body={error} /> : !remote ? <EmptyState title="Record not found" body="The requested record is no longer available in this facility scope." /> : remote.kind === "resource" ? <><DrawerSection title="Resource status"><DetailRow label="Name" value={remote.record.display_name} /><DetailRow label="Type" value={remote.record.resource_type} /><DetailRow label="Availability" value={remote.record.status} /><DetailRow label="Health" value={remote.record.health_state} positive={remote.record.health_state === "HEALTHY"} /><DetailRow label="Active appointment" value={remote.record.active_appointment_id || "None"} mono /></DrawerSection><DrawerSection title="Operational metadata"><DetailRow label="Last heartbeat" value={remote.record.last_heartbeat_at || "Not recorded"} mono /><DetailRow label="Version" value={String(remote.record.version)} mono /></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : remote.kind === "waiting" ? <><DrawerSection title="Readiness record"><DetailRow label="Visitor" value={remote.record.visitor_name || "Unavailable"} /><DetailRow label="Prisoner" value={remote.record.prisoner_name || "Unavailable"} /><DetailRow label="State" value={(remote.record.state || "NOT_ARRIVED").replaceAll("_", " ")} /><DetailRow label="Visitor presence" value={remote.record.visitor_presence || "Not recorded"} /><DetailRow label="Prisoner presence" value={remote.record.prisoner_presence || "Not recorded"} /></DrawerSection><DrawerSection title="Assignment and notes"><DetailRow label="Room" value={remote.record.assigned_room_name || "Unassigned"} /><DetailRow label="Kiosk" value={remote.record.assigned_kiosk_name || "Unassigned"} /><p>{remote.record.staff_notes || "No staff notes recorded."}</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : <><DrawerSection title="Incident record"><DetailRow label="Severity" value={remote.record.severity} /><DetailRow label="Status" value={remote.record.status} /><DetailRow label="Type" value={remote.record.incident_type} /><DetailRow label="Reporter" value={remote.record.reporter_name || "Unavailable"} /><DetailRow label="Assignee" value={remote.record.assignee_name || "Unassigned"} /></DrawerSection><DrawerSection title="Description"><p>{remote.record.description}</p><p>{remote.record.resolution || "No resolution recorded."}</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></>}</aside></div>;
}

function DetailRow({ label, value, mono = false, positive = false }: { label: string; value: string; mono?: boolean; positive?: boolean }) {
  return <div className="sv3-detail-row"><span>{label}</span><strong className={`${mono ? "sv3-mono-value" : ""} ${positive ? "sv3-positive" : ""}`}>{positive ? "✓ " : ""}{value}</strong></div>;
}
