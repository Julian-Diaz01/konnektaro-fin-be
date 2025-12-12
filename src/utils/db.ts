import { pool } from '../config/database.js'
import type { QueryResult, QueryResultRow } from 'pg'

/**
 * Execute a database query
 * @param text SQL query string
 * @param params Query parameters
 * @returns Query result
 */
export async function query<T extends QueryResultRow = any> (
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now()
  try {
    const result = await pool.query<T>(text, params)
    const duration = Date.now() - start
    console.log('Executed query', { text, duration, rows: result.rowCount })
    return result
  } catch (error) {
    console.error('Query error', { text, error })
    throw error
  }
}

/**
 * Get a client from the pool for transactions
 * @returns Database client
 */
export async function getClient () {
  return await pool.connect()
}

