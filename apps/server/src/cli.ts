import 'dotenv/config'
import { readFile } from 'fs/promises'
import { createAdmin } from './auth.js'
import { closeDatabase } from './db/index.js'
import { migrateDatabase } from './db/migrate.js'

async function getAdminPassword(): Promise<string> {
    if (process.env.NEBULA_ADMIN_PASSWORD_FILE) {
        return (await readFile(process.env.NEBULA_ADMIN_PASSWORD_FILE, 'utf8')).trim()
    }
    if (process.env.NEBULA_ADMIN_PASSWORD) {
        return process.env.NEBULA_ADMIN_PASSWORD
    }
    throw new Error('Set NEBULA_ADMIN_PASSWORD or NEBULA_ADMIN_PASSWORD_FILE')
}

const command = process.argv[2]
try {
    if (command === 'db:migrate') {
        await migrateDatabase()
        process.stdout.write('Database migrations applied.\n')
    } else if (command === 'admin:create') {
        await migrateDatabase()
        const username = process.env.NEBULA_ADMIN_USERNAME ?? 'admin'
        const id = await createAdmin(username, await getAdminPassword())
        process.stdout.write(`Created administrator ${username} (${id}).\n`)
    } else {
        throw new Error('Usage: cli.ts db:migrate | admin:create')
    }
} finally {
    await closeDatabase()
}
