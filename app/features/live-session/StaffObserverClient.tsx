"use client";

import { Room, RoomEvent, type Participant, type RemoteTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";

type ObserverProps = {
  sessionId: string;
  visitorName: string;
  prisonerName: string;
  token: string;
  serverUrl: string;
  onClose: () => void;
};

function isCallParticipant(participant: Participant) {
  return participant.identity.startsWith("visitor:") || participant.identity.startsWith("facility:");
}

export default function StaffObserverClient({ sessionId, visitorName, prisonerName, token, serverUrl, onClose }: ObserverProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "reconnecting" | "error">("connecting");
  const [error, setError] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const mediaRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const connected = new Set<string>();
    const syncParticipants = () => setParticipants(Array.from(connected));
    const attach = (track: RemoteTrack, participant: Participant) => {
      if (!isCallParticipant(participant) || !mediaRef.current) return;
      connected.add(participant.identity);
      syncParticipants();
      const element = track.attach();
      element.classList.add("sv9-observer-media");
      if (!mediaRef.current.contains(element)) mediaRef.current.appendChild(element);
    };
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!isCallParticipant(participant)) return;
      connected.add(participant.identity);
      syncParticipants();
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      connected.delete(participant.identity);
      syncParticipants();
    });
    room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
    room.on(RoomEvent.Reconnected, () => setStatus("connected"));
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === "connected") setStatus("connected");
      if (state === "reconnecting") setStatus("reconnecting");
    });
    void room.connect(serverUrl, token, { autoSubscribe: true }).then(() => {
      room.remoteParticipants.forEach((participant) => {
        if (!isCallParticipant(participant)) return;
        connected.add(participant.identity);
        participant.trackPublications.forEach((publication) => { if (publication.track) attach(publication.track, participant); });
      });
      syncParticipants();
      setStatus("connected");
    }).catch((cause: unknown) => {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "The observer connection could not be established.");
    });
    return () => {
      room.disconnect();
      roomRef.current = null;
    };
  }, [serverUrl, token]);

  return <div className="sv10-observer-backdrop" role="dialog" aria-modal="true" aria-labelledby="observer-title">
    <section className="sv10-observer-panel">
      <header><div><span className="sv9-kicker">STAFF OBSERVER · READ ONLY</span><h2 id="observer-title">{visitorName} ↔ {prisonerName}</h2><p className="sv-mono">{sessionId}</p></div><button aria-label="Close observer" onClick={onClose}>×</button></header>
      <div className="sv10-observer-status"><span className={status === "connected" ? "good" : status === "error" ? "bad" : "pending"}><i />{status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting" : status === "error" ? "Unavailable" : "Connecting"}</span><span>Recording · Off</span></div>
      <div className="sv10-observer-media" ref={mediaRef}>{status === "error" ? <p role="alert">{error}</p> : !participants.length ? <p>Waiting for visitor and facility media…</p> : null}</div>
      <footer><span>Observer audio and video publishing are disabled.</span><button className="sv4-button" onClick={onClose}>Close observer</button></footer>
    </section>
  </div>;
}
