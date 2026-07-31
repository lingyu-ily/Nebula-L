import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'mysql',
    schema: './src/db/schema.ts',
    out: './migrations',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'mysql://nebula:nebula@localhost:3306/nebula'
    }
})
