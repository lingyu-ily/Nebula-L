# Server versions

Each server in the project list represents a server group. Open **Versions** to
create an empty pack, copy an existing pack, rename or reorder versions, select
the default, disable a version, or permanently delete it. Settings and files
belong to the version named in the page header. The server name, description,
icon, launcher background, logo, video, and news feed are shared across versions.

Changes remain drafts until the existing project publish action succeeds.
The default version must be enabled. Choose another default before disabling or
deleting it; the last version cannot be deleted individually. Deletion requires
typing its name. Deleting the entire server through Settings also requires its
name and removes all versions from the draft.

Copies receive independent module, directory, and rule records. Their immutable
uploads may be shared until replaced. Published assets remain protected by active
manifests and queued job snapshots; existing reference-based cleanup collects
unreferenced objects. No management operation removes player-side saves.

## Deployment and migration

1. Release the launcher with support for both old distributions and `serverGroups`.
2. Back up the database and deploy Nebula-L. Its normal startup migration applies
   `0011_server_versions.sql`; it can also be applied through the existing
   `db:migrate` command after building the server.
3. Verify each existing server has one group with its original version selected,
   then create additional versions and publish the project.

The migration retains existing server record IDs and their effective distribution
IDs (`serverKey-minecraftVersion`). These continue to identify existing player
instance directories. New versions use fixed `version-<UUID>` distribution IDs,
independent of Minecraft upgrades, labels, or server keys. Do not change these IDs
to rename a version. Existing queued publish snapshots without group metadata
retain their original single-server behavior.

## Management API

All routes are under `/api/v1/projects/:projectId/server-groups` and use existing
authentication, CSRF, ADMIN/EDITOR write permissions, AUDITOR read permissions,
and optimistic `draftVersion` checks. Mutation responses return the next draft
version. A version's API `id` is its database UUID; `distributionId` is the fixed
launcher instance identity.

| Method and suffix | Operation |
| --- | --- |
| `GET /` | List groups and all enabled/disabled versions |
| `POST /` | Create a group and first version using existing server input plus `draftVersion` |
| `PUT /order` | Reorder groups using `serverIds` (group UUIDs) and `draftVersion` |
| `PUT /:groupId` | Save `name`, `description`, `mainServer`, and enabled `defaultVersionId` |
| `DELETE /:groupId` | Delete the group with `confirmName` and `draftVersion` |
| `POST /:groupId/versions` | Create using `versionName`, `draftVersion`, and either `sourceVersionId` or `server` (existing server input) |
| `PUT /:groupId/versions/order` | Reorder versions using `serverIds` (version UUIDs) and `draftVersion` |
| `PATCH /:groupId/versions/:versionId` | Save optional `versionName` / `enabled` plus `draftVersion` |
| `DELETE /:groupId/versions/:versionId` | Delete with exact `confirmName` and `draftVersion` |

The existing `/servers/:serverId` settings, presentation, and file APIs continue
to use version UUIDs. Presentation edits propagate to all sibling versions.
Individual version removal uses the new guarded DELETE route.

## Distribution contract

Format 2 retains the ordered, flat `servers` reference list and adds:

```json
{
  "serverGroups": [{
    "id": "server-group-uuid",
    "name": "Survival",
    "icon": "https://cdn.example.com/icon.png",
    "defaultVersionId": "legacy-1.20.1",
    "versionIds": ["legacy-1.20.1", "version-new-uuid"]
  }]
}
```

IDs inside this metadata reference the flat distribution server IDs. Every
published version belongs to exactly one group; only enabled versions appear.
The main group's default version is the only entry with `mainServer: true`.
Per-version manifests add `versionName` and `loaderLabel` for the picker.
Older launchers can still read the flat list, but show versions as separate
servers. Updated launchers group them and preserve each server's last selection.
