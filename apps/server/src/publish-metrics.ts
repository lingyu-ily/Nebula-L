import { AsyncLocalStorage } from 'async_hooks'

export interface PublishMetrics {
    parseCacheHits: number
    loaderCacheHits: number
    objectCacheHits: number
    s3Requests: Record<string, number>
    downloadedBytes: number
    uploadedBytes: number
    copiedBytes: number
    durationMs: number
}

const context = new AsyncLocalStorage<PublishMetrics>()

export function createPublishMetrics(): PublishMetrics {
    return {
        parseCacheHits: 0, loaderCacheHits: 0, objectCacheHits: 0,
        s3Requests: {}, downloadedBytes: 0, uploadedBytes: 0, copiedBytes: 0, durationMs: 0
    }
}

export function withPublishMetrics<T>(metrics: PublishMetrics, operation: () => Promise<T>): Promise<T> {
    return context.run(metrics, operation)
}

export function recordStorageRequest(command: string): void {
    const metrics = context.getStore()
    if (metrics) metrics.s3Requests[command] = (metrics.s3Requests[command] ?? 0) + 1
}

export function recordStorageBytes(kind: 'downloadedBytes' | 'uploadedBytes' | 'copiedBytes', bytes: number): void {
    const metrics = context.getStore()
    if (metrics) metrics[kind] += bytes
}
