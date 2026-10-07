import { fingerprint } from './publish-cache.js'

export function jsonValue(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) as unknown : value
}

export function contentChanged(before: unknown, after: unknown): boolean {
    return fingerprint(before) !== fingerprint(after)
}
