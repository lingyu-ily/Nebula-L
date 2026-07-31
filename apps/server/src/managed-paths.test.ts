import { describe, expect, it } from 'vitest'
import {
    isPathWithin,
    managedPathHash,
    parentDirectoryPaths,
    replacePathPrefix
} from './managed-paths.js'

describe('managed paths', () => {
    it('derives every parent directory from a file path', () => {
        expect(parentDirectoryPaths('config/client/options.txt')).toEqual([
            'config',
            'config/client'
        ])
    })

    it('uses case-insensitive hashes for path uniqueness', () => {
        expect(managedPathHash('Config/Client')).toBe(managedPathHash('config/client'))
    })

    it('moves an entire path subtree without matching similar prefixes', () => {
        expect(isPathWithin('config/client/options.txt', 'config')).toBe(true)
        expect(isPathWithin('configuration/options.txt', 'config')).toBe(false)
        expect(replacePathPrefix('config/client/options.txt', 'config', 'settings')).toBe('settings/client/options.txt')
    })
})
