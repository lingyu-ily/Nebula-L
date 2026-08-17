import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerStructure } from '../../../dist/core.js'

const workspaces: string[] = []

afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('launcher UI distribution output', () => {
    it('resolves local hero assets and preserves per-server text and RSS', async () => {
        const root = await mkdtemp(join(tmpdir(), 'nebula-launcher-ui-'))
        workspaces.push(root)
        const serverRoot = join(root, 'servers', 'adventure-1.20.1')
        await Promise.all([
            mkdir(join(serverRoot, 'files'), { recursive: true }),
            mkdir(join(serverRoot, 'libraries'), { recursive: true }),
            mkdir(join(serverRoot, 'launcher'), { recursive: true })
        ])
        await writeFile(join(serverRoot, 'servermeta.json'), JSON.stringify({
            meta: {
                version: '1.0.0',
                name: 'Adventure World',
                description: 'Build your own empire.',
                icon: 'https://cdn.example/icon.png',
                address: 'localhost:25565',
                mainServer: true,
                autoconnect: false,
                ui: {
                    hero: {
                        background: 'launcher/background.webp',
                        logo: 'launcher/logo.png',
                        eyebrow: 'MAPLECRAFT SERVER',
                        title: 'Adventure World',
                        tagline: 'Build your own empire.'
                    },
                    news: { rss: 'https://example.com/adventure/rss' }
                }
            },
            untrackedFiles: []
        }))

        const servers = await new ServerStructure(
            root,
            'https://cdn.example/releases/release-1/',
            false,
            false
        ).getSpecModel()

        expect(servers).toHaveLength(1)
        expect(servers[0].ui).toEqual({
            hero: {
                background: 'https://cdn.example/releases/release-1/servers/adventure-1.20.1/launcher/background.webp',
                logo: 'https://cdn.example/releases/release-1/servers/adventure-1.20.1/launcher/logo.png',
                eyebrow: 'MAPLECRAFT SERVER',
                title: 'Adventure World',
                tagline: 'Build your own empire.'
            },
            news: { rss: 'https://example.com/adventure/rss' }
        })
    })
})
