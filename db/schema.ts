import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  userType: text("user_type", { enum: ["VISITOR", "STAFF", "SYSTEM"] }).notNull().default("STAFF"),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED", "DISABLED"] }).notNull().default("ACTIVE"),
  emailVerifiedAt: text("email_verified_at"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({
  externalIdIdx: uniqueIndex("users_external_id_idx").on(table.externalId),
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const facilities = sqliteTable("facilities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  currentState: text("current_state", { enum: ["NORMAL_OPERATIONS", "LIMITED_OPERATIONS", "LOCKDOWN", "EMERGENCY_CLOSURE", "TECHNICAL_DEGRADATION"] }).notNull().default("NORMAL_OPERATIONS"),
  stateReason: text("state_reason"),
  stateChangedAt: text("state_changed_at"),
  stateChangedBy: text("state_changed_by"),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const staffProfiles = sqliteTable("staff_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  employeeReference: text("employee_reference").notNull(),
  jobTitle: text("job_title").notNull(),
  department: text("department"),
  shiftStart: text("shift_start"),
  shiftEnd: text("shift_end"),
  ...timestamps,
}, (table) => ({ facilityIdx: index("staff_profiles_facility_idx").on(table.facilityId) }));

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  permissionKey: text("permission_key").notNull(),
  description: text("description").notNull().default(""),
}, (table) => ({ permissionIdx: uniqueIndex("permissions_key_idx").on(table.permissionKey) }));

export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id),
  roleId: text("role_id").notNull().references(() => roles.id),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  assignedBy: text("assigned_by"),
  assignedAt: text("assigned_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userFacilityRoleIdx: uniqueIndex("user_roles_scope_idx").on(table.userId, table.roleId, table.facilityId),
  facilityIdx: index("user_roles_facility_idx").on(table.facilityId),
}));

export const rolePermissions = sqliteTable("role_permissions", {
  roleId: text("role_id").notNull().references(() => roles.id),
  permissionId: text("permission_id").notNull().references(() => permissions.id),
}, (table) => ({ rolePermissionIdx: uniqueIndex("role_permissions_pair_idx").on(table.roleId, table.permissionId) }));

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastSeenAt: text("last_seen_at"),
  userAgentHash: text("user_agent_hash"),
  ipHash: text("ip_hash"),
}, (table) => ({ tokenIdx: uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash), userIdx: index("auth_sessions_user_idx").on(table.userId) }));

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["EMAIL", "SMS"] }).notNull(),
  destination: text("destination").notNull(),
  destinationHash: text("destination_hash").notNull(),
  destinationMasked: text("destination_masked").notNull(),
  codeHash: text("code_hash").notNull(),
  purpose: text("purpose", { enum: ["VISITOR_SIGN_IN", "CONTACT_VERIFICATION"] }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ destinationIdx: index("auth_challenges_destination_idx").on(table.destinationHash, table.createdAt), expiresIdx: index("auth_challenges_expires_idx").on(table.expiresAt) }));

export const securityEvents = sqliteTable("security_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  facilityId: text("facility_id"),
  eventType: text("event_type").notNull(),
  severity: text("severity", { enum: ["INFO", "WARNING", "CRITICAL"] }).notNull().default("INFO"),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ userIdx: index("security_events_user_idx").on(table.userId), facilityIdx: index("security_events_facility_idx").on(table.facilityId) }));

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  actorRole: text("actor_role"),
  facilityId: text("facility_id"),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  reason: text("reason"),
  oldValues: text("old_values", { mode: "json" }).$type<Record<string, unknown> | null>(),
  newValues: text("new_values", { mode: "json" }).$type<Record<string, unknown> | null>(),
  correlationId: text("correlation_id").notNull(),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ facilityIdx: index("audit_events_facility_idx").on(table.facilityId), createdIdx: index("audit_events_created_idx").on(table.createdAt) }));

