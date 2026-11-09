CREATE TRIGGER `evidence_scan_events_immutable_update`
BEFORE UPDATE ON `evidence_scan_events`
BEGIN
  SELECT RAISE(ABORT, 'evidence scan events are append-only');
END;

CREATE TRIGGER `evidence_scan_events_immutable_delete`
BEFORE DELETE ON `evidence_scan_events`
BEGIN
  SELECT RAISE(ABORT, 'evidence scan events are append-only');
END;
