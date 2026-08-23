ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS disabled_at DATETIME(3) NULL AFTER disabled;
-- statement-breakpoint
UPDATE projects
SET disabled_at = updated_at
WHERE disabled = TRUE AND disabled_at IS NULL;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS project_deletion_tasks (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    project_slug VARCHAR(64) NOT NULL,
    project_name VARCHAR(128) NOT NULL,
    status ENUM('QUEUED','RUNNING','FAILED') NOT NULL DEFAULT 'QUEUED',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    locked_by VARCHAR(128) NULL,
    locked_at DATETIME(3) NULL,
    heartbeat_at DATETIME(3) NULL,
    error_text TEXT NULL,
    requested_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY project_deletion_tasks_project_uq (project_id),
    KEY project_deletion_tasks_claim_idx (status, available_at, created_at),
    CONSTRAINT project_deletion_tasks_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT project_deletion_tasks_requester_fk FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB;