export const outboxEvents = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id"),
  facilityId: text("facility_id"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  correlationId: text("correlation_id").notNull(),
  status: text("status", { enum: ["PENDING", "PROCESSING", "PROCESSED", "FAILED", "DEAD_LETTER"] }).notNull().default("PENDING"),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: text("available_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ statusIdx: index("outbox_events_status_idx").on(table.status, table.availableAt), correlationIdx: index("outbox_events_correlation_idx").on(table.correlationId) }));

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  visitorUserId: text("visitor_user_id").notNull().references(() => users.id),
  prisonerId: text("prisoner_id").notNull(),
  status: text("status", { enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED_BY_FACILITY", "WAITING", "IN_PROGRESS", "COMPLETED", "TECHNICAL_FAILURE"] }).notNull().default("DRAFT"),
  requestedStart: text("requested_start").notNull(),
  requestedEnd: text("requested_end").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  appointmentType: text("appointment_type").notNull().default("FAMILY"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ facilityStatusIdx: index("appointments_facility_status_idx").on(table.facilityId, table.status), visitorIdx: index("appointments_visitor_idx").on(table.visitorUserId) }));

export const prisoners = sqliteTable("prisoners", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  prisonerNumber: text("prisoner_number").notNull(),
  displayName: text("display_name").notNull(),
  housingUnit: text("housing_unit"),
  status: text("status", { enum: ["ACTIVE", "TRANSFERRED", "RELEASED", "INACTIVE"] }).notNull().default("ACTIVE"),
  visitationStatus: text("visitation_status", { enum: ["APPROVED", "RESTRICTED", "SUSPENDED"] }).notNull().default("APPROVED"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({
  facilityNumberIdx: uniqueIndex("prisoners_facility_number_idx").on(table.facilityId, table.prisonerNumber),
  facilityStatusIdx: index("prisoners_facility_status_idx").on(table.facilityId, table.status, table.visitationStatus),
}));

export const visitorProfiles = sqliteTable("visitor_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  legalName: text("legal_name").notNull(),
  preferredName: text("preferred_name"),
  phone: text("phone"),
  phoneVerifiedAt: text("phone_verified_at"),
  profileStatus: text("profile_status", { enum: ["INCOMPLETE", "ACTIVE", "SUSPENDED"] }).notNull().default("INCOMPLETE"),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const visitorRelationships = sqliteTable("visitor_relationships", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  visitorUserId: text("visitor_user_id").notNull().references(() => users.id),
  prisonerId: text("prisoner_id").notNull().references(() => prisoners.id),
  relationshipType: text("relationship_type").notNull(),
  status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] }).notNull().default("PENDING"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: text("reviewed_at"),
  reviewReason: text("review_reason"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({
  visitorPrisonerIdx: uniqueIndex("visitor_relationships_pair_idx").on(table.visitorUserId, table.prisonerId),
  facilityStatusIdx: index("visitor_relationships_facility_status_idx").on(table.facilityId, table.status),
}));

export const verificationCases = sqliteTable("verification_cases", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  relationshipId: text("relationship_id").notNull().references(() => visitorRelationships.id),
  status: text("status", { enum: ["PENDING", "IN_REVIEW", "APPROVED", "REJECTED", "MORE_INFO"] }).notNull().default("PENDING"),
  evidenceRequired: integer("evidence_required", { mode: "boolean" }).notNull().default(true),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: text("reviewed_at"),
  reviewReason: text("review_reason"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({
  relationshipIdx: uniqueIndex("verification_cases_relationship_idx").on(table.relationshipId),
  facilityStatusIdx: index("verification_cases_facility_status_idx").on(table.facilityId, table.status),
}));

export const appointmentStatusEvents = sqliteTable("appointment_status_events", {
  id: text("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: text("actor_user_id"),
  reasonCode: text("reason_code"),
  reasonText: text("reason_text"),
  correlationId: text("correlation_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ appointmentIdx: index("appointment_status_events_appointment_idx").on(table.appointmentId, table.createdAt) }));

export const resourceReservations = sqliteTable("resource_reservations", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  resourceType: text("resource_type", { enum: ["ROOM", "DEVICE", "MONITORING_CAPACITY"] }).notNull(),
  resourceId: text("resource_id").notNull(),
  status: text("status", { enum: ["HELD", "RESERVED", "ACTIVE", "RELEASED", "EXPIRED", "CANCELLED"] }).notNull().default("HELD"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ resourceIdx: index("resource_reservations_resource_idx").on(table.resourceType, table.resourceId, table.startsAt), appointmentIdx: index("resource_reservations_appointment_idx").on(table.appointmentId) }));

export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  resourceType: text("resource_type", { enum: ["ROOM", "DEVICE"] }).notNull(),
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["AVAILABLE", "ONLINE", "RESERVED", "IN_USE", "OFFLINE", "MAINTENANCE"] }).notNull().default("AVAILABLE"),
  roomId: text("room_id"),
  healthState: text("health_state", { enum: ["HEALTHY", "WARNING", "FAILED", "UNKNOWN"] }).notNull().default("UNKNOWN"),
  lastHeartbeatAt: text("last_heartbeat_at"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ facilityTypeIdx: index("resources_facility_type_idx").on(table.facilityId, table.resourceType, table.status), facilityNameIdx: uniqueIndex("resources_facility_name_idx").on(table.facilityId, table.displayName) }));

export const waitingRoomSessions = sqliteTable("waiting_room_sessions", {
  appointmentId: text("appointment_id").primaryKey().references(() => appointments.id),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  state: text("state").notNull().default("NOT_ARRIVED"),
  visitorPresence: text("visitor_presence").notNull().default("absent"),
  prisonerPresence: text("prisoner_presence").notNull().default("waiting"),
  identityState: text("identity_state").notNull().default("pending"),
  cameraState: text("camera_state").notNull().default("pending"),
  microphoneState: text("microphone_state").notNull().default("pending"),
  networkState: text("network_state").notNull().default("pending"),
  roomState: text("room_state").notNull().default("pass"),
  kioskState: text("kiosk_state").notNull().default("pending"),
  restrictionState: text("restriction_state").notNull().default("pass"),
  assignedRoomId: text("assigned_room_id"),
  assignedKioskId: text("assigned_kiosk_id"),
  staffNotes: text("staff_notes"),
  version: integer("version").notNull().default(1),
  lastCheckedAt: text("last_checked_at"),
  ...timestamps,
}, (table) => ({ facilityStateIdx: index("waiting_room_sessions_facility_state_idx").on(table.facilityId, table.state), facilityAppointmentIdx: index("waiting_room_sessions_facility_appointment_idx").on(table.facilityId, table.appointmentId) }));

export const visitSessions = sqliteTable("visit_sessions", {
  id: text("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  provider: text("provider").notNull().default("livekit"),
  providerRoomName: text("provider_room_name").notNull(),
  providerRoomSid: text("provider_room_sid"),
  status: text("status", { enum: ["PREPARING", "CONNECTING", "ACTIVE", "RECONNECTING", "ENDING", "ENDED", "FAILED", "TERMINATED", "CANCELLED"] }).notNull().default("PREPARING"),
  authorizedStartAt: text("authorized_start_at").notNull(),
  authorizedEndAt: text("authorized_end_at").notNull(),
  actualStartedAt: text("actual_started_at"),
  actualEndedAt: text("actual_ended_at"),
  createdBy: text("created_by"),
  recordingPolicy: text("recording_policy").notNull().default("OFF"),
  recordingStatus: text("recording_status").notNull().default("NOT_RECORDED"),
  terminationReason: text("termination_reason"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ appointmentIdx: uniqueIndex("visit_sessions_appointment_idx").on(table.appointmentId), facilityStatusIdx: index("visit_sessions_facility_status_idx").on(table.facilityId, table.status) }));

export const visitSessionEvents = sqliteTable("visit_session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => visitSessions.id),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  participantRole: text("participant_role"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  correlationId: text("correlation_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ sessionIdx: index("visit_session_events_session_idx").on(table.sessionId, table.createdAt) }));

export const creditAccounts = sqliteTable("credit_accounts", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  userId: text("user_id").notNull().references(() => users.id),
  availableCredits: integer("available_credits").notNull().default(0),
  reservedCredits: integer("reserved_credits").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ userFacilityIdx: uniqueIndex("credit_accounts_user_facility_idx").on(table.userId, table.facilityId) }));

