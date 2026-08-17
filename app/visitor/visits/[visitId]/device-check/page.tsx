"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

type DeviceStep = "intro" | "permissions" | "camera" | "microphone" | "connection" | "summary" | "permission_error" | "unsupported";
type CheckStatus = "checking" | "ready" | "warning" | "failed";
type NetworkRating = "stable" | "fair" | "poor" | "unknown";

type NetworkResult = {
  rating: NetworkRating;
  latencyMs?: number;
  warnings: string[];
};

const visitId = "SV-260814-018";

const progressSteps: { key: DeviceStep; label: string }[] = [
  { key: "camera", label: "Camera" },
  { key: "microphone", label: "Microphone" },
  { key: "connection", label: "Connection" },
  { key: "summary", label: "Summary" },
];

function statusLabel(status: CheckStatus, kind: "camera" | "microphone") {
  if (status === "ready") return kind === "camera" ? "Looking good" : "We can hear you";
  if (status === "warning") return kind === "camera" ? "Working with a note" : "Very quiet";
  if (status === "failed") return kind === "camera" ? "Needs attention" : "Couldn’t detect audio";
  return kind === "camera" ? "Checking your camera…" : "Listening for your voice…";
}

function DeviceCheckHeader({ onBack }: { onBack: () => void }) {
  return <header className="sv4-header"><div className="sv4-header-inner"><button className="sv4-brand" onClick={onBack}><span className="sv4-brand-mark">+</span><span><strong>SecureVisit</strong><small>Visitor</small></span></button><div className="dc-header-context"><span>Visit preparation</span><b>·</b><strong>A. Rahman</strong></div><div className="sv4-header-actions"><span className="sv4-secure-note"><i />Secure session</span><span className="sv4-avatar sv4-avatar-coral">SA</span></div></div></header>;
}

