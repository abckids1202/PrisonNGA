"use client";

import { useState } from "react";
import { Status } from "../../components/ControlPrimitives";
import type { Appointment } from "./model";

type CommandPaletteProps = {
  appointments: Appointment[];
  onClose: () => void;
  onOpenAppointment: (appointment: Appointment) => void;
  onNavigate: (page: string) => void;
};

export default function CommandPalette({ appointments, onClose, onOpenAppointment, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.toLowerCase();
  const results = appointments
    .filter((appointment) => `${appointment.id} ${appointment.visitor} ${appointment.prisoner}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 4);

  return <div className="sv3-modal-backdrop sv3-command-palette-backdrop" onClick={onClose}>
    <section className="sv3-command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" onClick={(event) => event.stopPropagation()}>
      <div className="sv3-palette-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, appointments, resources…" /></div>
      <div className="sv3-palette-group"><span className="sv3-eyebrow" id="palette-title">Appointments</span>{results.map((appointment) => <button type="button" key={appointment.id} onClick={() => { onClose(); onOpenAppointment(appointment); }}><span><strong>{appointment.id}</strong><small>{appointment.visitor} ↔ {appointment.prisoner}</small></span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status}</Status></button>)}</div>
      <div className="sv3-palette-group"><span className="sv3-eyebrow">Actions</span><button type="button" onClick={() => { onClose(); onNavigate("Resources"); }}>Open resource workspace</button><button type="button" onClick={() => { onClose(); onNavigate("Waiting Room"); }}>Open Waiting Room</button><button type="button" onClick={() => { onClose(); onNavigate("Resources"); }}>Go to Resources</button></div>
      <div className="sv3-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
    </section>
  </div>;
}
