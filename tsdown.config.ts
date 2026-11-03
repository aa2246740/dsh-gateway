import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const vendored = fileURLToPath(new URL('./tools/client-build.js', import.meta.url))

function resolveHarnessAdapter(): string {
  const configured = process.env.DSHX_HARNESS?.trim()
  if (configured) return join(resolve(configured), 'tools/dshx/src/client-build.js')
  const configPath = join(homedir(), '.config/dshx/harness')
  const recorded = existsSync(configPath) ? readFileSync(configPath, 'utf8').trim() : undefined
  if (!recorded) {
    throw new Error('dshx client build requires a Harness root from DSHX_HARNESS or ~/.config/dshx/harness')
  }
  process.env.DSHX_HARNESS = resolve(recorded)
  return join(process.env.DSHX_HARNESS, 'tools/dshx/src/client-build.js')
}

// Vendored tools/client-build.js reads the target platform table at import time.
const harnessAdapter = resolveHarnessAdapter()
const adapter = existsSync(vendored) ? vendored : harnessAdapter
if (!existsSync(adapter)) throw new Error(`dshx client build adapter not found: ${adapter}`)
const { externalClientBundle } = await import(pathToFileURL(adapter).href)

export default externalClientBundle('dsh-messaging-gateway', ['lib/types/dsh-messaging-gateway.js'], {
  clientEntry: 'src/client/index.tsx',
})
