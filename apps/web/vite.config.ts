import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = resolve(process.cwd(), '../..')
const rootPackage = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version?: unknown }

if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
    throw new Error('The root package.json must contain a non-empty version.')
}

function resolveBuildCommit(): string {
    const configuredCommit = process.env.NEBULA_BUILD_COMMIT?.trim()
    if (configuredCommit) return configuredCommit

    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
    } catch {
        return 'dev'
    }
}

const rawBuildCommit = resolveBuildCommit()
const buildCommit = /^[0-9a-f]{7,40}$/i.test(rawBuildCommit) ? rawBuildCommit.toLowerCase() : 'dev'

export default defineConfig({
    plugins: [react()],
    define: {
        __NEBULA_VERSION__: JSON.stringify(rootPackage.version),
        __NEBULA_BUILD_COMMIT__: JSON.stringify(buildCommit)
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3000',
            '/health': 'http://localhost:3000'
        }
    },
    build: {
        outDir: 'dist'
    }
})
