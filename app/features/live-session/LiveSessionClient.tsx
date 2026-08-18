"use client";

import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";

type LiveRole = "VISITOR" | "FACILITY";
type SessionPayload = { id: string; visitId: string; status: string; authorizedEndAt: string; actualStartedAt: string | null; recordingPolicy: string; recordingStatus: string; visitor: string; prisonerId: string };

type LiveSessionClientProps = { visitId: string; role: LiveRole; kioskId?: string };

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

export default function LiveSessionClient({ visitId, role, kioskId }: LiveSessionClientProps) {
  const [stage, setStage] = useState<"loading" | "connecting" | "active" | "reconnecting" | "ended" | "error">("loading");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteName, setRemoteName] = useState(role === "VISITOR" ? "A. Rahman" : "Visitor");
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const [connectionLabel, setConnectionLabel] = useState("Connecting");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const roomRef = useRef<Room | null>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);

  const isVisitor = role === "VISITOR";
  const title = isVisitor ? remoteName : "Sarah Amelia";
  const subtitle = isVisitor ? "A. Rahman · secure video visit" : "A. Rahman ↔ Sarah Amelia";
  const remoteInitials = useMemo(() => participantInitials(title), [title]);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const detailsUrl = isVisitor ? `/api/visitor/visits/${encodeURIComponent(visitId)}/live-session` : null;
        const detailsResponse = detailsUrl ? await fetch(detailsUrl, { headers: { accept: "application/json" } }) : null;
        const detailsBody = detailsResponse ? await detailsResponse.json() as Record<string, unknown> : {};
        if (detailsResponse && !detailsResponse.ok) throw new Error(apiError(detailsBody, "We could not load this visit."));
        const sessionBody = detailsBody.session as SessionPayload | undefined;
        if (sessionBody && active) {
          setSession(sessionBody);
          setRemoteName(isVisitor ? sessionBody.prisonerId === "F. Hidayat" ? "F. Hidayat" : "A. Rahman" : "Sarah Amelia");
        }
        const tokenUrl = isVisitor ? detailsUrl! : `/api/kiosk/visits/${encodeURIComponent(visitId)}/live-session`;
        const tokenResponse = await fetch(tokenUrl, { method: "POST", headers: { accept: "application/json", ...(isVisitor ? {} : { "x-securevisit-kiosk-id": kioskId || "" }) } });
        const tokenBody = await tokenResponse.json() as Record<string, unknown>;
        if (!tokenResponse.ok) throw new Error(apiError(tokenBody, "Secure video could not start."));
        const token = typeof tokenBody.token === "string" ? tokenBody.token : "";
        const serverUrl = typeof tokenBody.serverUrl === "string" ? tokenBody.serverUrl : "";
        const responseSession = tokenBody.session as SessionPayload | undefined;
        if (responseSession && active) setSession(responseSession);
        if (!token || !serverUrl) throw new Error("The video session did not return a valid connection.");
        if (active) setStage("connecting");
        await connectRoom(serverUrl, token);
      } catch (caught) {
        if (!active) return;
        setStage("error");
        setError(caught instanceof Error ? caught.message : "Secure video could not start.");
      }
    }
    void start();
    return () => {
      active = false;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
    // The session is intentionally initialized once per visit/role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, role]);

  useEffect(() => {
    if (!session) return;
    const end = Date.parse(session.authorizedEndAt);
    if (!Number.isFinite(end)) return;
    const update = () => {
      const seconds = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0 && stage === "active") setStage("ended");
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session, stage]);

  async function connectRoom(serverUrl: string, token: string) {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attachRemoteTrack(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track));
    room.on(RoomEvent.ParticipantConnected, (participant) => { setRemoteConnected(true); setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, "")); });
    room.on(RoomEvent.ParticipantDisconnected, () => { setRemoteConnected(false); setRemoteVideo(false); });
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === "connected") { setStage("active"); setConnectionLabel("Good"); }
      if (state === "reconnecting") { setStage("reconnecting"); setConnectionLabel("Reconnecting"); }
      if (state === "disconnected") { setStage("ended"); setConnectionLabel("Disconnected"); }
    });
    room.on(RoomEvent.Reconnecting, () => { setStage("reconnecting"); setConnectionLabel("Reconnecting"); });
    room.on(RoomEvent.Reconnected, () => { setStage("active"); setConnectionLabel("Good"); });
    room.on(RoomEvent.TrackMuted, (publication, participant) => { if (participant.identity !== room.localParticipant.identity && publication.kind === Track.Kind.Audio) setRemoteMicMuted(true); });
    room.on(RoomEvent.TrackUnmuted, (publication, participant) => { if (participant.identity !== room.localParticipant.identity && publication.kind === Track.Kind.Audio) setRemoteMicMuted(false); });
    await room.connect(serverUrl, token, { autoSubscribe: true });
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
    setCameraEnabled(true);
    setMicEnabled(true);
    const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (localVideoTrack && localRef.current) {
      localVideoTrack.attach().forEach((element) => {
        element.classList.add("sv9-local-media");
        if (localRef.current && !localRef.current.contains(element)) localRef.current.appendChild(element);
      });
    }
    room.remoteParticipants.forEach((participant) => {
      setRemoteConnected(true);
      setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, ""));
      participant.trackPublications.forEach((publication) => { if (publication.track) attachRemoteTrack(publication.track, participant); });
    });
    await refreshDevices(room);
  }

  function attachRemoteTrack(track: RemoteTrack, participant: Participant) {
    if (!remoteRef.current) return;
    setRemoteConnected(true);
    setRemoteName(participant.name || participant.identity.replace(/^visitor:|^facility:/, ""));
    if (isVideoTrack(track)) setRemoteVideo(true);
    const elements = track.attach();
    elements.forEach((element) => {
      element.classList.add("sv9-remote-media");
      if (remoteRef.current && !remoteRef.current.contains(element)) remoteRef.current.appendChild(element);
    });
  }

  function detachTrack(track: RemoteTrack) {
    if (isVideoTrack(track)) setRemoteVideo(false);
    track.detach().forEach((element) => element.remove());
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
    setStage("ended");
  }

  const statusCopy = stage === "reconnecting" ? "Connection interrupted · reconnecting" : remoteConnected ? `${connectionLabel} connection` : "Waiting for the other side";
  const visitorEndedCopy = remaining === 0 ? "Your visit time has ended." : "You left the secure visit.";

  if (stage === "loading" || stage === "connecting") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen"><span className="sv9-state-mark">◌</span><p className="sv9-kicker">SECURE VISIT</p><h1>{stage === "loading" ? "Preparing your secure visit" : "Connecting your secure video"}</h1><p>{stage === "loading" ? "Checking the visit authorization and session window." : "Your camera and microphone stay protected while we connect."}</p><span className="sv9-loading-line" /></main></div>;
  if (stage === "error") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen sv9-state-error"><span className="sv9-state-mark">!</span><p className="sv9-kicker">SECURE VIDEO</p><h1>We couldn’t start this visit</h1><p>{error}</p><div className="sv9-state-actions"><button className="sv9-button sv9-button-primary" onClick={() => window.location.reload()}>Try again</button>{isVisitor ? <button className="sv9-button" onClick={() => { window.location.href = `/visitor/visits/${visitId}`; }}>Back to visit details</button> : null}</div></main></div>;
  if (stage === "ended") return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-state-screen sv9-state-complete"><span className="sv9-state-mark">✓</span><p className="sv9-kicker">{remaining === 0 ? "VISIT COMPLETE" : "VISIT ENDED"}</p><h1>{remaining === 0 ? "Your visit is complete" : "You’ve left the visit"}</h1><p>{remaining === 0 ? `You spent ${session ? "the scheduled time" : "time"} with ${title}.` : visitorEndedCopy}</p>{isVisitor ? <button className="sv9-button sv9-button-primary" onClick={() => { window.location.href = `/visitor/visits/${visitId}?state=completed`; }}>Back to visit summary <span>→</span></button> : <span className="sv9-kiosk-lock">This facility device is ready for the next assigned visit.</span>}</main></div>;

  return <div className={`sv9-live-app ${isVisitor ? "sv9-visitor-live" : "sv9-kiosk-live"}`}><LiveHeader role={role} /><main className="sv9-live-main"><header className="sv9-session-head"><div><span className="sv9-kicker">{isVisitor ? "YOUR SECURE VISIT" : "FACILITY KIOSK · CONTROLLED DEVICE"}</span><h1>{title}</h1><p>{subtitle}</p></div><div className="sv9-session-meta"><span className="sv9-live-pill"><i /> LIVE</span><strong>{formatRemaining(remaining)}</strong><small>remaining</small></div></header><section className="sv9-stage"><div className="sv9-remote-panel" ref={remoteRef}><div className={`sv9-remote-placeholder ${remoteVideo ? "has-video" : ""}`}><span className="sv9-remote-avatar">{remoteInitials}</span><strong>{remoteName}</strong>{!remoteConnected ? <small>Waiting for {isVisitor ? "the facility" : "the visitor"} to connect</small> : !remoteVideo ? <small>Camera is currently off</small> : null}</div><div className="sv9-remote-status"><span className={remoteConnected ? "good" : "pending"}><i />{remoteConnected ? "Connected" : "Waiting to connect"}</span>{remoteMicMuted ? <span>Microphone muted</span> : null}</div></div><div className="sv9-self-preview" ref={localRef}><span className="sv9-self-label">YOU</span>{cameraEnabled ? <span className="sv9-self-camera-placeholder">Camera preview</span> : <span className="sv9-self-camera-placeholder">Camera off</span>}</div><div className="sv9-stage-caption"><span>{statusCopy}</span><span>Recording · {session?.recordingPolicy === "OFF" ? "Off" : session?.recordingStatus || "Policy controlled"}</span></div></section>{audioBlocked ? <button className="sv9-audio-banner" onClick={enableAudio}>Tap to hear the visit <span>Enable audio →</span></button> : null}<footer className="sv9-controls"><div className="sv9-control-group"><button aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"} className={`sv9-control ${micEnabled ? "" : "off"}`} onClick={() => void toggleMicrophone()}><span>{micEnabled ? "◉" : "⊘"}</span><small>{micEnabled ? "Mute" : "Unmute"}</small></button><button aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"} className={`sv9-control ${cameraEnabled ? "" : "off"}`} onClick={() => void toggleCamera()}><span>{cameraEnabled ? "▣" : "□"}</span><small>{cameraEnabled ? "Camera" : "Camera off"}</small></button><button aria-expanded={showMore} aria-label="Open more media settings" className="sv9-control" onClick={() => { setShowMore((value) => !value); void refreshDevices(); }}><span>•••</span><small>More</small></button></div><button className="sv9-leave-button" onClick={leaveVisit}>Leave visit</button></footer>{showMore ? <div className="sv9-device-popover"><div><strong>Media settings</strong><button aria-label="Close media settings" onClick={() => setShowMore(false)}>×</button></div>{devices.length ? devices.map((device) => <button key={device.deviceId} onClick={() => void switchDevice(device)}>{device.kind === "videoinput" ? "Camera" : "Microphone"} · {device.label || "Available device"}</button>) : <p>Device choices will appear after permission is granted.</p>}</div> : null}</main></div>;
}

function LiveHeader({ role }: { role: LiveRole }) {
  return <header className="sv9-live-header"><div className="sv9-brand"><span className="sv9-brand-mark">+</span><span><strong>SecureVisit</strong><small>{role === "VISITOR" ? "Visitor" : "Facility kiosk"}</small></span></div><span className="sv9-secure-label"><i />Encrypted media channel</span></header>;
}
