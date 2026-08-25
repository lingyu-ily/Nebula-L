import { describe, expect, it } from 'vitest'
import {
    getServerBuildObjectPrefix,
    selectReusableServerBuilds,
    validateSnapshot,
    type ProjectSnapshot,
    type SelectedServerBuild
} from './publisher.js'

function snapshot(revisions: number[]): ProjectSnapshot {
    return {
        id: 'project-1',
        slug: 'test',
        name: 'Test',
        description: '',
        rss: '',
        discord: null,
        sourceDraftVersion: 1,
        servers: revisions.map((revision, index) => ({
            id: `server-${index}`,
            revision,
            serverKey: `server-${index}`,
            minecraftVersion: '1.20.1'
        }))
    } as ProjectSnapshot
}

function build(serverIndex: number, revision: number): SelectedServerBuild {
    return {
        id: `build-${serverIndex}-${revision}`,
        serverId: `server-${serverIndex}`,
        sourceRevision: revision,
        objectPrefix: `public/test/server-builds/server-${serverIndex}/publish-1`,
        spec: { id: `server-${serverIndex}-1.20.1` } as SelectedServerBuild['spec']
    }
}

describe('incremental server build selection', () => {
    it('uses per-server build prefixes and never creates a release prefix', () => {
        const prefix = getServerBuildObjectPrefix('test', 'server-1', 'publish-1')
        expect(prefix).toBe('public/test/server-builds/server-1/publish-1')
        expect(prefix).not.toContain('/releases/')
    })

    it('rebuilds only the changed server in a twenty-server distribution', () => {
        const project = snapshot(Array.from({ length: 20 }, () => 4))
        const builds = project.servers.map((_, index) => build(index, index === 7 ? 3 : 4))

        const selection = selectReusableServerBuilds(project, builds)

        expect(selection.reused).toHaveLength(19)
        expect(selection.dirtyServerIds).toEqual(['server-7'])
    })

    it('reuses every server when only project metadata or ordering changed', () => {
        const project = snapshot([2, 8, 5])
        project.rss = 'https://example.com/new-feed.xml'
        project.servers.reverse()
        const builds = [build(0, 2), build(1, 8), build(2, 5)]

        expect(selectReusableServerBuilds(project, builds).dirtyServerIds).toEqual([])
    })

    it('rejects a cache entry whose generated server id does not match', () => {
        const project = snapshot([1])
        const cached = build(0, 1)
        cached.spec = { id: 'wrong-server-id' } as SelectedServerBuild['spec']

        expect(selectReusableServerBuilds(project, [cached]).dirtyServerIds).toEqual(['server-0'])
    })

    it('blocks legacy external launcher videos with an actionable error', () => {
        const project = snapshot([1])
        project.servers[0] = {
            ...project.servers[0],
            name: 'Legacy',
            mainServer: true,
            launcherUi: {
                background: null,
                logo: null,
                video: { source: 'external', url: 'https://cdn.example.com/video.mp4' },
                eyebrow: '',
                title: '',
                tagline: '',
                rss: ''
            },
            modules: []
        }

        expect(() => validateSnapshot(project)).toThrow(/replace it with an upload or YouTube/)
    })
})
