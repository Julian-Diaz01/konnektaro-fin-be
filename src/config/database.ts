import { Pool, PoolConfig } from 'pg'

// Support both connection string (Supabase) and individual parameters
function getDbConfig (): PoolConfig {
  // If DATABASE_URL is provided (Supabase connection string), use it
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
    }
  }

  // Otherwise, use individual parameters
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  }
}

const dbConfig = getDbConfig()

// Create a connection pool
export const pool = new Pool(dbConfig)

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

// Test database connection
export async function testConnection (): Promise<boolean> {
  try {
    const client = await pool.connect()
    const result = await client.query('SELECT NOW()')
    console.log('✅ Database connected successfully:', result.rows[0].now)
    client.release()
    return true
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    return false
  }
}

// Graceful shutdown
export async function closePool (): Promise<void> {
  await pool.end()
  console.log('Database pool closed')
}

