ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS release_revision BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER draft_revision;
-- statement-breakpoint
ALTER TABLE releases
    ADD COLUMN IF NOT EXISTS release_revision BIGINT UNSIGNED NULL AFTER draft_revision;
-- statement-breakpoint
UPDATE releases r
LEFT JOIN jobs j ON j.id = r.job_id
SET r.release_revision = r.draft_revision
WHERE r.release_revision IS NULL
  AND (
      j.status = 'SUCCEEDED'
      OR r.status = 'ACTIVE'
      OR EXISTS (
          SELECT 1 FROM audit_logs a
          WHERE a.action = 'release.published'
            AND a.entity_id = r.id
            AND a.result = 'SUCCESS'
      )
  );
-- statement-breakpoint
UPDATE projects p
LEFT JOIN (
    SELECT project_id, MAX(release_revision) AS latest_release_revision
    FROM releases
    WHERE release_revision IS NOT NULL
    GROUP BY project_id
) published ON published.project_id = p.id
SET p.release_revision = COALESCE(published.latest_release_revision, 0);
-- statement-breakpoint
ALTER TABLE releases
    ADD KEY IF NOT EXISTS releases_project_revision_idx (project_id, release_revision);
