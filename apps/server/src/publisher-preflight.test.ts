import { describe, expect, it } from 'vitest'
import { PermanentJobError } from './job-errors.js'
import { snapshotAssetError } from './publisher.js'
import { StorageObjectIntegrityError, StorageObjectMissingError } from './storage.js'

describe('publish upload preflight errors', () => {
    it('turns a missing object into a contextual permanent input error', () => {
        const error = snapshotAssetError(
            'FF1',
            'icon',
            'upload-icon',
            new StorageObjectMissingError('private/icon.png', { name: 'NoSuchKey' })
        )

        expect(error).toBeInstanceOf(PermanentJobError)
        expect((error as Error).message)
            .toBe('Server FF1 icon is missing (upload upload-icon); re-upload it before publishing.')
    })

    it('turns hash mismatches into permanent input errors', () => {
        const error = snapshotAssetError(
            'FF1',
            'launcher logo',
            'upload-logo',
            new StorageObjectIntegrityError('private/logo.png')
        )

        expect(error).toBeInstanceOf(PermanentJobError)
    })

    it('keeps RustFS network failures retryable', () => {
        const error = new Error('RustFS 503')
        expect(snapshotAssetError('FF1', 'icon', 'upload-icon', error)).toBe(error)
    })
})
