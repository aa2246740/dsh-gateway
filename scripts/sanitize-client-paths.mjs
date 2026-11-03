import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const output = resolve('lib/client.js')
const source = await readFile(output, 'utf8')
const prefix = `${process.cwd()}/`
await writeFile(output, source.replaceAll(prefix, ''))
