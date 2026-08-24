export interface UploadBatchFile {
    file: File
    relativePath: string
}

export interface DroppedTree {
    directories: string[]
    files: UploadBatchFile[]
}

interface DroppedFileSystemEntry {
    isFile: boolean
    isDirectory: boolean
    name: string
}

interface DroppedFileSystemFileEntry extends DroppedFileSystemEntry {
    file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void
}

interface DroppedFileSystemDirectoryReader {
    readEntries: (
        success: (entries: DroppedFileSystemEntry[]) => void,
        failure?: (error: DOMException) => void
    ) => void
}

interface DroppedFileSystemDirectoryEntry extends DroppedFileSystemEntry {
    createReader: () => DroppedFileSystemDirectoryReader
}

function droppedEntry(item: DataTransferItem): DroppedFileSystemEntry | null {
    return (item as DataTransferItem & {
        webkitGetAsEntry?: () => DroppedFileSystemEntry | null
    }).webkitGetAsEntry?.() ?? null
}

export function hasDroppedDirectory(items: DataTransferItemList): boolean {
    return Array.from(items).some(item => droppedEntry(item)?.isDirectory === true)
}

function readDroppedFile(entry: DroppedFileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function readDroppedDirectory(entry: DroppedFileSystemDirectoryEntry): Promise<DroppedFileSystemEntry[]> {
    const reader = entry.createReader()
    const entries: DroppedFileSystemEntry[] = []
    while (true) {
        const batch = await new Promise<DroppedFileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject)
        )
        if (batch.length === 0) return entries
        entries.push(...batch)
    }
}

async function collectDroppedEntry(
    entry: DroppedFileSystemEntry,
    parent: string,
    result: DroppedTree
): Promise<void> {
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.isFile) {
        result.files.push({
            file: await readDroppedFile(entry as DroppedFileSystemFileEntry),
            relativePath
        })
        return
    }
    if (!entry.isDirectory) return
    result.directories.push(relativePath)
    const children = await readDroppedDirectory(entry as DroppedFileSystemDirectoryEntry)
    for (const child of children) {
        await collectDroppedEntry(child, relativePath, result)
    }
}

export async function collectDroppedTree(items: DataTransferItemList): Promise<DroppedTree | null> {
    const entries = Array.from(items)
        .filter(item => item.kind === 'file')
        .map(droppedEntry)
    if (entries.length === 0 || entries.some(entry => entry == null)) return null
    const result: DroppedTree = { directories: [], files: [] }
    for (const entry of entries) {
        await collectDroppedEntry(entry!, '', result)
    }
    return result
}
