import sql from '../config/database.js'

export async function transaction<T> (
  callback: (txSql: typeof import('../config/database.js').default) => Promise<T>
): Promise<T> {
  try {
    const result = await sql.begin(async txSql => {
      return await callback(txSql)
    })
    return result as T
  } catch (err) {
    throw err
  }
}