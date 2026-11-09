// Recording policy is persisted as part of the facility's versioned visit
// policy. Keep a dedicated API boundary for recording-specific integrations
// while reusing the audited, optimistic-concurrency implementation rather
// than creating a second policy mutation path.
export { GET, PUT } from "../visit-policy/route";
