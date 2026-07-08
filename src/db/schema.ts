import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  date,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────
export const userStatusEnum       = pgEnum('user_status',         ['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export const orgMemberRoleEnum    = pgEnum('org_member_role',     ['OWNER', 'ADMIN']);
export const projectStatusEnum    = pgEnum('project_status',      ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
export const projectMemberRole    = pgEnum('project_member_role', ['PROJECT_ADMIN', 'CONTRIBUTOR', 'REVIEWER']);
export const proficiencyEnum      = pgEnum('proficiency_level',   ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'NATIVE']);
export const taskTypeEnum         = pgEnum('task_type',           ['READ_PROMPT', 'SPONTANEOUS_SPEECH', 'GUIDED_CONVERSATION']);
export const taskStatusEnum       = pgEnum('task_status',         ['ACTIVE', 'INACTIVE', 'CLOSED']);
export const submissionStatusEnum = pgEnum('submission_status',   ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION']);
export const reviewRatingEnum     = pgEnum('review_rating',       ['EXCELLENT', 'GOOD', 'FAIR', 'POOR']);
export const reviewStatusEnum     = pgEnum('review_status',       ['APPROVED', 'REJECTED']);
export const invitationStatusEnum = pgEnum('invitation_status',   ['PENDING', 'ACCEPTED', 'EXPIRED']);
export const exportFormatEnum     = pgEnum('export_format',       ['CSV', 'JSON', 'ZIP']);
export const exportStatusEnum     = pgEnum('export_status',       ['PROCESSING', 'READY', 'FAILED']);

// ─────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  firstName:            varchar('first_name',  { length: 100 }).notNull(),
  lastName:             varchar('last_name',   { length: 100 }).notNull(),
  email:                varchar('email',       { length: 255 }).unique().notNull(),
  passwordHash:         text('password_hash').notNull(),
  profilePicture:       text('profile_picture'),
  status:               userStatusEnum('status').default('ACTIVE').notNull(),
  emailVerified:        boolean('email_verified').default(false).notNull(),
  verifyToken:          text('verify_token'),
  verifyTokenExpiresAt: timestamp('verify_token_expires_at'),
  resetToken:           text('reset_token'),
  resetTokenExpiresAt:  timestamp('reset_token_expires_at'),
  country:              varchar('country',   { length: 100 }),
  gender:               varchar('gender',    { length: 20  }),
  ageRange:             varchar('age_range', { length: 20  }),
  createdAt:            timestamp('created_at').defaultNow().notNull(),
  updatedAt:            timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// ORGANIZATIONS
// ─────────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id:               uuid('id').primaryKey().defaultRandom(),
  name:             varchar('name',              { length: 255 }).notNull(),
  description:      text('description'),
  country:          varchar('country',           { length: 100 }),
  organizationType: varchar('organization_type', { length: 100 }),
  ownerId:          uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// ORGANIZATION MEMBERS
// ─────────────────────────────────────────────────────────────
export const organizationMembers = pgTable(
  'organization_members',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role:           orgMemberRoleEnum('role').default('ADMIN').notNull(),
    joinedAt:       timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqOrgMember:     uniqueIndex('uq_org_member').on(t.organizationId, t.userId),
    idxOrgMembersOrg:  index('idx_org_members_org').on(t.organizationId),
    idxOrgMembersUser: index('idx_org_members_user').on(t.userId),
  })
);

// ─────────────────────────────────────────────────────────────
// LANGUAGES
// ─────────────────────────────────────────────────────────────
export const languages = pgTable('languages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 100 }).unique().notNull(),
  code:      varchar('code', { length: 10  }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────
// USER LANGUAGES
// ─────────────────────────────────────────────────────────────
export const userLanguages = pgTable(
  'user_languages',
  {
    id:               uuid('id').primaryKey().defaultRandom(),
    userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    languageId:       uuid('language_id').notNull().references(() => languages.id, { onDelete: 'cascade' }),
    proficiencyLevel: proficiencyEnum('proficiency_level').default('INTERMEDIATE').notNull(),
    createdAt:        timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqUserLang:    uniqueIndex('uq_user_language').on(t.userId, t.languageId),
    idxUserLangUser: index('idx_user_languages_user').on(t.userId),
  })
);

// ─────────────────────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────────────────────
export const projects = pgTable(
  'projects',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name:           varchar('name', { length: 255 }).notNull(),
    description:    text('description'),
    status:         projectStatusEnum('status').default('ACTIVE').notNull(),
    startDate:      date('start_date'),
    endDate:        date('end_date'),
    createdBy:      uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt:      timestamp('created_at').defaultNow().notNull(),
    updatedAt:      timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    idxProjectsOrg:    index('idx_projects_org').on(t.organizationId),
    idxProjectsStatus: index('idx_projects_status').on(t.status),
  })
);

