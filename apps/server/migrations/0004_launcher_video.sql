ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS hero_video_source VARCHAR(16) NULL AFTER hero_logo_upload_id,
    ADD COLUMN IF NOT EXISTS hero_video_upload_id CHAR(36) NULL AFTER hero_video_source,
    ADD COLUMN IF NOT EXISTS hero_video_url VARCHAR(2048) NULL AFTER hero_video_upload_id;

ALTER TABLE servers
    ADD CONSTRAINT servers_hero_video_fk FOREIGN KEY (hero_video_upload_id) REFERENCES uploads(id);
