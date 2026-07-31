import {
    bigint,
    boolean,
    char,
    datetime,
    int,
    json,
    mysqlEnum,
    mysqlTable,
    text,
    uniqueIndex,
    varchar
} from 'drizzle-orm/mysql-core'

const timestamps = {
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull()
}

export const users = mysqlTable('users', {
    id: char('id', { length: 36 }).primaryKey(),
    username: varchar('username', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: mysqlEnum('role', ['ADMIN', 'EDITOR', 'AUDITOR']).notNull(),
    status: mysqlEnum('status', ['ACTIVE', 'DISABLED']).notNull().default('ACTIVE'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLoginCount: int('failed_login_count').notNull().default(0),
    lockedUntil: datetime('locked_until', { mode: 'date', fsp: 3 }),
    lastLoginAt: datetime('last_login_at', { mode: 'date', fsp: 3 }),
    ...timestamps
}, table => [uniqueIndex('users_username_uq').on(table.username)])

export const sessions = mysqlTable('sessions', {
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    csrfToken: char('csrf_token', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 3 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull()
})

export const projects = mysqlTable('projects', {
    id: char('id', { length: 36 }).primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description').notNull(),
    rss: varchar('rss', { length: 2048 }).notNull(),
    discord: json('discord'),
    draftRevision: bigint('draft_revision', { mode: 'number', unsigned: true }).notNull().default(0),
    activeReleaseId: char('active_release_id', { length: 36 }),
    disabled: boolean('disabled').notNull().default(false),
    createdBy: char('created_by', { length: 36 }).notNull(),
    ...timestamps
}, table => [uniqueIndex('projects_slug_uq').on(table.slug)])

export const servers = mysqlTable('servers', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    serverKey: varchar('server_key', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description').notNull(),
    minecraftVersion: varchar('minecraft_version', { length: 32 }).notNull(),
    serverVersion: varchar('server_version', { length: 64 }).notNull(),
    address: varchar('address', { length: 255 }).notNull(),
    discord: json('discord'),
    iconUploadId: char('icon_upload_id', { length: 36 }),
    forgeVersion: varchar('forge_version', { length: 64 }),
    fabricVersion: varchar('fabric_version', { length: 64 }),
    mainServer: boolean('main_server').notNull().default(false),
    autoconnect: boolean('autoconnect').notNull().default(false),
    sortOrder: int('sort_order').notNull().default(0),
    javaOptions: json('java_options'),
    revision: bigint('revision', { mode: 'number', unsigned: true }).notNull().default(0),
    publishedOnce: boolean('published_once').notNull().default(false),
    ...timestamps
}, table => [uniqueIndex('servers_project_key_uq').on(table.projectId, table.serverKey)])

export const uploads = mysqlTable('uploads', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    objectKey: varchar('object_key', { length: 1024 }).notNull(),
    originalName: varchar('original_name', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    size: bigint('size', { mode: 'number', unsigned: true }).notNull(),
    md5: char('md5', { length: 32 }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    status: mysqlEnum('status', ['READY', 'DELETED']).notNull().default('READY'),
    createdBy: char('created_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull()
})

export const modules = mysqlTable('modules', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    serverId: char('server_id', { length: 36 }).notNull(),
    uploadId: char('upload_id', { length: 36 }),
    type: mysqlEnum('type', ['ForgeMod', 'FabricMod', 'Library', 'File']).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    moduleId: varchar('module_id', { length: 512 }),
    relativePath: varchar('relative_path', { length: 1024 }),
    optionalMode: mysqlEnum('optional_mode', ['REQUIRED', 'OPTIONAL_ON', 'OPTIONAL_OFF']).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    needsManualFile: boolean('needs_manual_file').notNull().default(false),
    manualUrl: varchar('manual_url', { length: 2048 }),
    ...timestamps
})

export const serverDirectories = mysqlTable('server_directories', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    serverId: char('server_id', { length: 36 }).notNull(),
    path: varchar('path', { length: 1024 }).notNull(),
    pathHash: char('path_hash', { length: 64 }).notNull(),
    ...timestamps
}, table => [uniqueIndex('server_directories_path_uq').on(table.serverId, table.pathHash)])

export const jobs = mysqlTable('jobs', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    kind: mysqlEnum('kind', ['PUBLISH', 'CURSEFORGE_IMPORT']).notNull(),
    status: mysqlEnum('status', ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']).notNull(),
    snapshot: json('snapshot').notNull(),
    result: json('result'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    progress: int('progress').notNull().default(0),
    availableAt: datetime('available_at', { mode: 'date', fsp: 3 }).notNull(),
    lockedBy: varchar('locked_by', { length: 128 }),
    lockedAt: datetime('locked_at', { mode: 'date', fsp: 3 }),
    heartbeatAt: datetime('heartbeat_at', { mode: 'date', fsp: 3 }),
    errorText: text('error_text'),
    createdBy: char('created_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 })
})

export const releases = mysqlTable('releases', {
    id: char('id', { length: 36 }).primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    jobId: char('job_id', { length: 36 }).notNull(),
    draftRevision: bigint('draft_revision', { mode: 'number', unsigned: true }).notNull(),
    status: mysqlEnum('status', ['ACTIVE', 'AVAILABLE', 'DELETED']).notNull(),
    snapshot: json('snapshot').notNull(),
    distributionKey: varchar('distribution_key', { length: 1024 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    activatedAt: datetime('activated_at', { mode: 'date', fsp: 3 }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 })
})

export const releaseFiles = mysqlTable('release_files', {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    releaseId: char('release_id', { length: 36 }).notNull(),
    logicalPath: varchar('logical_path', { length: 1024 }).notNull(),
    objectKey: varchar('object_key', { length: 1024 }).notNull(),
    size: bigint('size', { mode: 'number', unsigned: true }).notNull(),
    md5: char('md5', { length: 32 }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull()
})

export const auditLogs = mysqlTable('audit_logs', {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    actorUserId: char('actor_user_id', { length: 36 }),
    actorUsername: varchar('actor_username', { length: 64 }),
    actorRole: varchar('actor_role', { length: 16 }),
    action: varchar('action', { length: 128 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    projectId: char('project_id', { length: 36 }),
    requestId: varchar('request_id', { length: 128 }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    beforeData: json('before_data'),
    afterData: json('after_data'),
    result: mysqlEnum('result', ['SUCCESS', 'FAILURE']).notNull(),
    errorMessage: text('error_message'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull()
})
