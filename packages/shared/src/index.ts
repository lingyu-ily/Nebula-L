import { z } from 'zod'

export const roleSchema = z.enum(['ADMIN', 'EDITOR', 'AUDITOR'])
export type Role = z.infer<typeof roleSchema>

export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED'])
export type UserStatus = z.infer<typeof userStatusSchema>

export const loginSchema = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(1024)
})

export const passwordSchema = z.string().min(12).max(256)

export const createUserSchema = z.object({
    username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
    password: passwordSchema,
    role: roleSchema
})

export const updateUserSchema = z.object({
    role: roleSchema.optional(),
    status: userStatusSchema.optional()
}).refine(value => value.role != null || value.status != null, 'No changes supplied')

export const discordSchema = z.object({
    clientId: z.string().max(64),
    smallImageText: z.string().max(128),
    smallImageKey: z.string().max(128)
})

export const serverDiscordSchema = z.object({
    shortId: z.string().max(64),
    largeImageText: z.string().max(128),
    largeImageKey: z.string().max(128)
})

export const projectInputSchema = z.object({
    name: z.string().trim().min(1).max(128),
    slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(2000).default(''),
    rss: z.union([z.url(), z.literal('')]).default(''),
    discord: discordSchema.nullable().optional()
})

const ramSchema = z.object({
    minimum: z.number().int().positive().multipleOf(512),
    recommended: z.number().int().positive().multipleOf(512)
}).refine(value => value.recommended >= value.minimum, {
    message: 'Recommended RAM must be greater than or equal to minimum RAM'
})

export const javaOptionsSchema = z.object({
    supported: z.string().max(128).optional(),
    suggestedMajor: z.number().int().min(8).max(99).optional(),
    ram: ramSchema.optional()
}).refine(value => value.supported == null || value.suggestedMajor != null, {
    message: 'suggestedMajor is required when supported is supplied'
})

export const serverInputSchema = z.object({
    serverKey: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(128),
    description: z.string().max(2000).default(''),
    minecraftVersion: z.string().trim().min(1).max(32),
    serverVersion: z.string().trim().min(1).max(64),
    address: z.string().trim().min(1).max(255),
    discord: serverDiscordSchema.nullable().optional(),
    forgeVersion: z.string().trim().max(64).nullable().optional(),
    fabricVersion: z.string().trim().max(64).nullable().optional(),
    mainServer: z.boolean().default(false),
    autoconnect: z.boolean().default(false),
    sortOrder: z.number().int().min(0).default(0),
    javaOptions: javaOptionsSchema.nullable().optional(),
    iconUploadId: z.uuid().nullable().optional(),
    untrackedRules: z.array(z.object({
        appliesTo: z.enum(['files', 'libraries', 'forgemods', 'fabricmods']),
        pattern: z.string().trim().min(1).max(512)
    })).default([])
}).refine(value => !(value.forgeVersion && value.fabricVersion), {
    message: 'Forge and Fabric are mutually exclusive'
})

export const versionCatalogLoaderSchema = z.enum(['forge', 'fabric'])
export type VersionCatalogLoader = z.infer<typeof versionCatalogLoaderSchema>

export const loaderCatalogQuerySchema = z.object({
    loader: versionCatalogLoaderSchema,
    minecraftVersion: z.string().trim().min(1).max(32)
})

export const minecraftVersionOptionSchema = z.object({
    value: z.string(),
    type: z.literal('release'),
    releaseTime: z.string()
})

export const loaderVersionOptionSchema = z.object({
    value: z.string(),
    recommended: z.boolean(),
    latest: z.boolean(),
    stable: z.boolean()
})

export const minecraftCatalogResponseSchema = z.object({
    versions: z.array(minecraftVersionOptionSchema),
    stale: z.boolean()
})
export type MinecraftCatalogResponse = z.infer<typeof minecraftCatalogResponseSchema>

export const loaderCatalogResponseSchema = z.object({
    loader: versionCatalogLoaderSchema,
    minecraftVersion: z.string(),
    versions: z.array(loaderVersionOptionSchema),
    stale: z.boolean()
})
export type LoaderCatalogResponse = z.infer<typeof loaderCatalogResponseSchema>

export const moduleTypeSchema = z.enum(['ForgeMod', 'FabricMod', 'Library', 'File'])
export const optionalModeSchema = z.enum(['REQUIRED', 'OPTIONAL_ON', 'OPTIONAL_OFF'])

export function isSafeRelativePath(candidate: string): boolean {
    if (candidate.length === 0 || candidate.startsWith('/') || candidate.startsWith('\\')) {
        return false
    }
    if (/^[A-Za-z]:/.test(candidate) || candidate.includes('\\')) {
        return false
    }
    const segments = candidate.split('/')
    return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

export const moduleInputSchema = z.object({
    uploadId: z.uuid(),
    type: moduleTypeSchema,
    displayName: z.string().trim().min(1).max(255),
    moduleId: z.string().trim().max(512).nullable().optional(),
    relativePath: z.string().trim().max(1024).nullable().optional(),
    optionalMode: optionalModeSchema.default('REQUIRED'),
    sortOrder: z.number().int().min(0).default(0)
}).superRefine((value, context) => {
    if (value.type === 'File' && (!value.relativePath || !isSafeRelativePath(value.relativePath))) {
        context.addIssue({
            code: 'custom',
            path: ['relativePath'],
            message: 'File modules require a safe relative POSIX path'
        })
    }
    if ((value.type === 'Library' || value.type === 'File') && value.optionalMode !== 'REQUIRED') {
        context.addIssue({
            code: 'custom',
            path: ['optionalMode'],
            message: 'Only mod modules may be optional'
        })
    }
})

export const publishSchema = z.object({
    revision: z.number().int().nonnegative()
})

export const curseForgeImportSchema = z.object({
    uploadId: z.uuid(),
    serverKey: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
})

export interface ApiUser {
    id: string
    username: string
    role: Role
    status: UserStatus
    mustChangePassword: boolean
}

export interface ApiProblem {
    type: string
    title: string
    status: number
    detail?: string
    requestId?: string
    errors?: unknown
}
