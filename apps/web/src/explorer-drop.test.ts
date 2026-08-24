import { describe, expect, it } from 'vitest'
import { collectDroppedTree, hasDroppedDirectory } from './explorer-drop.js'

describe('Explorer folder drops', () => {
    it('reads every directory batch and preserves nested empty folders', async () => {
        const note = new File(['note'], 'note.txt', { type: 'text/plain' })
        const fileEntry = {
            name: 'note.txt',
            isFile: true,
            isDirectory: false,
            file: (success: (file: File) => void): void => success(note)
        }
        const emptyEntry = {
            name: 'empty',
            isFile: false,
            isDirectory: true,
            createReader: (): { readEntries: (success: (entries: unknown[]) => void) => void } => ({
                readEntries: (success: (entries: unknown[]) => void): void => success([])
            })
        }
        const rootEntry = {
            name: 'pack',
            isFile: false,
            isDirectory: true,
            createReader: (): { readEntries: (success: (entries: unknown[]) => void) => void } => {
                const batches = [[fileEntry], [emptyEntry], []]
                let index = 0
                return {
                    readEntries: (success: (entries: unknown[]) => void): void => {
                        success(batches[index++] ?? [])
                    }
                }
            }
        }
        const items = [{
            kind: 'file',
            webkitGetAsEntry: (): unknown => rootEntry
        }] as unknown as DataTransferItemList

        expect(hasDroppedDirectory(items)).toBe(true)
        const result = await collectDroppedTree(items)

        expect(result?.directories).toEqual(['pack', 'pack/empty'])
        expect(result?.files).toEqual([{ file: note, relativePath: 'pack/note.txt' }])
    })

    it('reports an unavailable directory API instead of flattening the drop', async () => {
        const items = [{ kind: 'file' }] as unknown as DataTransferItemList

        expect(hasDroppedDirectory(items)).toBe(false)
        await expect(collectDroppedTree(items)).resolves.toBeNull()
    })
})
