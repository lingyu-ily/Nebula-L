import { describe, expect, it } from 'vitest'
import { buildLauncherUrl, getStableDistributionKey } from './stable-distribution.js'

describe('stable distribution addressing', () => {
    it('builds a launcher URL without a release id', () => {
        const url = buildLauncherUrl(
            'http://s3.gfscs.com/maplecraftlauncher/',
            'maplecraftlauncher'
        )
        expect(url).toBe(
            'http://s3.gfscs.com/maplecraftlauncher/public/maplecraftlauncher/distribution.json'
        )
        expect(url).not.toContain('/releases/')
    })

    it('keeps the stable key separate from immutable releases', () => {
        expect(getStableDistributionKey('maplecraftlauncher'))
            .toBe('public/maplecraftlauncher/distribution.json')
    })
})
