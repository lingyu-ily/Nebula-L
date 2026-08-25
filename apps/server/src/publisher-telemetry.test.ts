import { describe, expect, it } from 'vitest'
import { buildLauncherTelemetry } from './publisher.js'

describe('published Launcher telemetry descriptor', () => {
    it('uses the configured application base URL and a project-scoped endpoint', () => {
        expect(buildLauncherTelemetry('https://nebula.example.com/', 'maplecraft-launcher')).toEqual({
            anonymousDailyActive: {
                endpoint: 'https://nebula.example.com/api/v1/public/launcher-presence/maplecraft-launcher',
                timeZone: 'Asia/Taipei'
            }
        })
    })
})
