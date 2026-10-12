"use client";

export type OperationalResource = { id: string; resource_type: "ROOM" | "DEVICE"; display_name: string; status: string; active_appointment_id?: string | null };
export type OperationalWaitingVisit = { id: string; visitor_name?: string | null; state?: string | null; readiness?: { state?: string | null } };
export type OperationalLiveSession = { id: string; status: string; visitor_name?: string | null; prisoner_name?: string | null; participants?: Array<{ status?: string }> };

export function CapacityPopover({ resources, loading, unavailable = false, onOpen }: { resources: OperationalResource[]; loading: boolean; unavailable?: boolean; onOpen: () => void }) {
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const occupied = rooms.filter((resource) => resource.active_appointment_id || resource.status === "IN_USE").length;
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Facility capacity</span><strong>{loading ? "Loading room status" : unavailable ? "Room status unavailable" : rooms.length ? `${occupied} / ${rooms.length} rooms assigned` : "Room status unavailable"}</strong>{loading ? <p>Reading the protected resource register.</p> : unavailable ? <p>The protected resource register could not be reached. No capacity value is being inferred.</p> : rooms.length ? <div className="sv3-popover-list">{rooms.slice(0, 6).map((room) => <span key={room.id}><b>{room.display_name}</b><em>{room.active_appointment_id ? "In use" : room.status.toLowerCase().replaceAll("_", " ")}</em></span>)}</div> : <p>No facility room records were returned for this staff scope.</p>}<button type="button" onClick={onOpen}>Open Resources →</button></div>;
}

export function WaitingPopover({ visits, loading, unavailable = false, onOpen }: { visits: OperationalWaitingVisit[]; loading: boolean; unavailable?: boolean; onOpen: () => void }) {
  const stateLabel = (visit: OperationalWaitingVisit) => (visit.state || visit.readiness?.state || "NOT_ARRIVED").replaceAll("_", " ");
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Waiting room</span><strong>{loading ? "Loading readiness lanes" : unavailable ? "Waiting Room unavailable" : `${visits.length} linked visits`}</strong>{loading ? <p>Reading persisted presence and readiness.</p> : unavailable ? <p>The protected Waiting Room register could not be reached. No empty queue is being inferred.</p> : visits.length ? <div className="sv3-popover-list">{visits.slice(0, 4).map((visit) => <span key={visit.id}><b>{visit.visitor_name || "Visitor name unavailable"}</b><em>{stateLabel(visit)}</em></span>)}</div> : <p>No approved visits are currently in the Waiting Room window.</p>}<button type="button" onClick={onOpen}>Open Waiting Room →</button></div>;
}

export function SessionPopover({ sessions, loading, unavailable = false, onOpen }: { sessions: OperationalLiveSession[]; loading: boolean; unavailable?: boolean; onOpen: () => void }) {
  const participantCount = (session: OperationalLiveSession) => session.participants?.filter((participant) => participant.status !== "DISCONNECTED").length || 0;
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Session status</span><strong>{loading ? "Loading session status" : unavailable ? "Session status unavailable" : sessions.length ? `${sessions.length} active session${sessions.length === 1 ? "" : "s"}` : "No active sessions"}</strong>{loading ? <p>Reading the protected Live Session register.</p> : unavailable ? <p>The protected Live Session register could not be reached. No zero-session state is being inferred.</p> : sessions.length ? <div className="sv3-popover-list">{sessions.slice(0, 4).map((session) => <span key={session.id}><b>{session.visitor_name || "Visitor name unavailable"} ↔ {session.prisoner_name || "Prisoner name unavailable"}</b><em>{session.status} · {participantCount(session)} connected</em></span>)}</div> : <p>No active LiveKit sessions are currently recorded for this facility.</p>}<button type="button" onClick={onOpen}>Open live sessions →</button></div>;
}
