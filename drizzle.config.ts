import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required')

export default defineConfig({
  schema: './src/state/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url,
    authToken,
  },
})