export const creditLedgerEntries = sqliteTable("credit_ledger_entries", {
  id: text("id").primaryKey(),
  creditAccountId: text("credit_account_id").notNull().references(() => creditAccounts.id),
  appointmentId: text("appointment_id"),
  entryType: text("entry_type", { enum: ["PURCHASE", "RESERVATION", "RESERVATION_RELEASE", "CONSUMPTION", "REFUND", "MANUAL_ADJUSTMENT"] }).notNull(),
  amount: integer("amount").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ idempotencyIdx: uniqueIndex("credit_ledger_idempotency_idx").on(table.idempotencyKey), accountIdx: index("credit_ledger_account_idx").on(table.creditAccountId, table.createdAt) }));

export const paymentIntents = sqliteTable("payment_intents", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  userId: text("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  creditQuantity: integer("credit_quantity").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("IDR"),
  status: text("status", { enum: ["PENDING", "CHECKOUT_CREATED", "SUCCEEDED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED"] }).notNull().default("PENDING"),
  providerReference: text("provider_reference"),
  checkoutUrl: text("checkout_url"),
  idempotencyKey: text("idempotency_key").notNull(),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ idempotencyIdx: uniqueIndex("payment_intents_idempotency_idx").on(table.idempotencyKey), userStatusIdx: index("payment_intents_user_status_idx").on(table.userId, table.status), facilityStatusIdx: index("payment_intents_facility_status_idx").on(table.facilityId, table.status) }));

