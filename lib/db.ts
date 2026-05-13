import 'server-only'

import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

declare global {
  // eslint-disable-next-line no-var
  var __studioOpsSqlClient: ReturnType<typeof postgres> | undefined
}

export const sql =
  globalThis.__studioOpsSqlClient ??
  postgres(databaseUrl, {
    max: 1,
  })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__studioOpsSqlClient = sql
}
