CREATE TABLE launcher_daily_presence (
    project_id CHAR(36) NOT NULL,
    usage_date DATE NOT NULL,
    token_hash CHAR(64) NOT NULL,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (project_id, usage_date, token_hash),
    KEY launcher_daily_presence_date_idx (usage_date),
    CONSTRAINT launcher_daily_presence_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- statement-breakpoint
CREATE TABLE launcher_daily_usage (
    project_id CHAR(36) NOT NULL,
    usage_date DATE NOT NULL,
    active_launchers BIGINT UNSIGNED NOT NULL,
    finalized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (project_id, usage_date),
    KEY launcher_daily_usage_date_idx (usage_date),
    CONSTRAINT launcher_daily_usage_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;
