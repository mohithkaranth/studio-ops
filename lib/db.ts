import 'server-only'

import postgres from 'postgres'

let sqlClient: ReturnType<typeof postgres> | undefined

function getSqlClient() {
  if (sqlClient) return sqlClient

  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  sqlClient =
    globalThis.__studioOpsSqlClient ??
    postgres(databaseUrl, {
      max: 1,
    })

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__studioOpsSqlClient = sqlClient
  }

  return sqlClient
}

declare global {
  var __studioOpsSqlClient: ReturnType<typeof postgres> | undefined
}

const sqlProxyTarget = function sqlProxy() {} as unknown as ReturnType<typeof postgres>

export const sql = new Proxy(
  sqlProxyTarget,
  {
    apply(_target, _thisArg, argArray) {
      return getSqlClient()(...(argArray as Parameters<ReturnType<typeof postgres>>))
    },
    get(_target, prop, receiver) {
      const value = Reflect.get(getSqlClient(), prop, receiver)
      return typeof value === 'function' ? value.bind(getSqlClient()) : value
    },
  },
) as ReturnType<typeof postgres>
