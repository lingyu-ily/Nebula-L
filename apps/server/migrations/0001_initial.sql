CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN','EDITOR','AUDITOR') NOT NULL,
    status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until DATETIME(3) NULL,
    last_login_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY users_username_uq (username)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    csrf_token CHAR(64) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(512) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY sessions_user_idx (user_id),
    KEY sessions_expiry_idx (expires_at),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE projects (
    id CHAR(36) PRIMARY KEY,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    rss VARCHAR(2048) NOT NULL,
    discord JSON NULL,
    draft_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    active_release_id CHAR(36) NULL,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY projects_slug_uq (slug),
    CONSTRAINT projects_creator_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE uploads (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    object_key VARCHAR(1024) NOT NULL,
    original_name VARCHAR(512) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    md5 CHAR(32) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    status ENUM('READY','DELETED') NOT NULL DEFAULT 'READY',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY uploads_project_idx (project_id),
    CONSTRAINT uploads_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT uploads_creator_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE servers (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    server_key VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    minecraft_version VARCHAR(32) NOT NULL,
    server_version VARCHAR(64) NOT NULL,
    address VARCHAR(255) NOT NULL,
    discord JSON NULL,
    icon_upload_id CHAR(36) NULL,
    forge_version VARCHAR(64) NULL,
    fabric_version VARCHAR(64) NULL,
    main_server BOOLEAN NOT NULL DEFAULT FALSE,
    autoconnect BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    java_options JSON NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    published_once BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY servers_project_key_uq (project_id, server_key),
    KEY servers_project_order_idx (project_id, sort_order),
    CONSTRAINT servers_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT servers_icon_fk FOREIGN KEY (icon_upload_id) REFERENCES uploads(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE modules (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    server_id CHAR(36) NOT NULL,
    upload_id CHAR(36) NULL,
    type ENUM('ForgeMod','FabricMod','Library','File') NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    module_id VARCHAR(512) NULL,
    relative_path VARCHAR(1024) NULL,
    optional_mode ENUM('REQUIRED','OPTIONAL_ON','OPTIONAL_OFF') NOT NULL DEFAULT 'REQUIRED',
    sort_order INT NOT NULL DEFAULT 0,
    needs_manual_file BOOLEAN NOT NULL DEFAULT FALSE,
    manual_url VARCHAR(2048) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY modules_server_order_idx (server_id, sort_order),
    KEY modules_project_idx (project_id),
    CONSTRAINT modules_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT modules_server_fk FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    CONSTRAINT modules_upload_fk FOREIGN KEY (upload_id) REFERENCES uploads(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE untracked_rules (
    id CHAR(36) PRIMARY KEY,
    server_id CHAR(36) NOT NULL,
    applies_to ENUM('files','libraries','forgemods','fabricmods') NOT NULL,
    pattern VARCHAR(512) NOT NULL,
    CONSTRAINT untracked_server_fk FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE jobs (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    kind ENUM('PUBLISH','CURSEFORGE_IMPORT') NOT NULL,
    status ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED') NOT NULL DEFAULT 'QUEUED',
    snapshot JSON NOT NULL,
    result JSON NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    progress INT NOT NULL DEFAULT 0,
    available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    locked_by VARCHAR(128) NULL,
    locked_at DATETIME(3) NULL,
    heartbeat_at DATETIME(3) NULL,
    error_text TEXT NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    KEY jobs_claim_idx (status, available_at, created_at),
    KEY jobs_project_idx (project_id, created_at),
    CONSTRAINT jobs_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT jobs_creator_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE releases (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    job_id CHAR(36) NOT NULL,
    draft_revision BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','AVAILABLE','DELETED') NOT NULL,
    snapshot JSON NOT NULL,
    distribution_key VARCHAR(1024) NOT NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,
    KEY releases_project_idx (project_id, created_at),
    CONSTRAINT releases_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT releases_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id),
    CONSTRAINT releases_creator_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE release_files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    release_id CHAR(36) NOT NULL,
    logical_path VARCHAR(1024) NOT NULL,
    object_key VARCHAR(1024) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    md5 CHAR(32) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    KEY release_files_release_idx (release_id),
    CONSTRAINT release_files_release_fk FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_user_id CHAR(36) NULL,
    actor_username VARCHAR(64) NULL,
    actor_role VARCHAR(16) NULL,
    action VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NULL,
    project_id CHAR(36) NULL,
    request_id VARCHAR(128) NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(512) NULL,
    before_data JSON NULL,
    after_data JSON NULL,
    result ENUM('SUCCESS','FAILURE') NOT NULL,
    error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY audit_filter_idx (project_id, action, created_at),
    KEY audit_actor_idx (actor_user_id, created_at)
) ENGINE=InnoDB;
