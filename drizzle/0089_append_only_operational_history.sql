-- Operational history is evidence, not mutable application state.  The
-- organization fill triggers from migrations 0083/0084 are the one legacy
-- exception: they may populate only a previously-null organization_id.

CREATE TRIGGER `audit_events_immutable_update`
BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER `audit_events_immutable_delete`
BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER `security_events_immutable_update`
BEFORE UPDATE ON `security_events`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = OLD.`facility_id`)
  AND OLD.`id` IS NEW.`id`
  AND OLD.`user_id` IS NEW.`user_id`
  AND OLD.`facility_id` IS NEW.`facility_id`
  AND OLD.`event_type` IS NEW.`event_type`
  AND OLD.`severity` IS NEW.`severity`
  AND OLD.`request_id` IS NEW.`request_id`
  AND OLD.`ip_hash` IS NEW.`ip_hash`
  AND OLD.`user_agent_hash` IS NEW.`user_agent_hash`
  AND OLD.`metadata` IS NEW.`metadata`
  AND OLD.`created_at` IS NEW.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'security events are append-only');
END;

CREATE TRIGGER `security_events_immutable_delete`
BEFORE DELETE ON `security_events`
BEGIN
  SELECT RAISE(ABORT, 'security events are append-only');
END;

CREATE TRIGGER `appointment_status_events_immutable_update`
BEFORE UPDATE ON `appointment_status_events`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = OLD.`appointment_id`)
  AND OLD.`id` IS NEW.`id`
  AND OLD.`appointment_id` IS NEW.`appointment_id`
  AND OLD.`from_status` IS NEW.`from_status`
  AND OLD.`to_status` IS NEW.`to_status`
  AND OLD.`actor_user_id` IS NEW.`actor_user_id`
  AND OLD.`reason_code` IS NEW.`reason_code`
  AND OLD.`reason_text` IS NEW.`reason_text`
  AND OLD.`correlation_id` IS NEW.`correlation_id`
  AND OLD.`created_at` IS NEW.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'appointment status events are append-only');
END;

CREATE TRIGGER `appointment_status_events_immutable_delete`
BEFORE DELETE ON `appointment_status_events`
BEGIN
  SELECT RAISE(ABORT, 'appointment status events are append-only');
END;

CREATE TRIGGER `visit_session_events_immutable_update`
BEFORE UPDATE ON `visit_session_events`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = OLD.`session_id`)
  AND OLD.`id` IS NEW.`id`
  AND OLD.`session_id` IS NEW.`session_id`
  AND OLD.`event_type` IS NEW.`event_type`
  AND OLD.`source` IS NEW.`source`
  AND OLD.`participant_role` IS NEW.`participant_role`
  AND OLD.`metadata` IS NEW.`metadata`
  AND OLD.`correlation_id` IS NEW.`correlation_id`
  AND OLD.`created_at` IS NEW.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'visit session events are append-only');
END;

CREATE TRIGGER `visit_session_events_immutable_delete`
BEFORE DELETE ON `visit_session_events`
BEGIN
  SELECT RAISE(ABORT, 'visit session events are append-only');
END;
