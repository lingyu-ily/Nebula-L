import 'dotenv/config'
import { buildApp } from './app.js'
import { getConfig } from './config.js'
import { closeDatabase } from './db/index.js'
import { migrateDatabase } from './db/migrate.js'
import { LauncherUsageMaintenance } from './launcher-usage.js'
import { JobWorker } from './publisher.js'
import { ProjectDeletionWorker } from './project-deletion.js'
import { PublishCleanupWorker } from './publish-cleanup.js'
import { destroyStorage } from './storage.js'

const config = getConfig()
await migrateDatabase()
const app = await buildApp()
const launcherUsageMaintenance = new LauncherUsageMaintenance(error => {
    app.log.error(error, 'Launcher usage maintenance failed')
})
const worker = new JobWorker()
const projectDeletionWorker = new ProjectDeletionWorker()
const publishCleanupWorker = new PublishCleanupWorker(error => app.log.error(error, 'Publish storage cleanup failed'))
if (config.workerEnabled) {
    worker.start()
    projectDeletionWorker.start()
    publishCleanupWorker.start()
}
launcherUsageMaintenance.start()

async function shutdown(signal: string): Promise<void> {
    app.log.info({ signal }, 'Graceful shutdown')
    worker.stop()
    projectDeletionWorker.stop()
    publishCleanupWorker.stop()
    launcherUsageMaintenance.stop()
    await app.close()
    await closeDatabase()
    await destroyStorage()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: config.host, port: config.port })
