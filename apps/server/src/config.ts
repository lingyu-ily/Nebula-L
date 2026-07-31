import { z } from 'zod'

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_BASE_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    COOKIE_SECRET: z.string().min(32),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    RUSTFS_ENDPOINT: z.url(),
    RUSTFS_REGION: z.string().default('us-east-1'),
    RUSTFS_BUCKET: z.string().min(3),
    RUSTFS_ACCESS_KEY_ID: z.string().min(1),
    RUSTFS_SECRET_ACCESS_KEY: z.string().min(1),
    RUSTFS_PUBLIC_BASE_URL: z.url(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
    WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
    WORKER_POLL_MS: z.coerce.number().int().min(250).default(2000),
    JAVA_EXECUTABLE: z.string().default('java'),
    CURSEFORGE_API_KEY: z.string().optional()
})

export interface AppConfig {
    nodeEnv: 'development' | 'test' | 'production'
    host: string
    port: number
    appBaseUrl: string
    databaseUrl: string
    cookieSecret: string
    cookieSecure: boolean
    trustProxy: boolean
    rustfs: {
        endpoint: string
        region: string
        bucket: string
        accessKeyId: string
        secretAccessKey: string
        publicBaseUrl: string
    }
    maxUploadBytes: number
    workerEnabled: boolean
    workerPollMs: number
    javaExecutable: string
}

let cachedConfig: AppConfig | undefined

export function getConfig(): AppConfig {
    if (cachedConfig) {
        return cachedConfig
    }
    const env = envSchema.parse(process.env)
    const appBaseUrl = env.APP_BASE_URL.replace(/\/$/, '')
    const publicBaseUrl = env.RUSTFS_PUBLIC_BASE_URL.replace(/\/$/, '')
    cachedConfig = {
        nodeEnv: env.NODE_ENV,
        host: env.HOST,
        port: env.PORT,
        appBaseUrl,
        databaseUrl: env.DATABASE_URL,
        cookieSecret: env.COOKIE_SECRET,
        cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
        trustProxy: env.TRUST_PROXY === 'true',
        rustfs: {
            endpoint: env.RUSTFS_ENDPOINT,
            region: env.RUSTFS_REGION,
            bucket: env.RUSTFS_BUCKET,
            accessKeyId: env.RUSTFS_ACCESS_KEY_ID,
            secretAccessKey: env.RUSTFS_SECRET_ACCESS_KEY,
            publicBaseUrl
        },
        maxUploadBytes: env.MAX_UPLOAD_BYTES,
        workerEnabled: env.WORKER_ENABLED === 'true',
        workerPollMs: env.WORKER_POLL_MS,
        javaExecutable: env.JAVA_EXECUTABLE
    }
    return cachedConfig
}
