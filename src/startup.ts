import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

// Start Cloudflare tunnel if credentials exist
const tunnelUuid = process.env.CLOUDFLARE_TUNNEL_UUID
const credentialsPath = join('/app', '.cloudflared', 'credentials.json')
const configPath = join('/app', '.cloudflared', 'config.yml')

if (tunnelUuid && existsSync(credentialsPath)) {
  console.log('🚇 Starting Cloudflare tunnel...')
  
  const tunnel = spawn('cloudflared', [
    'tunnel',
    '--config',
    configPath,
    'run'
  ], {
    stdio: 'inherit',
    detached: true
  })

  // Unref to allow Node.js to exit if only tunnel is running
  tunnel.unref()

  tunnel.on('error', (error) => {
    console.error('❌ Cloudflare tunnel error:', error)
  })

  tunnel.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`⚠️  Cloudflare tunnel exited with code ${code}`)
    }
  })
} else {
  if (!tunnelUuid) {
    console.log('ℹ️  No Cloudflare tunnel UUID configured')
  } else {
    console.log('⚠️  Cloudflare tunnel credentials not found')
  }
}

// Start the main application
import('./index.js')

