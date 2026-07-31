import type {
    LoaderCatalogResponse,
    MinecraftCatalogResponse,
    VersionCatalogLoader
} from '@nebula/shared'
import { z } from 'zod'

const MINECRAFT_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FORGE_METADATA_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json'
const FABRIC_LOADER_URL = 'https://meta.fabricmc.net/v2/versions/loader'

const REQUEST_TIMEOUT_MS = 8_000
const FRESH_CACHE_MS = 15 * 60 * 1_000
const STALE_CACHE_MS = 24 * 60 * 60 * 1_000

const minecraftManifestSchema = z.object({
    versions: z.array(z.object({
        id: z.string(),
        type: z.string(),
        releaseTime: z.string()
    }))
})

const forgePromotionsSchema = z.object({
    promos: z.record(z.string(), z.string())
})

const fabricLoaderSchema = z.array(z.object({
    loader: z.object({
        version: z.string(),
        stable: z.boolean()
    })
}))

const versionCollator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base'
})

interface CacheEntry<T> {
    value: T
    fetchedAt: number
}

interface CachedValue<T> {
    value: T
    stale: boolean
}

interface ForgeSources {
    artifactVersions: string[]
    promotions: Record<string, string>
}

export type CatalogFetch = (url: string, init?: RequestInit) => Promise<Response>

export class VersionCatalogUnavailableError extends Error {
    constructor(cause?: unknown) {
        super('The upstream version catalog is unavailable', { cause })
    }
}

export interface VersionCatalogProvider {
    getMinecraftVersions(): Promise<MinecraftCatalogResponse>
    getLoaderVersions(loader: VersionCatalogLoader, minecraftVersion: string): Promise<LoaderCatalogResponse>
}

export class VersionCatalogService implements VersionCatalogProvider {
    private readonly cache = new Map<string, CacheEntry<unknown>>()

    constructor(
        private readonly fetcher: CatalogFetch = async (url, init) => fetch(url, init),
        private readonly now: () => number = Date.now,
        private readonly requestTimeoutMs: number = REQUEST_TIMEOUT_MS
    ) {}

    public async getMinecraftVersions(): Promise<MinecraftCatalogResponse> {
        const cached = await this.fromCache('minecraft', async () => {
            const manifest = minecraftManifestSchema.parse(await this.fetchJson(MINECRAFT_MANIFEST_URL))
            return manifest.versions
                .filter(version => version.type === 'release')
                .map(version => ({
                    value: version.id,
                    type: 'release' as const,
                    releaseTime: version.releaseTime
                }))
        })
        return { versions: cached.value, stale: cached.stale }
    }

    public async getLoaderVersions(
        loader: VersionCatalogLoader,
        minecraftVersion: string
    ): Promise<LoaderCatalogResponse> {
        return loader === 'forge'
            ? this.getForgeVersions(minecraftVersion)
            : this.getFabricVersions(minecraftVersion)
    }

    private async getForgeVersions(minecraftVersion: string): Promise<LoaderCatalogResponse> {
        const cached = await this.fromCache('forge-sources', async (): Promise<ForgeSources> => {
            const [metadata, promotionJson] = await Promise.all([
                this.fetchText(FORGE_METADATA_URL),
                this.fetchJson(FORGE_PROMOTIONS_URL)
            ])
            const artifactVersions = Array.from(metadata.matchAll(/<version>([^<]+)<\/version>/g), match => match[1])
            if (artifactVersions.length === 0) {
                throw new Error('Forge metadata did not contain any versions')
            }
            return {
                artifactVersions,
                promotions: forgePromotionsSchema.parse(promotionJson).promos
            }
        })
        const prefix = `${minecraftVersion}-`
        const suffix = `-${minecraftVersion}`
        const normalized = cached.value.artifactVersions
            .filter(version => version.startsWith(prefix))
            .map(version => {
                const withoutMinecraft = version.slice(prefix.length)
                return withoutMinecraft.endsWith(suffix)
                    ? withoutMinecraft.slice(0, -suffix.length)
                    : withoutMinecraft
            })
        const versions = [...new Set(normalized)]
            .sort((left, right) => versionCollator.compare(right, left))
            .map(value => ({
                value,
                recommended: cached.value.promotions[`${minecraftVersion}-recommended`] === value,
                latest: cached.value.promotions[`${minecraftVersion}-latest`] === value,
                stable: false
            }))
        return {
            loader: 'forge',
            minecraftVersion,
            versions,
            stale: cached.stale
        }
    }

    private async getFabricVersions(minecraftVersion: string): Promise<LoaderCatalogResponse> {
        const cached = await this.fromCache(`fabric:${minecraftVersion}`, async () => {
            const url = `${FABRIC_LOADER_URL}/${encodeURIComponent(minecraftVersion)}`
            return fabricLoaderSchema.parse(await this.fetchJson(url))
        })
        const latest = cached.value[0]?.loader.version
        const recommended = cached.value.find(entry => entry.loader.stable)?.loader.version
        const versions = cached.value
            .map(entry => entry.loader)
            .sort((left, right) => {
                if (left.stable !== right.stable) {
                    return left.stable ? -1 : 1
                }
                return versionCollator.compare(right.version, left.version)
            })
            .map(loader => ({
                value: loader.version,
                recommended: loader.version === recommended,
                latest: loader.version === latest,
                stable: loader.stable
            }))
        return {
            loader: 'fabric',
            minecraftVersion,
            versions,
            stale: cached.stale
        }
    }

    private async fromCache<T>(key: string, loader: () => Promise<T>): Promise<CachedValue<T>> {
        const existing = this.cache.get(key) as CacheEntry<T> | undefined
        const age = existing ? this.now() - existing.fetchedAt : Number.POSITIVE_INFINITY
        if (existing && age <= FRESH_CACHE_MS) {
            return { value: existing.value, stale: false }
        }
        try {
            const value = await loader()
            this.cache.set(key, { value, fetchedAt: this.now() })
            return { value, stale: false }
        } catch (error) {
            if (existing && age <= STALE_CACHE_MS) {
                return { value: existing.value, stale: true }
            }
            throw new VersionCatalogUnavailableError(error)
        }
    }

    private async fetchJson(url: string): Promise<unknown> {
        const response = await this.fetchResponse(url)
        return response.json() as Promise<unknown>
    }

    private async fetchText(url: string): Promise<string> {
        const response = await this.fetchResponse(url)
        return response.text()
    }

    private async fetchResponse(url: string): Promise<Response> {
        const response = await this.fetcher(url, {
            headers: { Accept: 'application/json, application/xml, text/xml' },
            signal: AbortSignal.timeout(this.requestTimeoutMs)
        })
        if (!response.ok) {
            throw new Error(`Version catalog request failed with HTTP ${response.status}`)
        }
        return response
    }
}

export const versionCatalogService = new VersionCatalogService()
