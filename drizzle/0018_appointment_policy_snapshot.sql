ALTER TABLE appointments ADD COLUMN policy_version INTEGER;
ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER;

-- Existing requests predate policy snapshots and cannot be proven to match the
-- policy that was active when submitted. Leave both values NULL so approval
-- fails closed; visitors can resubmit or reschedule under the current policy.
