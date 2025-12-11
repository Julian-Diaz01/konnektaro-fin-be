import admin, { ServiceAccount, auth as firebaseAuth } from 'firebase-admin'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadCredentialsFromFile (path: string): ServiceAccount | null {
  const resolvedPath = resolve(path)
  if (!existsSync(resolvedPath)) return null

  try {
    return JSON.parse(readFileSync(resolvedPath, 'utf8')) as ServiceAccount
  } catch {
    return null
  }
}

function loadCredentialsFromEnv (): ServiceAccount | null {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return null
  }

  return {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  } as ServiceAccount
}

function getCredentials (): ServiceAccount | null {
  // Try environment variable path first
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (envPath) {
    const creds = loadCredentialsFromFile(envPath)
    if (creds) return creds
  }

  // Try default location in project root
  const defaultPath = './firebase-service-account.json'
  const defaultCreds = loadCredentialsFromFile(defaultPath)
  if (defaultCreds) return defaultCreds

  // Try environment variables
  return loadCredentialsFromEnv()
}

let firebaseApp: admin.app.App | null = null

function getFirebaseApp (): admin.app.App {
  if (admin.apps.length) {
    return admin.app()
  }

  const credentials = getCredentials()
  if (!credentials) {
    throw new Error(
      'Firebase credentials not configured.'
    )
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(credentials)
  })

  return firebaseApp
}

export function getAuth (): firebaseAuth.Auth {
  return getFirebaseApp().auth()
}

// Lazy getter for auth - only initializes when accessed
export const auth: { verifyIdToken: (token: string) => Promise<admin.auth.DecodedIdToken> } = {
  verifyIdToken: async (token: string) => getAuth().verifyIdToken(token)
}
