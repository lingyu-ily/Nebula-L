CREATE TABLE IF NOT EXISTS server_groups (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    main_server BOOLEAN NOT NULL DEFAULT FALSE,
    default_version_id CHAR(36) NOT NULL,
    icon_upload_id CHAR(36) NULL,
    hero_background_upload_id CHAR(36) NULL,
    hero_logo_upload_id CHAR(36) NULL,
    hero_video_source VARCHAR(16) NULL,
    hero_video_upload_id CHAR(36) NULL,
    hero_video_url VARCHAR(2048) NULL,
    hero_eyebrow VARCHAR(128) NULL,
    hero_title VARCHAR(128) NULL,
    hero_tagline VARCHAR(500) NULL,
    news_rss VARCHAR(2048) NULL,
    KEY server_groups_project_order_idx (project_id, sort_order),
    CONSTRAINT server_groups_project_fk FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB;
-- statement-breakpoint
ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS group_id CHAR(36) NULL,
    ADD COLUMN IF NOT EXISTS version_name VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS distribution_id VARCHAR(128) NULL;
-- statement-breakpoint
INSERT IGNORE INTO server_groups (
    id, project_id, name, description, sort_order, main_server, default_version_id,
    icon_upload_id, hero_background_upload_id, hero_logo_upload_id, hero_video_source,
    hero_video_upload_id, hero_video_url, hero_eyebrow, hero_title, hero_tagline, news_rss
)
SELECT id, project_id, name, description, sort_order, main_server, id,
    icon_upload_id, hero_background_upload_id, hero_logo_upload_id, hero_video_source,
    hero_video_upload_id, hero_video_url, hero_eyebrow, hero_title, hero_tagline, news_rss
FROM servers WHERE group_id IS NULL;
-- statement-breakpoint
UPDATE servers SET group_id = id, version_name = server_version,
    distribution_id = CONCAT(server_key, '-', minecraft_version)
WHERE group_id IS NULL;
-- statement-breakpoint
ALTER TABLE servers
    ADD INDEX IF NOT EXISTS servers_group_order_idx (group_id, sort_order),
    ADD UNIQUE INDEX IF NOT EXISTS servers_distribution_id_uq (project_id, distribution_id);
