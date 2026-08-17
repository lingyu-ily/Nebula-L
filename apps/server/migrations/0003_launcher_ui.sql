ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS hero_background_upload_id CHAR(36) NULL AFTER icon_upload_id,
    ADD COLUMN IF NOT EXISTS hero_logo_upload_id CHAR(36) NULL AFTER hero_background_upload_id,
    ADD COLUMN IF NOT EXISTS hero_eyebrow VARCHAR(128) NULL AFTER hero_logo_upload_id,
    ADD COLUMN IF NOT EXISTS hero_title VARCHAR(128) NULL AFTER hero_eyebrow,
    ADD COLUMN IF NOT EXISTS hero_tagline VARCHAR(500) NULL AFTER hero_title,
    ADD COLUMN IF NOT EXISTS news_rss VARCHAR(2048) NULL AFTER hero_tagline;
-- statement-breakpoint
ALTER TABLE servers
    ADD CONSTRAINT servers_hero_background_fk FOREIGN KEY (hero_background_upload_id) REFERENCES uploads(id),
    ADD CONSTRAINT servers_hero_logo_fk FOREIGN KEY (hero_logo_upload_id) REFERENCES uploads(id);
