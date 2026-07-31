import { createServer, type RequestListener, type Server } from 'http'
import { access, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaseMavenRepo } from '../../../dist/structure/repo/BaseMavenRepo.js'

class TestMavenRepo extends BaseMavenRepo {
    public constructor(root: string) {
        super(root, '', 'repo')
    }

    public getLoggerName(): string {
        return 'TestMavenRepo'
    }
}

const temporaryDirectories: string[] = []
const servers: Server[] = []

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'nebula-maven-test-'))
    temporaryDirectories.push(directory)
    return directory
}

async function listen(handler: RequestListener): Promise<string> {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
        throw new Error('Test server did not expose a TCP address')
    }
    return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
    })))
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
        recursive: true,
        force: true
    })))
})

describe('Maven artifact downloads', () => {
    it('downloads a successful response to the requested path', async () => {
        const root = await temporaryDirectory()
        const baseUrl = await listen((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/java-archive' })
            response.end('artifact bytes')
        })
        const repository = new TestMavenRepo(root)
        await repository.init()

        await repository.downloadArtifactDirect(`${baseUrl}/artifact.jar`, 'group/artifact.jar')

        await expect(readFile(join(root, 'repo', 'group', 'artifact.jar'), 'utf8')).resolves.toBe('artifact bytes')
    })

    it('rejects HTTP errors and removes the partial artifact without crashing the process', async () => {
        const root = await temporaryDirectory()
        const baseUrl = await listen((_request, response) => {
            response.writeHead(404, { 'Content-Type': 'text/plain' })
            response.end('not found')
        })
        const repository = new TestMavenRepo(root)
        await repository.init()
        const artifactPath = join(root, 'repo', 'missing', 'artifact.jar')

        await expect(repository.downloadArtifactDirect(
            `${baseUrl}/missing.jar`,
            'missing/artifact.jar'
        )).rejects.toThrow(/Failed to download Maven artifact .*404/)
        await expect(access(artifactPath)).rejects.toThrow()
    })
})
