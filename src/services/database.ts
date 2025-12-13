import sql from '../config/database.js'

export async function testConnection () {
  try {
    const result = await sql`SELECT NOW() as now`
    return {
      success: true,
      timestamp: result[0].now
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function closeConnection () {
  await sql.end()
}

export { sql }