// ─────────────────────────────────────────────────────────────
// PROJECT LANGUAGES
// ─────────────────────────────────────────────────────────────
export const projectLanguages = pgTable(
  'project_languages',
  {
    projectId:  uuid('project_id').notNull().references(() => projects.id,  { onDelete: 'cascade' }),
    languageId: uuid('language_id').notNull().references(() => languages.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    uniqProjectLang: uniqueIndex('uq_project_language').on(t.projectId, t.languageId),
  })
);

// ─────────────────────────────────────────────────────────────
// PROJECT MEMBERS
// ─────────────────────────────────────────────────────────────
export const projectMembers = pgTable(
  'project_members',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId:    uuid('user_id').notNull().references(() => users.id,        { onDelete: 'cascade' }),
    role:      projectMemberRole('role').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt:  timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqProjectMember:     uniqueIndex('uq_project_member').on(t.projectId, t.userId),
    idxProjectMembersProj: index('idx_project_members_project').on(t.projectId),
    idxProjectMembersUser: index('idx_project_members_user').on(t.userId),
    idxProjectMembersRole: index('idx_project_members_role').on(t.role),
  })
);

// ─────────────────────────────────────────────────────────────
// INVITATIONS
// ─────────────────────────────────────────────────────────────
export const invitations = pgTable(
  'invitations',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    email:      varchar('email', { length: 255 }).notNull(),
    projectId:  uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    role:       projectMemberRole('role').notNull(),
    token:      text('token').unique().notNull(),
    status:     invitationStatusEnum('status').default('PENDING').notNull(),
    invitedBy:  uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt:  timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    createdAt:  timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    idxInvitationsToken:   index('idx_invitations_token').on(t.token),
    idxInvitationsEmail:   index('idx_invitations_email').on(t.email),
    idxInvitationsProject: index('idx_invitations_project').on(t.projectId),
  })
);

// ─────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────
export const tasks = pgTable(
  'tasks',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    projectId:      uuid('project_id').notNull().references(() => projects.id,  { onDelete: 'cascade'  }),
    title:          varchar('title', { length: 255 }).notNull(),
    description:    text('description'),
    instructions:   text('instructions'),
    languageId:     uuid('language_id').notNull().references(() => languages.id, { onDelete: 'restrict' }),
    taskType:       taskTypeEnum('task_type').notNull(),
    targetDuration: integer('target_duration'),
    status:         taskStatusEnum('status').default('ACTIVE').notNull(),
    createdBy:      uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt:      timestamp('created_at').defaultNow().notNull(),
    updatedAt:      timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    idxTasksProject:  index('idx_tasks_project').on(t.projectId),
    idxTasksLanguage: index('idx_tasks_language').on(t.languageId),
    idxTasksStatus:   index('idx_tasks_status').on(t.status),
  })
);

// ─────────────────────────────────────────────────────────────
// SUBMISSIONS
// ─────────────────────────────────────────────────────────────
export const submissions = pgTable(
  'submissions',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    taskId:        uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    contributorId: uuid('contributor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    audioUrl:      text('audio_url').notNull(),
    storagePath:   text('storage_path').notNull(),
    fileSize:      bigint('file_size', { mode: 'number' }),
    audioDuration: integer('audio_duration'),
    languageId:    uuid('language_id').notNull().references(() => languages.id, { onDelete: 'restrict' }),
    status:        submissionStatusEnum('status').default('PENDING_REVIEW').notNull(),
    parentId:      uuid('parent_id'),
    submittedAt:   timestamp('submitted_at').defaultNow().notNull(),
    updatedAt:     timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    idxSubmissionsTask:        index('idx_submissions_task').on(t.taskId),
    idxSubmissionsContributor: index('idx_submissions_contributor').on(t.contributorId),
    idxSubmissionsStatus:      index('idx_submissions_status').on(t.status),
  })
);

// ─────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────
export const reviews = pgTable(
  'reviews',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
    reviewerId:   uuid('reviewer_id').notNull().references(() => users.id,         { onDelete: 'cascade' }),
    rating:       reviewRatingEnum('rating').notNull(),
    feedback:     text('feedback'),
    reviewStatus: reviewStatusEnum('review_status').notNull(),
    reviewedAt:   timestamp('reviewed_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqReview:          uniqueIndex('uq_review').on(t.submissionId, t.reviewerId),
    idxReviewsSubmission: index('idx_reviews_submission').on(t.submissionId),
    idxReviewsReviewer:  index('idx_reviews_reviewer').on(t.reviewerId),
  })
);

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title:     varchar('title',   { length: 255 }).notNull(),
    message:   text('message').notNull(),
    type:      varchar('type',    { length: 50  }),
    refId:     uuid('ref_id'),
    isRead:    boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    idxNotificationsUser:   index('idx_notifications_user').on(t.userId),
    idxNotificationsUnread: index('idx_notifications_unread').on(t.userId, t.isRead),
  })
);