export default function DeviceCheckPage() {
  const [step, setStep] = useState<DeviceStep>("intro");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CheckStatus>("checking");
  const [microphoneStatus, setMicrophoneStatus] = useState<CheckStatus>("checking");
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMicrophone, setSelectedMicrophone] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [network, setNetwork] = useState<NetworkResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [permissionHelp, setPermissionHelp] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micSignalRef = useRef(0);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    return () => {
      stopMedia();
      stopAudioAnalysis();
    };
  }, []);

  useEffect(() => {
    if (step !== "camera" || !stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => undefined);
    setCameraStatus("checking");
    const timer = window.setTimeout(() => {
      const track = stream.getVideoTracks()[0];
      const hasVideo = Boolean(track && track.readyState === "live" && video.videoWidth > 0 && video.videoHeight > 0);
      setCameraStatus(hasVideo ? "ready" : "failed");
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [step, stream, selectedCamera]);

  // The flow controller intentionally starts and tears down the analyser at step boundaries.
  useEffect(() => {
    if (step !== "microphone" || !stream) return;
    startAudioAnalysis(stream);
    return () => stopAudioAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stream, attempt]);

  useEffect(() => {
    if (step !== "connection") return;
    void runConnectionTest();
  }, [step, attempt]);

  function stopMedia() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }

  function stopAudioAnalysis() {
    if (audioFrameRef.current !== null) cancelAnimationFrame(audioFrameRef.current);
    audioFrameRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") void audioContextRef.current.close();
    audioContextRef.current = null;
  }

  async function startCheck() {
    setErrorMessage("");
    setPermissionHelp(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStep("unsupported");
      return;
    }
    setStep("permissions");
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(nextStream);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");
      const microphones = devices.filter((device) => device.kind === "audioinput");
      setCameraDevices(cameras);
      setMicrophoneDevices(microphones);
      setSelectedCamera(nextStream.getVideoTracks()[0]?.getSettings().deviceId || cameras[0]?.deviceId || "");
      setSelectedMicrophone(nextStream.getAudioTracks()[0]?.getSettings().deviceId || microphones[0]?.deviceId || "");
      setStep("camera");
    } catch {
      setStep("permission_error");
    }
  }

  async function switchCamera(deviceId: string) {
    if (!navigator.mediaDevices?.getUserMedia || !stream) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      const oldVideo = stream.getVideoTracks()[0];
      oldVideo?.stop();
      const nextStream = new MediaStream([replacement.getVideoTracks()[0], ...stream.getAudioTracks()]);
      setStream(nextStream);
      setSelectedCamera(deviceId);
    } catch {
      setCameraStatus("failed");
      setErrorMessage("We couldn’t switch to that camera. Try again or choose another camera.");
    }
  }

  async function switchMicrophone(deviceId: string) {
    if (!navigator.mediaDevices?.getUserMedia || !stream) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
      const oldAudio = stream.getAudioTracks()[0];
      oldAudio?.stop();
      const nextStream = new MediaStream([...stream.getVideoTracks(), replacement.getAudioTracks()[0]]);
      setStream(nextStream);
      setSelectedMicrophone(deviceId);
      setAttempt((value) => value + 1);
    } catch {
      setMicrophoneStatus("failed");
      setErrorMessage("We couldn’t switch to that microphone. Try again or choose another microphone.");
    }
  }

  function startAudioAnalysis(activeStream: MediaStream) {
    stopAudioAnalysis();
    const track = activeStream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") {
      setMicrophoneStatus("failed");
      return;
    }
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      setMicrophoneStatus("warning");
      return;
    }
    const context = new AudioContextConstructor();
    const source = context.createMediaStreamSource(activeStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioContextRef.current = context;
    const data = new Uint8Array(analyser.fftSize);
    micSignalRef.current = 0;
    setMicrophoneStatus("checking");
    const started = performance.now();
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 7);
      setMicLevel(level);
      if (rms > 0.035) micSignalRef.current += 16;
      if (micSignalRef.current >= 650) setMicrophoneStatus("ready");
      else if (performance.now() - started > 5000) setMicrophoneStatus((current) => current === "ready" ? current : "warning");
      audioFrameRef.current = requestAnimationFrame(loop);
    };
    audioFrameRef.current = requestAnimationFrame(loop);
  }

  async function runConnectionTest() {
    setNetwork(null);
    const samples: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const start = performance.now();
      try {
        const response = await fetch("/favicon.svg?device-check=" + Date.now() + "-" + index, { cache: "no-store" });
        if (!response.ok) throw new Error("network");
        await response.arrayBuffer();
        samples.push(Math.round(performance.now() - start));
      } catch {
        samples.push(9999);
      }
    }
    const valid = samples.filter((sample) => sample < 9999).sort((a, b) => a - b);
    if (!valid.length) {
      setNetwork({ rating: "unknown", warnings: ["We couldn’t fully check your connection."] });
      return;
    }
    const latencyMs = valid[Math.floor(valid.length / 2)];
    const rating: NetworkRating = latencyMs < 250 ? "stable" : latencyMs < 650 ? "fair" : "poor";
    const warnings = rating === "stable" ? [] : rating === "fair" ? ["Your connection should work, but video quality may occasionally decrease."] : ["Your connection may be unstable. Try moving closer to your Wi-Fi router."];
    setNetwork({ rating, latencyMs, warnings });
  }

  function continueFromCamera() {
    if (cameraStatus === "failed") return;
    stopAudioAnalysis();
    setStep("microphone");
  }

  function continueFromMicrophone() {
    if (microphoneStatus === "failed") return;
    setStep("connection");
  }

  function finishCheck() {
    const result = { camera: cameraStatus, microphone: microphoneStatus, connection: network?.rating || "unknown", completedAt: new Date().toISOString() };
    window.localStorage.setItem("securevisit:device-check:" + visitId, JSON.stringify(result));
    stopMedia();
    stopAudioAnalysis();
    window.location.href = "/visitor/visits/" + visitId;
  }

  function resetCheck() {
    stopMedia();
    stopAudioAnalysis();
    setCameraStatus("checking");
    setMicrophoneStatus("checking");
    setNetwork(null);
    setMicLevel(0);
    setErrorMessage("");
    setAttempt((value) => value + 1);
    setStep("intro");
  }

  const overallReady = cameraStatus !== "failed" && microphoneStatus !== "failed" && Boolean(network);

  return <div className="sv3-visitor-app sv4-visitor-app dc-app">
    <DeviceCheckHeader onBack={() => { stopMedia(); stopAudioAnalysis(); window.location.href = "/visitor/visits/" + visitId; }} />
    <main className="sv4-main dc-main">
      <div className="dc-page">
        <button className="dc-back" onClick={() => { stopMedia(); stopAudioAnalysis(); window.location.href = "/visitor/visits/" + visitId; }}>← <span>Back to visit</span></button>
        <section className="dc-intro"><div><p className="sv4-kicker">Visit preparation</p><h1>Let’s make sure you’re ready</h1><p>We’ll check your camera, microphone, and internet connection so you’re ready when your visit begins.</p></div><span className="dc-time-note">Usually takes less than a minute</span></section>
        <DeviceProgress step={step} />
        {step === "intro" && <IntroCard onStart={startCheck} onBack={() => { window.location.href = "/visitor/visits/" + visitId; }} />}
        {step === "permissions" && <PermissionCard />}
        {step === "permission_error" && <PermissionError onRetry={startCheck} onHelp={() => setPermissionHelp((value) => !value)} helpOpen={permissionHelp} />}
        {step === "unsupported" && <UnsupportedCard onBack={() => { window.location.href = "/visitor/visits/" + visitId; }} />}
        {step === "camera" && <CameraCard videoRef={videoRef} status={cameraStatus} devices={cameraDevices} selected={selectedCamera} onSelect={switchCamera} onContinue={continueFromCamera} onRetry={() => { setCameraStatus("checking"); setAttempt((value) => value + 1); }} errorMessage={errorMessage} />}
        {step === "microphone" && <MicrophoneCard status={microphoneStatus} level={micLevel} devices={microphoneDevices} selected={selectedMicrophone} onSelect={switchMicrophone} onContinue={continueFromMicrophone} onRetry={() => { setMicrophoneStatus("checking"); setAttempt((value) => value + 1); }} errorMessage={errorMessage} />}
        {step === "connection" && <ConnectionCard result={network} onRetry={() => setAttempt((value) => value + 1)} onContinue={() => setStep("summary")} />}
        {step === "summary" && <SummaryCard camera={cameraStatus} microphone={microphoneStatus} network={network} ready={overallReady} onBack={finishCheck} onAgain={resetCheck} />}
        <section className="dc-privacy"><span>✦</span><p><strong>Your camera and microphone are used only for this device check and your visit.</strong><br />Raw media stays in the browser. SecureVisit stores only the readiness result.</p></section>
      </div>
    </main>
  </div>;
}

