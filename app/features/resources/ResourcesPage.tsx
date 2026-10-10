"use client";

import { useCallback, useEffect, useState } from "react";
import KioskCredentialManager from "../../components/KioskCredentialManager";
import { Button, EmptyState, PageHeader, Status } from "../../components/ControlPrimitives";

type NoticeTone = "success" | "warning" | "error" | "info";
type ResourceReassignment = { appointmentId: string; sourceResourceId: string; targetResourceId: string; expectedSourceVersion: number; expectedTargetVersion: number; expectedWaitingVersion: number; reason: string };
type ResourceRow = { id: string; resource_type: "ROOM" | "DEVICE"; display_name: string; status: string; room_id?: string | null; health_state: string; last_heartbeat_at?: string | null; active_appointment_id?: string | null; waiting_version?: number | null; has_active_kiosk_credential?: number; kiosk_credential_last_used_at?: string | null; version: number };

export default function ResourcesPage({ initialResourceId, onNotify, onReassign }: { initialResourceId?: string | null; onNotify: (message: string, tone?: NoticeTone) => void; onReassign: (input: ResourceReassignment) => Promise<void> }) {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [reassignReason, setReassignReason] = useState("Resource failure requires a controlled reassignment.");
  const [reassigning, setReassigning] = useState(false);
  const [maintenanceConfirm, setMaintenanceConfirm] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/control/resources", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Resource records could not be loaded from the staff API.");
    const body = await response.json() as { resources?: ResourceRow[] };
    setResources(body.resources || []);
    setSelectedId((current) => {
      const available = body.resources || [];
      if (initialResourceId && available.some((resource) => resource.id === initialResourceId)) return initialResourceId;
      return current && available.some((resource) => resource.id === current) ? current : available[0]?.id || null;
    });
    setLoading(false);
  }, [initialResourceId]);
  useEffect(() => { const timer = window.setTimeout(() => { refresh().catch(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const selected = resources.find((resource) => resource.id === selectedId) || resources[0];
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const usableRooms = rooms.filter((resource) => resource.status !== "MAINTENANCE" && resource.status !== "OFFLINE");
  const devices = resources.filter((resource) => resource.resource_type === "DEVICE");
  const tone = (resource: ResourceRow) => resource.health_state === "FAILED" || resource.status === "OFFLINE" ? "red" : resource.status === "MAINTENANCE" || resource.status === "RESERVED" ? "orange" : resource.status === "IN_USE" ? "green" : "blue";
  const reassignmentTargets = selected?.active_appointment_id ? resources.filter((resource) => resource.id !== selected.id && resource.resource_type === selected.resource_type && resource.health_state === "HEALTHY" && resource.status === (selected.resource_type === "ROOM" ? "AVAILABLE" : "ONLINE") && !resource.active_appointment_id) : [];
  const effectiveReassignTargetId = reassignmentTargets.some((resource) => resource.id === reassignTargetId) ? reassignTargetId : reassignmentTargets[0]?.id || "";

  async function submitReassignment() {
    if (!selected?.active_appointment_id || !effectiveReassignTargetId) return;
    const target = resources.find((resource) => resource.id === effectiveReassignTargetId);
    if (!target) return;
    if (reassignReason.trim().length < 8) {
      onNotify("Enter at least eight characters explaining the reassignment.", "warning");
      return;
    }
    setReassigning(true);
    try {
      await onReassign({ appointmentId: selected.active_appointment_id, sourceResourceId: selected.id, targetResourceId: target.id, expectedSourceVersion: selected.version, expectedTargetVersion: target.version, expectedWaitingVersion: selected.waiting_version ?? 0, reason: reassignReason.trim() });
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESOURCE_REASSIGNMENT_FAILED";
      const message = code === "STALE_RESOURCE" || code === "STALE_TARGET_RESOURCE" || code === "STALE_WAITING_ROOM" ? "The assignment changed while you were reviewing it. Refresh the resource board and try again." : code === "TARGET_RESOURCE_UNUSABLE" ? "That resource is no longer healthy or available." : code === "RESOURCE_REASSIGNMENT_CONFLICT" ? "The target resource became reserved. Choose another available resource." : code;
      onNotify(message, "error");
    } finally { setReassigning(false); }
  }

  async function sendHeartbeat(resource: ResourceRow) {
    try {
      const response = await fetch("/api/control/resources", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "include", body: JSON.stringify({ resourceId: resource.id, command: "heartbeat", expectedVersion: resource.version, reason: "Staff requested a resource health check." }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Heartbeat update was rejected.");
      await refresh();
      onNotify(`${resource.display_name} heartbeat recorded.`, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Heartbeat failed.", "error"); }
  }

  async function changeMaintenance(resource: ResourceRow) {
    const nextStatus = resource.status === "MAINTENANCE" ? (resource.resource_type === "DEVICE" ? "ONLINE" : "AVAILABLE") : "MAINTENANCE";
    setMaintenanceBusy(true);
    try {
      const response = await fetch("/api/control/resources", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `resource-status-${resource.id}-${resource.version}-${nextStatus}-${crypto.randomUUID()}` },
        credentials: "include",
        body: JSON.stringify({ resourceId: resource.id, command: "set_status", status: nextStatus, expectedVersion: resource.version, reason: nextStatus === "MAINTENANCE" ? "Staff requested controlled maintenance for this facility resource." : "Staff completed maintenance and returned this resource to service." }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        if (body.error === "RESOURCE_HAS_ACTIVE_APPOINTMENT") throw new Error("Reassign the active appointment before placing this resource into maintenance.");
        if (body.error === "STALE_RESOURCE") throw new Error("This resource changed while you were reviewing it. Refresh and try again.");
        throw new Error(body.error || "The resource status could not be changed.");
      }
      setMaintenanceConfirm(false);
      await refresh();
      onNotify(`${resource.display_name} is now ${nextStatus.toLowerCase()}.`, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "The resource status could not be changed.", "error"); }
    finally { setMaintenanceBusy(false); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations · Resource map"
        title="Resources"
        description="Rooms and kiosk devices are read from the facility resource catalog and current reservation records."
        actions={<><Button onClick={() => selected ? sendHeartbeat(selected) : onNotify("No resource is selected.", "warning")}>↻ Poll selected</Button><Button variant="primary" onClick={() => selected ? setMaintenanceConfirm(true) : onNotify("No resource is selected.", "warning")}>{selected?.status === "MAINTENANCE" ? "Restore selected" : "+ Maintenance request"}</Button></>}
      />
      {loading ? <div className="sv3-empty"><span>◌</span><strong>Loading resource catalog</strong><p>Reading facility-scoped room and device state.</p></div> : !resources.length ? <EmptyState title="No resource catalog configured" body="Apply the resources migration and seed the facility room/device records before approving appointments." /> : (
        <>
          <div className="sv3-resource-summary">
            <div className="sv3-resource-hero">
              <span className="sv3-eyebrow">Facility capacity</span>
              <strong>{usableRooms.length} <small>/ {rooms.length}</small></strong>
              <p>rooms currently usable</p>
              <div className="sv3-capacity-bar"><i style={{ width: `${Math.round((usableRooms.length / Math.max(1, rooms.length)) * 100)}%` }} /></div>
              <span>{rooms.filter((resource) => !resource.active_appointment_id).length} rooms without an active reservation</span>
            </div>
            <div><span>Online kiosks</span><strong>{devices.filter((resource) => resource.status === "ONLINE").length} / {devices.length}</strong><small>Catalog state · live API</small></div>
            <div><span>Active reservations</span><strong>{resources.filter((resource) => resource.active_appointment_id).length}</strong><small>Room and device assignments</small></div>
          </div>
          <div className="sv3-resource-layout">
            <section className="sv3-resource-board">
              <div className="sv3-resource-board-head"><div><span className="sv3-eyebrow">Live resource board</span><h2>Rooms & kiosks</h2></div><div className="sv3-resource-legend"><span><i className="green" />Healthy</span><span><i className="orange" />Reserved</span><span><i className="red" />Attention</span></div></div>
              <div className="sv3-resource-grid">{resources.map((resource) => <button key={resource.id} className={`sv3-resource-tile resource-${tone(resource)} ${selected?.id === resource.id ? "selected" : ""}`} onClick={() => setSelectedId(resource.id)}><div><span>{resource.resource_type}</span><Status tone={tone(resource)}>{resource.status}</Status></div><strong>{resource.display_name}</strong><small>{resource.active_appointment_id ? `Reserved for ${resource.active_appointment_id}` : resource.room_id ? `Attached to ${resource.room_id}` : resource.health_state}</small><i className="resource-signal" /></button>)}</div>
            </section>
            {selected ? (
              <aside className="sv3-resource-detail">
                <span className="sv3-eyebrow">Selected resource</span>
                <h2>{selected.display_name}</h2>
                <Status tone={tone(selected)}>{selected.status}</Status>
                <dl>
                  <div><dt>Health</dt><dd>{selected.health_state}</dd></div>
                  <div><dt>Last heartbeat</dt><dd>{selected.last_heartbeat_at ? new Date(selected.last_heartbeat_at).toLocaleString() : "Not recorded"}</dd></div>
                  <div><dt>Current reservation</dt><dd>{selected.active_appointment_id || "None"}</dd></div>
                  <div><dt>Version</dt><dd className="sv8-mono">{selected.version}</dd></div>
                </dl>
                {maintenanceConfirm ? <div className="sv3-resource-warning" role="alert"><strong>{selected.status === "MAINTENANCE" ? "Restore this resource?" : "Place this resource into maintenance?"}</strong><span>{selected.display_name}</span><small>{selected.active_appointment_id ? "An active appointment must be reassigned before maintenance can begin." : selected.status === "MAINTENANCE" ? "The resource will return to its normal available or online state." : "The resource will stop being considered available for new assignments."}</small><div><Button variant="quiet" onClick={() => setMaintenanceConfirm(false)} disabled={maintenanceBusy}>Cancel</Button><Button variant={selected.status === "MAINTENANCE" ? "primary" : "danger"} onClick={() => void changeMaintenance(selected)} disabled={maintenanceBusy || Boolean(selected.active_appointment_id && selected.status !== "MAINTENANCE")}>{maintenanceBusy ? "Saving…" : selected.status === "MAINTENANCE" ? "Restore resource" : "Confirm maintenance"}</Button></div></div> : null}
                {selected.active_appointment_id && (selected.status === "OFFLINE" || selected.health_state === "FAILED") ? <div className="sv3-resource-warning"><strong>Assignment requires attention</strong><span>{selected.active_appointment_id}</span><small>Move this visit to a healthy {selected.resource_type === "DEVICE" ? "kiosk" : "room"} before admission.</small>{reassignmentTargets.length ? <><label>Healthy target<select value={effectiveReassignTargetId} onChange={(event) => setReassignTargetId(event.target.value)}><option value="">Choose a target</option>{reassignmentTargets.map((resource) => <option key={resource.id} value={resource.id}>{resource.display_name} · v{resource.version}</option>)}</select></label><label>Reason<textarea value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} minLength={8} /></label><Button variant="primary" onClick={() => void submitReassignment()} disabled={reassigning || !effectiveReassignTargetId}>{reassigning ? "Reassigning…" : "Reassign visit"}</Button></> : <small>No healthy unreserved target is currently available.</small>}</div> : <Button onClick={() => sendHeartbeat(selected)}>Record heartbeat</Button>}
                {selected.resource_type === "DEVICE" ? <KioskCredentialManager key={selected.id} resourceId={selected.id} resourceName={selected.display_name} resourceVersion={selected.version} active={selected.has_active_kiosk_credential === 1} lastUsedAt={selected.kiosk_credential_last_used_at} onRefresh={refresh} onNotify={onNotify} /> : null}
              </aside>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

