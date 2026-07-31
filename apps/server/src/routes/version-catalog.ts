import {
    loaderCatalogQuerySchema
} from '@nebula/shared'
import type { FastifyInstance } from 'fastify'
import { HttpError, requireRole } from '../http.js'
import {
    VersionCatalogUnavailableError,
    versionCatalogService,
    type VersionCatalogProvider
} from '../version-catalog.js'

function translateCatalogError(error: unknown): never {
    if (error instanceof VersionCatalogUnavailableError) {
        throw new HttpError(
            503,
            'Version catalog unavailable',
            'Version suggestions are temporarily unavailable; manual entry remains supported'
        )
    }
    throw error
}

export async function registerVersionCatalogRoutes(
    app: FastifyInstance,
    catalog: VersionCatalogProvider = versionCatalogService
): Promise<void> {
    app.get(
        '/api/v1/version-catalog/minecraft',
        { preHandler: requireRole('ADMIN', 'EDITOR') },
        async () => {
            try {
                return await catalog.getMinecraftVersions()
            } catch (error) {
                return translateCatalogError(error)
            }
        }
    )

    app.get(
        '/api/v1/version-catalog/loaders',
        { preHandler: requireRole('ADMIN', 'EDITOR') },
        async request => {
            const parsed = loaderCatalogQuerySchema.safeParse(request.query)
            if (!parsed.success) {
                throw new HttpError(400, 'Invalid version catalog query', undefined, parsed.error.flatten())
            }
            try {
                return await catalog.getLoaderVersions(
                    parsed.data.loader,
                    parsed.data.minecraftVersion
                )
            } catch (error) {
                return translateCatalogError(error)
            }
        }
    )
}
