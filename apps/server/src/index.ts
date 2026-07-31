import 'dotenv/config'
import { buildApp } from './app.js'
import { getConfig } from './config.js'
import { closeDatabase } from './db/index.js'
import { migrateDatabase } from './db/migrate.js'
import { JobWorker } from './publisher.js'
import { destroyStorage } from './storage.js'

const config = getConfig()
await migrateDatabase()
const app = await buildApp()
const worker = new JobWorker()
if (config.workerEnabled) {
    worker.start()
}

async function shutdown(signal: string): Promise<void> {
    app.log.info({ signal }, 'Graceful shutdown')
    worker.stop()
    await app.close()
    await closeDatabase()
    await destroyStorage()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: config.host, port: config.port })
