"use client";

import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { liveSessionOutcome, nextLiveSessionViewStage, remoteSessionPerson, type PersistedSessionOutcome } from "@/lib/visitor/live-session-state";

type LiveRole = "VISITOR" | "FACILITY";
type SessionPayload = { id: string; visitId: string; status: string; appointmentStatus: string; authorizedEndAt: string; actualStartedAt: string | null; actualEndedAt: string | null; recordingPolicy: string; recordingStatus: string; visitorName: string; prisonerName: string };

type LiveSessionClientProps = { visitId: string; role: LiveRole; kioskId?: string; initialKioskCredential?: string };

function apiError(body: Record<string, unknown>, fallback: string) {
  const code = typeof body.error === "string" ? body.error : "";
  if (code === "VIDEO_PROVIDER_NOT_CONFIGURED") return "Video provider is not configured for this environment yet.";
  if (code === "SESSION_NOT_READY" || code === "SESSION_ENDED" || code === "SESSION_EXPIRED") return "This visit is not currently available to join.";
  if (code === "KIOSK_AUTHENTICATION_REQUIRED" || code === "KIOSK_NOT_ASSIGNED_TO_VISIT") return "This facility device is not authorized for this visit.";
  return fallback;
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")} : ${String(safe % 60).padStart(2, "0")}`;
}

function participantInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SV";
}

function isVideoTrack(track: RemoteTrack | null): boolean {
  return Boolean(track && track.kind === Track.Kind.Video);
}

