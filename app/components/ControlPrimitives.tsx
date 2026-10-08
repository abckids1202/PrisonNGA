import type { ReactNode } from "react";

export function Avatar({ initials, tone = "blue" }: { initials: string; tone?: string }) {
  return <span className={`sv3-avatar sv3-avatar-${tone}`}>{initials}</span>;
}

export function Status({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`sv3-status sv3-status-${tone || String(children).toLowerCase().replaceAll(" ", "-")}`}><i />{children}</span>;
}

export function Button({ children, variant = "secondary", onClick, disabled = false, type = "button" }: { children: ReactNode; variant?: "primary" | "secondary" | "quiet" | "danger"; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" | "reset" }) {
  return <button type={type} className={`sv3-button sv3-button-${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Metric({ label, value, detail, tone = "default", onClick }: { label: string; value: string; detail: string; tone?: string; onClick?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{detail}</small></>;
  return onClick ? <button type="button" className={`sv3-metric sv3-metric-${tone} sv3-metric-interactive`} onClick={onClick}>{content}</button> : <div className={`sv3-metric sv3-metric-${tone}`}>{content}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="sv3-section-label">{children}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: ReactNode; actions?: ReactNode }) {
  return <header className="sv3-page-header"><div><span className="sv3-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="sv3-header-actions">{actions}</div> : null}</header>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: string }) {
  return <div className="sv3-empty"><span>◌</span><strong>{title}</strong><p>{body}</p>{action ? <Button variant="secondary">{action}</Button> : null}</div>;
}

export function SecureVisitLogo({ markOnly = false }: { markOnly?: boolean }) {
  return <div className={`sv6-logo-lockup ${markOnly ? "sv6-logo-mark-only" : ""}`} aria-label="SecureVisit Control">
    <svg className="sv6-logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 10v20M32 10v20M8 20h7M25 20h7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4" /><path d="M15 20c2.2-5.4 7.8-5.4 10 0" fill="none" stroke="#F26B38" strokeLinecap="round" strokeWidth="4" /><circle cx="8" cy="20" r="2.3" fill="#F26B38" /><circle cx="32" cy="20" r="2.3" fill="#F26B38" /></svg>
    {!markOnly ? <span><strong>SecureVisit</strong><small>CONTROL</small></span> : null}
  </div>;
}
