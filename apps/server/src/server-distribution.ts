import { createHash } from 'crypto'
import type { Server } from 'helios-distribution-types'
import { getConfig } from './config.js'
import { putImmutableJson } from './storage.js'

export interface ServerDistributionReference {
    id: string
    url: string
    sha256: string
    size: number
}

export function encodeServerDistribution(slug: string, publicBaseUrl: string, server: Server): {
    objectKey: string
    body: Buffer
    reference: ServerDistributionReference
} {
    const body = Buffer.from(JSON.stringify(server))
    const sha256 = createHash('sha256').update(body).digest('hex')
    const objectKey = `public/${slug}/server-distributions/${sha256}.json`
    return {
        objectKey, body,
        reference: {
            id: server.id,
            url: `${publicBaseUrl.replace(/\/$/, '')}/${objectKey}`,
            sha256, size: body.length
        }
    }
}

export async function publishServerDistribution(slug: string, server: Server): Promise<ServerDistributionReference> {
    const { objectKey, body, reference } = encodeServerDistribution(slug, getConfig().rustfs.publicBaseUrl, server)
    await putImmutableJson(objectKey, body)
    return reference
}
