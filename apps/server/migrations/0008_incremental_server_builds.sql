ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS stable_distribution_size BIGINT UNSIGNED NULL AFTER active_release_id,
    ADD COLUMN IF NOT EXISTS stable_distribution_sha256 CHAR(64) NULL AFTER stable_distribution_size;
-- statement-breakpoint
UPDATE projects p
INNER JOIN releases r ON r.id = p.active_release_id
INNER JOIN release_files rf ON rf.release_id = r.id AND rf.logical_path = 'distribution.json'
SET p.stable_distribution_size = rf.size,
    p.stable_distribution_sha256 = rf.sha256
WHERE p.stable_distribution_size IS NULL
   OR p.stable_distribution_sha256 IS NULL;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS server_builds (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    server_id CHAR(36) NOT NULL,
    source_revision BIGINT UNSIGNED NOT NULL,
    spec JSON NOT NULL,
    object_prefix VARCHAR(1024) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY server_builds_server_revision_uq (server_id, source_revision),
    KEY server_builds_project_idx (project_id)
);
