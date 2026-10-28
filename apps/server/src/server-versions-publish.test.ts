import { describe, expect, it } from 'vitest'
import { buildPublishedServerGroups, effectiveVersionId, type ProjectSnapshot, type SnapshotServer } from './publisher.js'

const versions = [
    { id: 'stable', groupId: 'survival', defaultVersionId: 'stable', name: 'Survival', distributionId: 'legacy-1.20.1', serverKey: 'legacy', minecraftVersion: '1.20.1' },
    { id: 'beta', groupId: 'survival', defaultVersionId: 'stable', name: 'Survival', distributionId: 'version-beta', serverKey: 'beta', minecraftVersion: '1.20.1' },
    { id: 'creative', groupId: 'creative-group', defaultVersionId: 'creative', name: 'Creative', distributionId: 'version-creative' }
] as SnapshotServer[]

describe('multi-version publishing', () => {
    it('publishes one group per server, preserving saved version order and legacy IDs', () => {
        const groups = buildPublishedServerGroups({ servers: versions } as ProjectSnapshot, new Map([['legacy-1.20.1', 'https://cdn/icon.png']]))!
        expect(groups).toHaveLength(2)
        expect(groups[0]).toEqual({ id: 'survival', name: 'Survival', icon: 'https://cdn/icon.png', defaultVersionId: 'legacy-1.20.1', versionIds: ['legacy-1.20.1', 'version-beta'] })
    })
    it('keeps instance identities independent of Minecraft, names, and server keys', () => {
        expect(effectiveVersionId({ ...versions[0], minecraftVersion: '1.21.1', name: 'Renamed', serverKey: 'other' })).toBe('legacy-1.20.1')
        expect(effectiveVersionId(versions[0])).not.toBe(effectiveVersionId(versions[1]))
        expect(effectiveVersionId({ serverKey: 'old', minecraftVersion: '1.20.1' } as SnapshotServer)).toBe('old-1.20.1')
    })
    it('rejects missing or cross-group defaults and supports old queued snapshots', () => {
        expect(() => buildPublishedServerGroups({ servers: versions.slice(1) } as ProjectSnapshot)).toThrow('no enabled default')
        expect(() => buildPublishedServerGroups({ servers: [{ ...versions[0], defaultVersionId: 'creative' }, versions[2]] } as ProjectSnapshot)).toThrow('no enabled default')
        expect(buildPublishedServerGroups({ servers: [{ serverKey: 'old' }] } as ProjectSnapshot)).toBeUndefined()
    })
})