function DeviceProgress({ step }: { step: DeviceStep }) {
  const activeIndex = step === "intro" || step === "permissions" || step === "permission_error" || step === "unsupported" ? -1 : progressSteps.findIndex((item) => item.key === step);
  return <div className="dc-progress" aria-label="Device check progress">{progressSteps.map((item, index) => <div className={"dc-progress-step " + (index < activeIndex ? "done" : index === activeIndex ? "active" : "")} key={item.key}><span>{index < activeIndex ? "✓" : index + 1}</span><strong>{item.label}</strong>{index < progressSteps.length - 1 && <i />}</div>)}</div>;
}

function IntroCard({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  return <section className="dc-card dc-intro-card"><div className="dc-card-art"><div className="dc-art-lens">◉</div><div className="dc-art-wave" /><div className="dc-art-spark">✦</div></div><div className="dc-card-copy"><p className="sv4-kicker">A quick readiness check</p><h2>Three things, then you’re ready.</h2><div className="dc-check-list"><CheckPreview icon="◉" title="Camera" copy="We’ll make sure your video is working." tone="orange" /><CheckPreview icon="◒" title="Microphone" copy="We’ll check that we can detect your voice." tone="blue" /><CheckPreview icon="⌁" title="Connection" copy="We’ll check whether your connection is suitable for video." tone="green" /></div><div className="dc-actions"><button className="sv4-button sv4-button-primary" onClick={onStart}>Start check <span>→</span></button><button className="dc-secondary-button" onClick={onBack}>Back to visit</button></div></div></section>;
}

function CheckPreview({ icon, title, copy, tone }: { icon: string; title: string; copy: string; tone: string }) {
  return <div className="dc-check-preview"><span className={"dc-check-icon dc-tone-" + tone}>{icon}</span><span><strong>{title}</strong><small>{copy}</small></span><b>○</b></div>;
}

function PermissionCard() {
  return <section className="dc-card dc-state-card"><div className="dc-state-icon dc-tone-orange">◉</div><p className="sv4-kicker">One moment</p><h2>Allow camera and microphone access</h2><p>Your browser may ask for permission. This lets us test your equipment before your visit.</p><div className="dc-loading-line"><i /><span>Waiting for your browser…</span></div></section>;
}

function PermissionError({ onRetry, onHelp, helpOpen }: { onRetry: () => void; onHelp: () => void; helpOpen: boolean }) {
  return <section className="dc-card dc-state-card dc-error-card"><div className="dc-state-icon dc-tone-danger">!</div><p className="sv4-kicker dc-danger-kicker">Permission needed</p><h2>Camera and microphone access is blocked</h2><p>SecureVisit needs access to test your device. Allow access in your browser settings, then try again.</p>{helpOpen && <div className="dc-help-box"><strong>How to allow access</strong><span>Choose the camera icon near your browser’s address bar, allow camera and microphone access, then return here.</span></div>}<div className="dc-actions"><button className="sv4-button sv4-button-primary" onClick={onRetry}>Try again <span>→</span></button><button className="dc-secondary-button" onClick={onHelp}>How to allow access</button></div></section>;
}

function UnsupportedCard({ onBack }: { onBack: () => void }) {
  return <section className="dc-card dc-state-card dc-error-card"><div className="dc-state-icon dc-tone-danger">!</div><p className="sv4-kicker dc-danger-kicker">Browser check</p><h2>This browser can’t run the device check</h2><p>Try SecureVisit in a modern browser over a secure connection, then return to your visit.</p><button className="sv4-button" onClick={onBack}>Back to visit</button></section>;
}

function CameraCard({ videoRef, status, devices, selected, onSelect, onContinue, onRetry, errorMessage }: { videoRef: RefObject<HTMLVideoElement | null>; status: CheckStatus; devices: MediaDeviceInfo[]; selected: string; onSelect: (id: string) => void; onContinue: () => void; onRetry: () => void; errorMessage: string }) {
  return <section className="dc-card dc-active-card"><div className="dc-card-top"><div><p className="sv4-kicker">Step 1 of 3</p><h2>Camera check</h2><p>Make sure you can see yourself clearly.</p></div><DeviceStatus status={status} label={statusLabel(status, "camera")} /></div><div className="dc-camera-preview">{status === "failed" && <div className="dc-preview-error"><span>!</span><strong>We can’t use your camera</strong><small>Close other video apps and try again.</small></div>}<video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />{status !== "failed" && <span className="dc-live-pill">● LIVE PREVIEW</span>}</div>{devices.length > 1 && <label className="dc-select-label">Camera<select value={selected} onChange={(event) => onSelect(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera " + (index + 1)}</option>)}</select></label>}{status === "ready" && <p className="dc-success-copy">Your camera is sending video normally.</p>}{status === "warning" && <p className="dc-warning-copy">Your camera is working, but the image may be dark. Try moving somewhere brighter.</p>}{errorMessage && <p className="dc-error-copy">{errorMessage}</p>}<div className="dc-card-footer">{status === "failed" ? <button className="sv4-button sv4-button-primary" onClick={onRetry}>Try again <span>↻</span></button> : <button className="sv4-button sv4-button-primary" disabled={status === "checking"} onClick={onContinue}>{status === "checking" ? "Checking…" : "Continue"} <span>→</span></button>}</div></section>;
}

function MicrophoneCard({ status, level, devices, selected, onSelect, onContinue, onRetry, errorMessage }: { status: CheckStatus; level: number; devices: MediaDeviceInfo[]; selected: string; onSelect: (id: string) => void; onContinue: () => void; onRetry: () => void; errorMessage: string }) {
  const bars = Array.from({ length: 12 });
  return <section className="dc-card dc-active-card"><div className="dc-card-top"><div><p className="sv4-kicker">Step 2 of 3</p><h2>Microphone check</h2><p>Say a few words so we can make sure your microphone is working.</p></div><DeviceStatus status={status} label={statusLabel(status, "microphone")} /></div><div className="dc-mic-stage"><div className="dc-mic-orb">◒</div><div className="dc-meter" aria-label="Live microphone level">{bars.map((_, index) => <i className={index / bars.length < level ? "active" : ""} key={index} />)}</div><strong>{status === "ready" ? "We can hear you…" : status === "warning" ? "We can’t hear anything yet" : "Say something"}</strong><small>{status === "warning" ? "Speak normally or check that your microphone isn’t muted." : "Your microphone level will respond as you speak."}</small></div>{devices.length > 1 && <label className="dc-select-label">Microphone<select value={selected} onChange={(event) => onSelect(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone " + (index + 1)}</option>)}</select></label>}{status === "warning" && <p className="dc-warning-copy">Your microphone may be very quiet. You can try again or continue with a warning.</p>}{errorMessage && <p className="dc-error-copy">{errorMessage}</p>}<div className="dc-card-footer">{status === "failed" ? <button className="sv4-button sv4-button-primary" onClick={onRetry}>Try again <span>↻</span></button> : <><button className="sv4-button sv4-button-primary" disabled={status === "checking"} onClick={onContinue}>{status === "checking" ? "Listening…" : status === "warning" ? "Continue with warning" : "Continue"} <span>→</span></button>{status === "warning" && <button className="dc-secondary-button" onClick={onRetry}>Try again</button>}</>}</div></section>;
}

function ConnectionCard({ result, onRetry, onContinue }: { result: NetworkResult | null; onRetry: () => void; onContinue: () => void }) {
  const label = result?.rating === "stable" ? "Connection is stable" : result?.rating === "fair" ? "Your connection should work" : result?.rating === "poor" ? "Your connection may be unstable" : "We couldn’t fully check your connection";
  return <section className="dc-card dc-active-card"><div className="dc-card-top"><div><p className="sv4-kicker">Step 3 of 3</p><h2>Connection check</h2><p>We’ll check whether your connection is suitable for a video visit.</p></div><DeviceStatus status={!result ? "checking" : result.rating === "stable" ? "ready" : result.rating === "unknown" ? "failed" : "warning"} label={!result ? "Checking…" : result.rating === "stable" ? "Stable" : result.rating === "unknown" ? "Try again" : "Fair"} /></div><div className="dc-connection-stage"><div className={"dc-connection-orb " + (result ? "complete" : "")}>{result?.rating === "stable" ? "✓" : result ? "!" : "⌁"}</div><strong>{label}</strong><small>{!result ? "Measuring a few quick samples…" : result.warnings[0] || "Your connection should support your visit."}</small>{result?.latencyMs && <span className="dc-latency">Connection check complete</span>}</div><div className="dc-connection-progress"><span className={result ? "done" : "active"}>✓ Connecting</span><span className={result ? "done" : "active"}>{result ? "✓ Measuring stability" : "● Measuring stability"}</span><span className={result ? "done" : ""}>{result ? "✓ Final check" : "○ Final check"}</span></div><div className="dc-card-footer">{result?.rating === "unknown" || result?.rating === "poor" ? <button className="sv4-button" onClick={onRetry}>Try again <span>↻</span></button> : null}<button className="sv4-button sv4-button-primary" disabled={!result} onClick={onContinue}>{result?.rating === "fair" ? "Continue with warning" : "Continue"} <span>→</span></button></div></section>;
}

function DeviceStatus({ status, label }: { status: CheckStatus; label: string }) {
  const tone = status === "ready" ? "green" : status === "warning" ? "orange" : status === "failed" ? "danger" : "blue";
  return <span className={"dc-status dc-status-" + tone}><i />{label}</span>;
}

function SummaryCard({ camera, microphone, network, ready, onBack, onAgain }: { camera: CheckStatus; microphone: CheckStatus; network: NetworkResult | null; ready: boolean; onBack: () => void; onAgain: () => void }) {
  return <section className="dc-card dc-summary-card"><div className="dc-summary-icon">{ready ? "✓" : "!"}</div><p className="sv4-kicker">{ready ? "Device check complete" : "One more look"}</p><h2>{ready ? "You’re ready for your visit" : "Your device needs attention"}</h2><p>{ready ? "Your device passed the readiness check." : "We found something that may affect your visit. You can run the check again."}</p><div className="dc-summary-grid"><ResultRow title="Camera" label={camera === "ready" ? "Ready" : camera === "warning" ? "Ready with note" : "Needs attention"} tone={camera === "failed" ? "danger" : camera === "warning" ? "orange" : "green"} /><ResultRow title="Microphone" label={microphone === "ready" ? "Ready" : microphone === "warning" ? "Ready with note" : "Needs attention"} tone={microphone === "failed" ? "danger" : microphone === "warning" ? "orange" : "green"} /><ResultRow title="Connection" label={network?.rating === "stable" ? "Stable" : network?.rating === "fair" ? "Fair" : network?.rating === "poor" ? "Poor" : "Unknown"} tone={network?.rating === "stable" ? "green" : network?.rating === "fair" ? "orange" : "danger"} /></div>{network?.warnings[0] && <div className="dc-summary-warning"><span>!</span><p>{network.warnings[0]}</p></div>}<div className="dc-actions"><button className="sv4-button sv4-button-primary" disabled={!ready} onClick={onBack}>Back to visit <span>→</span></button><button className="dc-secondary-button" onClick={onAgain}>Run check again</button></div></section>;
}

function ResultRow({ title, label, tone }: { title: string; label: string; tone: string }) {
  return <div className="dc-result-row"><span className={"dc-result-icon dc-tone-" + tone}>{tone === "green" ? "✓" : "!"}</span><strong>{title}</strong><small>{label}</small></div>;
}
