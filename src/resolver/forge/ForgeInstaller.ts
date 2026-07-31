import { spawn } from 'child_process'
import { dirname } from 'path'
import { mkdirs, pathExists, remove } from 'fs-extra/esm'
import { LoggerUtil } from '../../util/LoggerUtil.js'

const OUTPUT_TAIL_LIMIT = 8192
const logger = LoggerUtil.getLogger('Forge Installer')

export interface ForgeInstallerProcess {
    readonly stdout: NodeJS.ReadableStream
    readonly stderr: NodeJS.ReadableStream
    once(event: 'error', listener: (error: Error) => void): this
    once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type SpawnForgeInstaller = (
    command: string,
    args: readonly string[],
    options: { cwd: string }
) => ForgeInstallerProcess

export interface ForgeInstallerOptions {
    javaExecutable: string
    installerPath: string
    outputDirectory: string
    version: string
}

export type ForgeInstallerCacheAction = 'install' | 'reuse'

function defaultSpawn(command: string, args: readonly string[], options: { cwd: string }): ForgeInstallerProcess {
    return spawn(command, [...args], options)
}

function appendOutputTail(current: string, value: string): string {
    const combined = current + value
    return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined
}

function outputText(data: unknown): string {
    if (Buffer.isBuffer(data)) {
        return data.toString('utf8')
    }
    return typeof data === 'string' ? data : String(data)
}

function errorOutputSuffix(output: string): string {
    const trimmed = output.trim()
    return trimmed ? ` Last output: ${trimmed}` : ''
}

export function forgeInstallerArguments(installerPath: string, outputDirectory: string): string[] {
    return [
        '-Djava.awt.headless=true',
        '-jar',
        installerPath,
        '--installClient',
        outputDirectory
    ]
}

export async function runForgeInstaller(
    options: ForgeInstallerOptions,
    spawnProcess: SpawnForgeInstaller = defaultSpawn
): Promise<void> {
    const args = forgeInstallerArguments(options.installerPath, options.outputDirectory)
    let child: ForgeInstallerProcess
    try {
        child = spawnProcess(options.javaExecutable, args, { cwd: dirname(options.installerPath) })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Unable to start Forge installer for ${options.version}: ${message}`, { cause: error })
    }

    let outputTail = ''
    const recordOutput = (data: unknown, isError: boolean): void => {
        const text = outputText(data)
        outputTail = appendOutputTail(outputTail, text)
        const line = text.trim()
        if (line) {
            if (isError) {
                logger.error(line)
            } else {
                logger.info(line)
            }
        }
    }
    child.stdout.on('data', (data: unknown) => recordOutput(data, false))
    child.stderr.on('data', (data: unknown) => recordOutput(data, true))

    await new Promise<void>((resolve, reject) => {
        let settled = false
        child.once('error', error => {
            if (settled) return
            settled = true
            reject(new Error(
                `Unable to start Forge installer for ${options.version}: ${error.message}${errorOutputSuffix(outputTail)}`,
                { cause: error }
            ))
        })
        child.once('close', (code, signal) => {
            if (settled) return
            settled = true
            if (code === 0 && signal == null) {
                resolve()
                return
            }
            const result = signal
                ? `terminated by signal ${signal}`
                : code == null ? 'closed without an exit code' : `exited with code ${code}`
            reject(new Error(
                `Forge installer for ${options.version} ${result}.${errorOutputSuffix(outputTail)}`
            ))
        })
    })
}

export async function prepareForgeInstallerCache(
    cacheDirectory: string,
    expectedManifestPath: string,
    invalidate: boolean
): Promise<ForgeInstallerCacheAction> {
    if (!invalidate && await pathExists(expectedManifestPath)) {
        return 'reuse'
    }
    if (await pathExists(cacheDirectory)) {
        await remove(cacheDirectory)
    }
    await mkdirs(cacheDirectory)
    return 'install'
}

export async function clearForgeInstallerCache(cacheDirectory: string): Promise<void> {
    await remove(cacheDirectory)
}
