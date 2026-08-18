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
  staffNotes: text("staff_notes"),
  version: integer("version").notNull().default(1),
  lastCheckedAt: text("last_checked_at"),
  ...timestamps,
}, (table) => ({ facilityStateIdx: index("waiting_room_sessions_facility_state_idx").on(table.facilityId, table.state), facilityAppointmentIdx: index("waiting_room_sessions_facility_appointment_idx").on(table.facilityId, table.appointmentId) }));

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
