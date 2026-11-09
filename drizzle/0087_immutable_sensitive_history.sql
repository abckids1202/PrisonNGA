-- Financial, incident, and recording-access history is append-only. Corrections
-- must be represented as a new compensating event, never by rewriting evidence.
CREATE TRIGGER `credit_ledger_entries_immutable_update`
BEFORE UPDATE ON `credit_ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'credit ledger entries are append-only');
END;

CREATE TRIGGER `credit_ledger_entries_immutable_delete`
BEFORE DELETE ON `credit_ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'credit ledger entries are append-only');
END;

CREATE TRIGGER `incident_events_immutable_update`
BEFORE UPDATE ON `incident_events`
BEGIN
  SELECT RAISE(ABORT, 'incident events are append-only');
END;

CREATE TRIGGER `incident_events_immutable_delete`
BEFORE DELETE ON `incident_events`
BEGIN
  SELECT RAISE(ABORT, 'incident events are append-only');
END;

CREATE TRIGGER `recording_access_events_immutable_update`
BEFORE UPDATE ON `recording_access_events`
BEGIN
  SELECT RAISE(ABORT, 'recording access events are append-only');
END;

CREATE TRIGGER `recording_access_events_immutable_delete`
BEFORE DELETE ON `recording_access_events`
BEGIN
  SELECT RAISE(ABORT, 'recording access events are append-only');
END;