// ─────────────────────────────────────────────────────────────
// DATASET EXPORTS
// ─────────────────────────────────────────────────────────────
export const datasetExports = pgTable(
  'dataset_exports',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    projectId:   uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    generatedBy: uuid('generated_by').notNull().references(() => users.id,  { onDelete: 'cascade' }),
    exportType:  exportFormatEnum('export_type').notNull(),
    storagePath: text('storage_path'),
    filters:     jsonb('filters'),
    status:      exportStatusEnum('status').default('PROCESSING').notNull(),
    createdAt:   timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    idxExportsProject: index('idx_exports_project').on(t.projectId),
  })
);

// ─────────────────────────────────────────────────────────────
// AUDIT LOGS
// ─────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    userId:    uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    entityId:  uuid('entity_id'),
    metadata:  jsonb('metadata'),
    ipAddress: varchar('ip_address', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    idxAuditUser:    index('idx_audit_logs_user').on(t.userId),
    idxAuditCreated: index('idx_audit_logs_created').on(t.createdAt),
  })
);

// ─────────────────────────────────────────────────────────────
// RELATIONS
// ─────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  organizations:           many(organizations),
  organizationMemberships: many(organizationMembers),
  projectMemberships:      many(projectMembers),
  userLanguages:           many(userLanguages),
  submissions:             many(submissions),
  reviews:                 many(reviews),
  notifications:           many(notifications),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner:    one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members:  many(organizationMembers),
  projects: many(projects),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, { fields: [organizationMembers.organizationId], references: [organizations.id] }),
  user:         one(users,         { fields: [organizationMembers.userId],         references: [users.id] }),
}));

export const languagesRelations = relations(languages, ({ many }) => ({
  userLanguages:    many(userLanguages),
  projectLanguages: many(projectLanguages),
  tasks:            many(tasks),
}));

export const userLanguagesRelations = relations(userLanguages, ({ one }) => ({
  user:     one(users,     { fields: [userLanguages.userId],     references: [users.id] }),
  language: one(languages, { fields: [userLanguages.languageId], references: [languages.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization:  one(organizations, { fields: [projects.organizationId], references: [organizations.id] }),
  createdByUser: one(users,         { fields: [projects.createdBy],      references: [users.id] }),
  members:       many(projectMembers),
  languages:     many(projectLanguages),
  tasks:         many(tasks),
  invitations:   many(invitations),
  exports:       many(datasetExports),
}));

export const projectLanguagesRelations = relations(projectLanguages, ({ one }) => ({
  project:  one(projects,  { fields: [projectLanguages.projectId],  references: [projects.id] }),
  language: one(languages, { fields: [projectLanguages.languageId], references: [languages.id] }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project:       one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user:          one(users,    { fields: [projectMembers.userId],    references: [users.id] }),
  invitedByUser: one(users,    { fields: [projectMembers.invitedBy], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  project:       one(projects, { fields: [invitations.projectId], references: [projects.id] }),
  invitedByUser: one(users,    { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project:     one(projects,  { fields: [tasks.projectId],  references: [projects.id] }),
  language:    one(languages, { fields: [tasks.languageId], references: [languages.id] }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  task:        one(tasks,        { fields: [submissions.taskId],        references: [tasks.id] }),
  contributor: one(users,        { fields: [submissions.contributorId], references: [users.id] }),
  language:    one(languages,    { fields: [submissions.languageId],    references: [languages.id] }),
  reviews:     many(reviews),
  parent:      one(submissions,  { fields: [submissions.parentId],      references: [submissions.id], relationName: 'resubmission' }),
  children:    many(submissions, { relationName: 'resubmission' }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  submission: one(submissions, { fields: [reviews.submissionId], references: [submissions.id] }),
  reviewer:   one(users,       { fields: [reviews.reviewerId],   references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const datasetExportsRelations = relations(datasetExports, ({ one }) => ({
  project:     one(projects, { fields: [datasetExports.projectId],   references: [projects.id] }),
  generatedBy: one(users,    { fields: [datasetExports.generatedBy], references: [users.id] }),
}));

// ─────────────────────────────────────────────────────────────
// INFERRED TYPES — use these in route handlers instead of writing interfaces
// ─────────────────────────────────────────────────────────────
export type User          = typeof users.$inferSelect;
export type NewUser       = typeof users.$inferInsert;
export type Organization  = typeof organizations.$inferSelect;
export type Project       = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Task          = typeof tasks.$inferSelect;
export type Submission    = typeof submissions.$inferSelect;
export type Review        = typeof reviews.$inferSelect;
export type Language      = typeof languages.$inferSelect;
export type Invitation    = typeof invitations.$inferSelect;
export type Notification  = typeof notifications.$inferSelect;
export type DatasetExport = typeof datasetExports.$inferSelect;
