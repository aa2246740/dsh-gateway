import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.env.DSHX_HARNESS
if (!root) throw new Error('Set DSHX_HARNESS to the checkout used for this build.')
const adapter = resolve(root, 'tools/dshx/src/client-build.js')
if (!existsSync(adapter)) throw new Error('DSHX externalClientBundle adapter is missing.')
const { externalClientBundle } = await import(pathToFileURL(adapter).href)

export default externalClientBundle('dsh-messaging-gateway', ['lib/types/dsh-messaging-gateway.js'], {
  clientEntry: 'src/client/index.tsx',
})
