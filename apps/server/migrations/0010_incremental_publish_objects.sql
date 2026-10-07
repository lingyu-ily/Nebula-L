CREATE TABLE IF NOT EXISTS published_objects (
    project_id CHAR(36) NOT NULL,
    id CHAR(64) NOT NULL,
    object_key VARCHAR(1024) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    md5 CHAR(32) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (project_id, id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS publish_manifests (
    project_id CHAR(36) NOT NULL,
    job_id CHAR(36) NOT NULL,
    status ENUM('PREPARED', 'WRITING', 'ACTIVE', 'RETIRED') NOT NULL,
    distribution JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (project_id, job_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS publish_object_refs (
    project_id CHAR(36) NOT NULL,
    job_id CHAR(36) NOT NULL,
    object_id CHAR(64) NOT NULL,
    PRIMARY KEY (project_id, job_id, object_id),
    KEY publish_object_refs_object_idx (project_id, object_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS publish_parse_cache (
    project_id CHAR(36) NOT NULL,
    cache_key CHAR(64) NOT NULL,
    spec JSON NOT NULL,
    PRIMARY KEY (project_id, cache_key)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS publish_loader_cache (
    project_id CHAR(36) NOT NULL,
    cache_key CHAR(64) NOT NULL,
    spec JSON NOT NULL,
    object_ids JSON NOT NULL,
    PRIMARY KEY (project_id, cache_key)
);
-- statement-breakpoint
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS deleted_at DATETIME(3) NULL;
-- statement-breakpoint
UPDATE uploads SET deleted_at = UTC_TIMESTAMP(3) WHERE status = 'DELETED' AND deleted_at IS NULL;