export const paymentProviderEvents = sqliteTable("payment_provider_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] }).notNull().default("RECEIVED"),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ eventKeyIdx: uniqueIndex("payment_provider_events_key_idx").on(table.provider, table.eventKey), createdIdx: index("payment_provider_events_created_idx").on(table.createdAt) }));

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").references(() => facilities.id),
  userId: text("user_id").notNull().references(() => users.id),
  channel: text("channel", { enum: ["IN_APP", "EMAIL", "SMS"] }).notNull().default("IN_APP"),
  template: text("template").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["QUEUED", "DELIVERED", "FAILED", "READ"] }).notNull().default("QUEUED"),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: text("available_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deliveredAt: text("delivered_at"),
  readAt: text("read_at"),
  lastError: text("last_error"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ idempotencyIdx: uniqueIndex("notifications_idempotency_idx").on(table.idempotencyKey), userStatusIdx: index("notifications_user_status_idx").on(table.userId, table.status, table.createdAt), facilityIdx: index("notifications_facility_idx").on(table.facilityId, table.createdAt) }));

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull().references(() => facilities.id),
  incidentType: text("incident_type").notNull(),
  severity: text("severity", { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }).notNull(),
  status: text("status", { enum: ["OPEN", "ACKNOWLEDGED", "IN_REVIEW", "RESOLVED", "CLOSED"] }).notNull().default("OPEN"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  appointmentId: text("appointment_id"),
  sessionId: text("session_id"),
  resourceId: text("resource_id"),
  reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
  assignedUserId: text("assigned_user_id").references(() => users.id),
  resolution: text("resolution"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => ({ facilityStatusIdx: index("incidents_facility_status_idx").on(table.facilityId, table.status, table.createdAt), appointmentIdx: index("incidents_appointment_idx").on(table.appointmentId), severityIdx: index("incidents_severity_idx").on(table.facilityId, table.severity) }));

export const incidentEvents = sqliteTable("incident_events", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id),
  eventType: text("event_type").notNull(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id),
  details: text("details").notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ incidentIdx: index("incident_events_incident_idx").on(table.incidentId, table.createdAt) }));
