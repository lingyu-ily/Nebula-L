ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) NULL AFTER display_name;
-- statement-breakpoint
UPDATE modules m
LEFT JOIN uploads u ON u.id = m.upload_id
SET m.file_name = CASE
    WHEN m.type = 'File' AND m.relative_path IS NOT NULL
        THEN SUBSTRING_INDEX(m.relative_path, '/', -1)
    ELSE COALESCE(u.original_name, m.display_name)
END
WHERE m.file_name IS NULL;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS server_directories (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    server_id CHAR(36) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY server_directories_path_uq (server_id, path_hash),
    KEY server_directories_project_idx (project_id, server_id),
    CONSTRAINT server_directories_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT server_directories_server_fk FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB;
