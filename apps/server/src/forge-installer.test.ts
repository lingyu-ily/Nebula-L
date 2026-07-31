import { EventEmitter } from 'events'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
    clearForgeInstallerCache,
    prepareForgeInstallerCache,
    runForgeInstaller,
    type ForgeInstallerProcess,
    type SpawnForgeInstaller
} from '../../../dist/resolver/forge/ForgeInstaller.js'

interface TestInstallerProcess extends ForgeInstallerProcess {
    readonly stdout: PassThrough
    readonly stderr: PassThrough
    emit(event: string, ...args: unknown[]): boolean
}

const temporaryDirectories: string[] = []

function createProcess(): TestInstallerProcess {
    return Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough()
    }) as TestInstallerProcess
}

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'nebula-forge-test-'))
    temporaryDirectories.push(directory)
    return directory
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
        recursive: true,
        force: true
    })))
})

describe('Forge installer process', () => {
    it('uses headless client installation arguments without splitting paths that contain spaces', async () => {
        const child = createProcess()
        let invocation: { command: string, args: readonly string[], cwd: string } | undefined
        const spawnProcess: SpawnForgeInstaller = (command, args, options) => {
            invocation = { command, args, cwd: options.cwd }
            queueMicrotask(() => {
                child.stdout.write('Installation complete')
                child.emit('close', 0, null)
            })
            return child
        }

        await runForgeInstaller({
            javaExecutable: '/opt/java runtime/bin/java',
            installerPath: '/cache with spaces/forge installer.jar',
            outputDirectory: '/cache with spaces/forge/1.20.1-47.4.22',
            version: '1.20.1-47.4.22'
        }, spawnProcess)

        expect(invocation).toEqual({
            command: '/opt/java runtime/bin/java',
            args: [
                '-Djava.awt.headless=true',
                '-jar',
                '/cache with spaces/forge installer.jar',
                '--installClient',
                '/cache with spaces/forge/1.20.1-47.4.22'
            ],
            cwd: '/cache with spaces'
        })
    })

    it('rejects a non-zero exit code with the Forge version and installer output', async () => {
        const child = createProcess()
        const spawnProcess: SpawnForgeInstaller = () => {
            queueMicrotask(() => {
                child.stderr.write('Failed to download processor')
                child.emit('close', 1, null)
            })
            return child
        }

        await expect(runForgeInstaller({
            javaExecutable: 'java',
            installerPath: '/cache/installer.jar',
            outputDirectory: '/cache/forge',
            version: '1.20.1-47.4.22'
        }, spawnProcess)).rejects.toThrow(
            /1\.20\.1-47\.4\.22 exited with code 1.*Failed to download processor/
        )
    })

    it('rejects process startup errors', async () => {
        const child = createProcess()
        const spawnProcess: SpawnForgeInstaller = () => {
            queueMicrotask(() => child.emit('error', new Error('Java executable not found')))
            return child
        }

        await expect(runForgeInstaller({
            javaExecutable: '/missing/java',
            installerPath: '/cache/installer.jar',
            outputDirectory: '/cache/forge',
            version: '1.20.1-47.4.22'
        }, spawnProcess)).rejects.toThrow(
            'Unable to start Forge installer for 1.20.1-47.4.22: Java executable not found'
        )
    })

    it('rejects a process terminated by a signal', async () => {
        const child = createProcess()
        const spawnProcess: SpawnForgeInstaller = () => {
            queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
            return child
        }

        await expect(runForgeInstaller({
            javaExecutable: 'java',
            installerPath: '/cache/installer.jar',
            outputDirectory: '/cache/forge',
            version: '1.20.1-47.4.22'
        }, spawnProcess)).rejects.toThrow(
            'Forge installer for 1.20.1-47.4.22 terminated by signal SIGTERM'
        )
    })
})

describe('Forge installer cache', () => {
    it('reuses a cache only when the expected version manifest exists', async () => {
        const root = await temporaryDirectory()
        const cacheDirectory = join(root, 'forge', '1.20.1-47.4.22')
        const manifestPath = join(cacheDirectory, 'versions', '1.20.1-forge-47.4.22', '1.20.1-forge-47.4.22.json')
        await mkdir(dirname(manifestPath), { recursive: true })
        await writeFile(manifestPath, '{}')

        await expect(prepareForgeInstallerCache(cacheDirectory, manifestPath, false)).resolves.toBe('reuse')
        await expect(readFile(manifestPath, 'utf8')).resolves.toBe('{}')
    })

    it('rebuilds an incomplete target cache without touching another Forge version', async () => {
        const root = await temporaryDirectory()
        const targetCache = join(root, 'forge', '1.20.1-47.4.22')
        const otherCache = join(root, 'forge', '1.20.1-47.4.21')
        const missingManifest = join(targetCache, 'versions', 'missing.json')
        await mkdir(targetCache, { recursive: true })
        await mkdir(otherCache, { recursive: true })
        await writeFile(join(targetCache, 'partial-download'), 'partial')
        await writeFile(join(otherCache, 'complete-cache'), 'preserved')

        await expect(prepareForgeInstallerCache(targetCache, missingManifest, false)).resolves.toBe('install')
        await expect(readdir(targetCache)).resolves.toEqual([])
        await expect(readFile(join(otherCache, 'complete-cache'), 'utf8')).resolves.toBe('preserved')
    })

    it('clears only the failed Forge version cache', async () => {
        const root = await temporaryDirectory()
        const targetCache = join(root, 'forge', '1.20.1-47.4.22')
        const otherCache = join(root, 'forge', '1.20.1-47.4.21')
        await mkdir(targetCache, { recursive: true })
        await mkdir(otherCache, { recursive: true })
        await writeFile(join(targetCache, 'failed-install'), 'partial')
        await writeFile(join(otherCache, 'complete-cache'), 'preserved')

        await clearForgeInstallerCache(targetCache)

        await expect(access(targetCache)).rejects.toThrow()
        await expect(readFile(join(otherCache, 'complete-cache'), 'utf8')).resolves.toBe('preserved')
    })
})