export default function LiveSessionClient({ visitId, role, kioskId, initialKioskCredential = "" }: LiveSessionClientProps) {
  const router = useRouter();
  const [stage, setStage] = useState<"loading" | "connecting" | "active" | "reconnecting" | "confirming" | "ended" | "left" | "error">("loading");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteName, setRemoteName] = useState("Your visit partner");
  const [terminalOutcome, setTerminalOutcome] = useState<PersistedSessionOutcome | null>(null);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const [connectionLabel, setConnectionLabel] = useState("Connecting");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [kioskDeviceId, setKioskDeviceId] = useState(kioskId || "");
  const [kioskDeviceIdInput, setKioskDeviceIdInput] = useState(kioskId || "");
  const [kioskCredential, setKioskCredential] = useState(initialKioskCredential);
  const [kioskCredentialInput, setKioskCredentialInput] = useState("");
  const roomRef = useRef<Room | null>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const scheduledEndReached = useRef(false);
  const remoteParticipants = useRef(new Set<string>());
  const remoteVideoTracks = useRef(new Map<string, Set<RemoteTrack>>());

  const isVisitor = role === "VISITOR";
  const title = remoteName;
  const subtitle = session ? `${session.visitorName} ↔ ${session.prisonerName} · secure video visit` : "Secure video visit";
  const remoteInitials = useMemo(() => participantInitials(title), [title]);

  function isExpectedRemote(participant: Participant) {
    const identity = participant.identity;
    return isVisitor ? identity.startsWith("facility:") : identity.startsWith("visitor:");
  }

  function syncRemoteState() {
    setRemoteConnected(remoteParticipants.current.size > 0);
    setRemoteVideo(Array.from(remoteVideoTracks.current.values()).some((tracks) => tracks.size > 0));
  }

  useEffect(() => {
    if (isVisitor || !kioskDeviceId || !kioskCredential) return;
    const clearPresence = () => {
      void fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-securevisit-kiosk-id": kioskDeviceId, "x-securevisit-kiosk-token": kioskCredential },
        body: JSON.stringify({ presence: "absent" }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    };
    const onPageHide = () => clearPresence();
    window.addEventListener("pagehide", onPageHide);
    return () => { window.removeEventListener("pagehide", onPageHide); clearPresence(); };
  }, [isVisitor, kioskDeviceId, kioskCredential, visitId]);

  useEffect(() => {
    if (isVisitor || !kioskDeviceId || !kioskCredential) return;
    let active = true;
    const sendHeartbeat = async () => {
      try {
        const response = await fetch("/api/kiosk/heartbeat", {
          method: "POST",
          headers: { accept: "application/json", "x-securevisit-kiosk-id": kioskDeviceId, "x-securevisit-kiosk-token": kioskCredential },
          cache: "no-store",
        });
        if (active && (response.status === 401 || response.status === 403)) {
          setKioskCredential("");
          setError("This facility device session has expired. Authenticate the kiosk again.");
        }
      } catch {
        // A temporary heartbeat failure is reflected by the server-side freshness window.
      }
    };
    void sendHeartbeat();
    const timer = window.setInterval(() => void sendHeartbeat(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isVisitor, kioskDeviceId, kioskCredential]);

  useEffect(() => {
    if (isVisitor || !kioskDeviceId || !kioskCredential) return;
    let active = true;
    const presence = ["ended", "left", "error"].includes(stage) ? "absent" : "present";
    const reportPresence = async () => {
      try {
        await fetch(`/api/kiosk/visits/${encodeURIComponent(visitId)}/presence`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "x-securevisit-kiosk-id": kioskDeviceId, "x-securevisit-kiosk-token": kioskCredential },
          body: JSON.stringify({ presence }),
          cache: "no-store",
        });
      } catch {
        // The server-side readiness state remains unchanged until a report succeeds.
      }
    };
    void reportPresence();
    const timer = presence === "present" ? window.setInterval(() => { if (active) void reportPresence(); }, 15_000) : null;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [isVisitor, kioskDeviceId, kioskCredential, visitId, stage]);

  useEffect(() => {
    let active = true;
    const participants = remoteParticipants.current;
    const videoTracks = remoteVideoTracks.current;
    async function start() {
      if (!isVisitor && (!kioskDeviceId || !kioskCredential)) return;
      try {
        const detailsUrl = isVisitor ? `/api/visitor/visits/${encodeURIComponent(visitId)}/live-session` : `/api/kiosk/visits/${encodeURIComponent(visitId)}/live-session`;
        const kioskHeaders: Record<string, string> = isVisitor ? {} : { "x-securevisit-kiosk-id": kioskDeviceId, "x-securevisit-kiosk-token": kioskCredential };
        const detailsResponse = await fetch(detailsUrl, { headers: { accept: "application/json", ...kioskHeaders } });
        const detailsBody = await detailsResponse.json() as Record<string, unknown>;
        if (!detailsResponse.ok) throw new Error(apiError(detailsBody, "We could not load this visit."));
        const sessionBody = detailsBody.session as SessionPayload | undefined;
        if (sessionBody && active) {
          setSession(sessionBody);
          setRemoteName(remoteSessionPerson(role, sessionBody));
          const outcome = liveSessionOutcome(sessionBody.status, sessionBody.appointmentStatus);
          if (outcome) {
            setTerminalOutcome(outcome);
            setStage(nextLiveSessionViewStage("loading", { persistedOutcome: outcome }));
            return;
          }
        }
        const tokenResponse = await fetch(detailsUrl, { method: "POST", headers: { accept: "application/json", ...kioskHeaders } });
        const tokenBody = await tokenResponse.json() as Record<string, unknown>;
        if (!tokenResponse.ok && ["SESSION_EXPIRED", "SESSION_ENDED"].includes(String(tokenBody.error))) {
          scheduledEndReached.current = true;
          setStage("confirming");
          return;
        }
        if (!tokenResponse.ok) throw new Error(apiError(tokenBody, "Secure video could not start."));
        const token = typeof tokenBody.token === "string" ? tokenBody.token : "";
        const serverUrl = typeof tokenBody.serverUrl === "string" ? tokenBody.serverUrl : "";
        const responseSession = tokenBody.session as SessionPayload | undefined;
        if (responseSession && active) {
          setSession(responseSession);
          setRemoteName(remoteSessionPerson(role, responseSession));
        }
        if (!token || !serverUrl) throw new Error("The video session did not return a valid connection.");
        if (active) setStage("connecting");
        await connectRoom(serverUrl, token);
      } catch (caught) {
        if (!active) return;
        if (!isVisitor && caught instanceof Error && caught.message === "This facility device is not authorized for this visit.") setKioskCredential("");
        setStage("error");
        setError(caught instanceof Error ? caught.message : "Secure video could not start.");
      }
    }
    void start();
    return () => {
      active = false;
      roomRef.current?.disconnect();
      roomRef.current = null;
      participants.clear();
      videoTracks.clear();
    };
    // The session is intentionally initialized once per visit/role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, role, kioskDeviceId, kioskCredential]);

  useEffect(() => {
    if (!session) return;
    const end = Date.parse(session.authorizedEndAt);
    if (!Number.isFinite(end)) return;
    const update = () => {
      const seconds = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setRemaining(seconds);
      const nextStage = nextLiveSessionViewStage(stage, { remainingSeconds: seconds });
      if (nextStage !== stage && !scheduledEndReached.current) {
        scheduledEndReached.current = true;
        setStage(nextStage);
        roomRef.current?.disconnect();
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session, stage]);

  useEffect(() => {
    if (stage !== "confirming" && stage !== "reconnecting") return;
    let active = true;
    const statusUrl = isVisitor
      ? `/api/visitor/visits/${encodeURIComponent(visitId)}/live-session`
      : `/api/kiosk/visits/${encodeURIComponent(visitId)}/live-session`;
    const headers: Record<string, string> = isVisitor ? {} : { "x-securevisit-kiosk-id": kioskDeviceId, "x-securevisit-kiosk-token": kioskCredential };
    async function checkPersistedOutcome() {
      try {
        const response = await fetch(statusUrl, { headers: { accept: "application/json", ...headers }, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { session?: SessionPayload };
        if (!active || !body.session) return;
        const outcome = liveSessionOutcome(body.session.status, body.session.appointmentStatus);
        if (!outcome) return;
        setSession(body.session);
        setTerminalOutcome(outcome);
        setStage((current) => nextLiveSessionViewStage(current, { persistedOutcome: outcome }));
      } catch {
        // A temporary status-service outage must not be presented as a completed visit.
      }
    }
    void checkPersistedOutcome();
    const timer = window.setInterval(() => void checkPersistedOutcome(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [stage, isVisitor, visitId, kioskDeviceId, kioskCredential]);

  async function connectRoom(serverUrl: string, token: string) {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (isExpectedRemote(participant)) attachRemoteTrack(track, participant);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (isExpectedRemote(participant)) detachTrack(track, participant);
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!isExpectedRemote(participant)) return;
      remoteParticipants.current.add(participant.identity);
      setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, ""));
      syncRemoteState();
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (!isExpectedRemote(participant)) return;
      remoteParticipants.current.delete(participant.identity);
      remoteVideoTracks.current.delete(participant.identity);
      syncRemoteState();
    });
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === "connected") { setStage((current) => ["ended", "left", "error"].includes(current) ? current : scheduledEndReached.current ? "confirming" : "active"); setConnectionLabel("Good"); }
      if (state === "reconnecting") { setStage((current) => ["ended", "left", "error", "confirming"].includes(current) ? current : "reconnecting"); setConnectionLabel("Reconnecting"); }
      if (state === "disconnected") {
        setConnectionLabel("Disconnected");
        setStage((current) => nextLiveSessionViewStage(current, { connectionDisconnected: true, scheduledTimeEnded: scheduledEndReached.current }));
      }
    });
    room.on(RoomEvent.Reconnecting, () => { setStage((current) => ["ended", "left", "error", "confirming"].includes(current) ? current : "reconnecting"); setConnectionLabel("Reconnecting"); });
    room.on(RoomEvent.Reconnected, () => { setStage((current) => ["ended", "left", "error"].includes(current) ? current : scheduledEndReached.current ? "confirming" : "active"); setConnectionLabel("Good"); });
    room.on(RoomEvent.TrackMuted, (publication, participant) => { if (participant.identity !== room.localParticipant.identity && publication.kind === Track.Kind.Audio) setRemoteMicMuted(true); });
    room.on(RoomEvent.TrackUnmuted, (publication, participant) => { if (participant.identity !== room.localParticipant.identity && publication.kind === Track.Kind.Audio) setRemoteMicMuted(false); });
    await room.connect(serverUrl, token, { autoSubscribe: true });
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
    setCameraEnabled(true);
    setMicEnabled(true);
    const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (localVideoTrack && localRef.current) {
      const element = localVideoTrack.attach();
      element.classList.add("sv9-local-media");
      if (!localRef.current.contains(element)) localRef.current.appendChild(element);
    }
    room.remoteParticipants.forEach((participant) => {
      if (!isExpectedRemote(participant)) return;
      remoteParticipants.current.add(participant.identity);
      setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, ""));
      participant.trackPublications.forEach((publication) => { if (publication.track) attachRemoteTrack(publication.track, participant); });
    });
    syncRemoteState();
    await refreshDevices(room);
  }

  function attachRemoteTrack(track: RemoteTrack, participant: Participant) {
    if (!remoteRef.current) return;
    if (!isExpectedRemote(participant)) return;
    remoteParticipants.current.add(participant.identity);
    setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, ""));
    if (isVideoTrack(track)) {
      const tracks = remoteVideoTracks.current.get(participant.identity) || new Set<RemoteTrack>();
      tracks.add(track);
      remoteVideoTracks.current.set(participant.identity, tracks);
    }
    const element = track.attach();
    element.classList.add("sv9-remote-media");
    if (!remoteRef.current.contains(element)) remoteRef.current.appendChild(element);
    syncRemoteState();
  }

  function detachTrack(track: RemoteTrack, participant: Participant) {
    if (isVideoTrack(track)) {
      const tracks = remoteVideoTracks.current.get(participant.identity);
      tracks?.delete(track);
      if (tracks?.size === 0) remoteVideoTracks.current.delete(participant.identity);
    }
    track.detach().forEach((element) => element.remove());
    syncRemoteState();
  }

  async function refreshDevices(room = roomRef.current) {
    if (!room) return;
    try {
      const inputs = await navigator.mediaDevices.enumerateDevices();
      setDevices(inputs.filter((device) => device.kind === "videoinput" || device.kind === "audioinput"));
    } catch { /* Device labels may be unavailable until permission is granted. */ }
  }

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setCameraEnabled(next);
  }

  async function switchDevice(device: MediaDeviceInfo) {
    const room = roomRef.current;
    if (!room) return;
    await room.switchActiveDevice(device.kind === "videoinput" ? "videoinput" : "audioinput", device.deviceId);
    setShowMore(false);
  }

  async function enableAudio() {
    try {
      await roomRef.current?.startAudio();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  }

  function leaveVisit() {
    roomRef.current?.disconnect();
    setStage("left");
  }

  const statusCopy = stage === "reconnecting" ? "Connection interrupted · reconnecting" : remoteConnected ? `${connectionLabel} connection` : "Waiting for the other side";

  if (!isVisitor && !kioskCredential) return <div className="sv9-live-app sv9-kiosk-live"><LiveHeader role={role} /><main className="sv9-state-screen sv9-state-error"><span className="sv9-state-mark">▣</span><p className="sv9-kicker">CONTROLLED FACILITY DEVICE</p><h1>Connect this kiosk</h1><p>Enter the registered device ID and its facility-issued credential. It stays in this page’s memory and is not added to the URL or saved in browser storage.</p>{error && <p role="alert">{error}</p>}<form className="sv9-kiosk-auth-form" onSubmit={(event) => { event.preventDefault(); const id = kioskDeviceIdInput.trim(); const secret = kioskCredentialInput.trim(); if (!id || !secret) return; setKioskDeviceId(id); setKioskCredential(secret); setKioskCredentialInput(""); setError(""); setStage("loading"); }}><label>Registered kiosk ID<input autoComplete="off" value={kioskDeviceIdInput} onChange={(event) => setKioskDeviceIdInput(event.target.value)} required /></label><label>One-time device credential<input type="password" autoComplete="off" spellCheck={false} value={kioskCredentialInput} onChange={(event) => setKioskCredentialInput(event.target.value)} required /></label><button className="sv9-button sv9-button-primary" type="submit" disabled={!kioskDeviceIdInput.trim() || !kioskCredentialInput.trim()}>Authenticate kiosk</button></form></main></div>;
  if (stage === "loading" || stage === "connecting") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen"><span className="sv9-state-mark">◌</span><p className="sv9-kicker">SECURE VISIT</p><h1>{stage === "loading" ? "Preparing your secure visit" : "Connecting your secure video"}</h1><p>{stage === "loading" ? "Checking the visit authorization and session window." : "Your camera and microphone stay protected while we connect."}</p><span className="sv9-loading-line" /></main></div>;
  if (stage === "confirming") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen"><span className="sv9-state-mark">◌</span><p className="sv9-kicker">SECURE VISIT</p><h1>Scheduled time ended</h1><p>Confirming visit status with the facility. Your visit summary will update when the outcome is recorded.</p><span className="sv9-loading-line" /></main></div>;
  if (stage === "left") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen"><span className="sv9-state-mark">↗</span><p className="sv9-kicker">SECURE VISIT</p><h1>This device left the call</h1><p>Disconnecting this device does not determine the visit outcome. The facility’s recorded status and credit result will appear in your visit summary.</p>{isVisitor ? <button className="sv9-button sv9-button-primary" onClick={() => router.push(`/visitor/visits/${encodeURIComponent(visitId)}`)}>Back to visit summary <span>→</span></button> : <span className="sv9-kiosk-lock">This facility device is disconnected.</span>}</main></div>;
  if (stage === "error") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen sv9-state-error"><span className="sv9-state-mark">!</span><p className="sv9-kicker">SECURE VIDEO</p><h1>We couldn’t start this visit</h1><p>{error}</p><div className="sv9-state-actions"><button className="sv9-button sv9-button-primary" onClick={() => window.location.reload()}>Try again</button>{isVisitor ? <button className="sv9-button" onClick={() => router.push(`/visitor/visits/${encodeURIComponent(visitId)}`)}>Back to visit details</button> : null}</div></main></div>;
  if (stage === "ended") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen sv9-state-complete"><span className="sv9-state-mark">{terminalOutcome === "COMPLETED" ? "✓" : "i"}</span><p className="sv9-kicker">{terminalOutcome === "COMPLETED" ? "VISIT COMPLETE" : terminalOutcome === "CANCELLED" ? "VISIT CANCELLED" : "VISIT ENDED"}</p><h1>{terminalOutcome === "COMPLETED" ? "Your visit is complete" : terminalOutcome === "CANCELLED" ? "This visit was cancelled" : "The facility ended this visit"}</h1><p>{terminalOutcome === "COMPLETED" ? `The facility recorded your visit with ${title} as complete.` : terminalOutcome === "CANCELLED" ? "The facility recorded this appointment as cancelled." : "The facility recorded a technical failure or termination. Check your visit summary for the credit outcome."}</p>{isVisitor ? <button className="sv9-button sv9-button-primary" onClick={() => router.push(`/visitor/visits/${encodeURIComponent(visitId)}`)}>Back to visit summary <span>→</span></button> : <div className="sv9-state-actions"><button className="sv9-button sv9-button-primary" onClick={() => router.push(`/kiosk/visits/${encodeURIComponent(visitId)}`)}>Return kiosk to ready state <span>→</span></button><span className="sv9-kiosk-lock">The previous visit credentials and media session will be cleared from this page.</span></div>}</main></div>;

  return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-live-main"><header className="sv9-session-head"><div><span className="sv9-kicker">{isVisitor ? "YOUR SECURE VISIT" : "FACILITY KIOSK · CONTROLLED DEVICE"}</span><h1>{title}</h1><p>{subtitle}</p></div><div className="sv9-session-meta"><span className="sv9-live-pill"><i /> LIVE</span><strong>{formatRemaining(remaining)}</strong><small>remaining</small></div></header><section className="sv9-stage"><div className="sv9-remote-panel" ref={remoteRef}><div className={`sv9-remote-placeholder ${remoteVideo ? "has-video" : ""}`}><span className="sv9-remote-avatar">{remoteInitials}</span><strong>{remoteName}</strong>{!remoteConnected ? <small>Waiting for {isVisitor ? "the facility" : "the visitor"} to connect</small> : !remoteVideo ? <small>Camera is currently off</small> : null}</div><div className="sv9-remote-status"><span className={remoteConnected ? "good" : "pending"}><i />{remoteConnected ? "Connected" : "Waiting to connect"}</span>{remoteMicMuted ? <span>Microphone muted</span> : null}</div></div><div className="sv9-self-preview" ref={localRef}><span className="sv9-self-label">YOU</span>{cameraEnabled ? <span className="sv9-self-camera-placeholder">Camera preview</span> : <span className="sv9-self-camera-placeholder">Camera off</span>}</div><div className="sv9-stage-caption"><span>{statusCopy}</span><span>Recording · {session?.recordingPolicy === "OFF" ? "Off" : session?.recordingStatus || "Policy controlled"}</span></div></section>{audioBlocked ? <button className="sv9-audio-banner" onClick={enableAudio}>Tap to hear the visit <span>Enable audio →</span></button> : null}<footer className="sv9-controls"><div className="sv9-control-group"><button aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"} className={`sv9-control ${micEnabled ? "" : "off"}`} onClick={() => void toggleMicrophone()}><span>{micEnabled ? "◉" : "⊘"}</span><small>{micEnabled ? "Mute" : "Unmute"}</small></button><button aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"} className={`sv9-control ${cameraEnabled ? "" : "off"}`} onClick={() => void toggleCamera()}><span>{cameraEnabled ? "▣" : "□"}</span><small>{cameraEnabled ? "Camera" : "Camera off"}</small></button><button aria-expanded={showMore} aria-label="Open more media settings" className="sv9-control" onClick={() => { setShowMore((value) => !value); void refreshDevices(); }}><span>•••</span><small>More</small></button></div><button className="sv9-leave-button" onClick={leaveVisit}>Leave visit</button></footer>{showMore ? <div className="sv9-device-popover"><div><strong>Media settings</strong><button aria-label="Close media settings" onClick={() => setShowMore(false)}>×</button></div>{devices.length ? devices.map((device) => <button key={device.deviceId} onClick={() => void switchDevice(device)}>{device.kind === "videoinput" ? "Camera" : "Microphone"} · {device.label || "Available device"}</button>) : <p>Device choices will appear after permission is granted.</p>}</div> : null}</main></div>;
}

function LiveHeader({ role }: { role: LiveRole }) {
  return <header className="sv9-live-header"><div className="sv9-brand"><span className="sv9-brand-mark">+</span><span><strong>SecureVisit</strong><small>{role === "VISITOR" ? "Visitor" : "Facility kiosk"}</small></span></div><span className="sv9-secure-label"><i />Encrypted media channel</span></header>;
}
