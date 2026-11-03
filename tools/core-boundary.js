/** Plugin-only boundary. Reading public Host APIs is allowed; writing official
 * source, copies, worktrees, installed packages or generated artifacts is not. */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export const CORE_SOURCE_IMMUTABLE = 'CORE_SOURCE_IMMUTABLE'
export const PLUGIN_ONLY_RULE = 'DSHX and Creator Mode+ develop external plugins only. Never edit, patch, replace or rebuild DeepSeek Harness official source, shipped presets, installed official packages or their generated artifacts, including copies and worktrees. A missing public API is a plugin capability gap: use another public extension point or report the gap. A plugin task, handoff document, automatic approval, takeover or --force never authorizes a Host patch. Keep all build output inside the plugin. Watched user cordis.patch.yml configuration is not a source-code patch.'
const deny = detail => `${CORE_SOURCE_IMMUTABLE}: ${detail}. Use a public plugin extension point; do not patch the Host or retry with force/approval.`
const under = (parent, child) => { const r = relative(parent, child); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)) }
function manifest(dir) { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { return undefined } }

/** Resolve existing components before ..; also protects a not-yet-created file. */
export function canonicalTarget(path, cwd = process.cwd()) {
  const absolute = isAbsolute(path) ? path : `${cwd}${sep}${path}`
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split(sep)) {
    if (!part || part === '.') continue
    if (part === '..') { current = dirname(current); continue }
    current = join(current, part)
    try { current = realpathSync.native(current) }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
  }
  return current
}
function isHarness(dir) {
  return manifest(dir)?.name === '@deepseek-ai/dsh-root'
    || (existsSync(join(dir, 'apps/cli/src/bin.ts')) && existsSync(join(dir, 'packages')) && existsSync(join(dir, 'vendor')))
}
function inHarnessSource(path, root) {
  if (!under(root, path)) return false
  const rel = relative(root, path).split(sep)
  // Official tree surfaces are protected; sibling, independent external
  // plugin directories remain supported. Real targets are resolved first.
  if (rel.length === 1 && (rel[0] === '' || !existsSync(path) || !lstatSync(path).isDirectory())) return true
  return ['apps', 'packages', 'vendor', 'scripts', 'config', 'configs', 'src',
    'docs', 'assets', 'patches', 'benchmarks', 'native', 'python', 'snapshots', 'website', '.git', '.agents', '.github'].includes(rel[0])
}
export function coreWriteReason(path, harnessRoot, cwd) {
  const target = canonicalTarget(path, cwd)
  if (harnessRoot && inHarnessSource(target, canonicalTarget(harnessRoot))) return deny(`protected Harness path ${target}`)
  let cursor = target
  while (true) {
    const pkg = manifest(cursor)
    if (typeof pkg?.name === 'string' && pkg.name.startsWith('@deepseek-ai/') && pkg.name !== '@deepseek-ai/dsh-root') return deny(`official package ${pkg.name}: ${target}`)
    if (isHarness(cursor) && inHarnessSource(target, cursor)) return deny(`official checkout or worktree ${cursor}: ${target}`)
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}
export function assertPluginSource(harnessRoot, dir, entry) {
  const reason = coreWriteReason(dir, harnessRoot)
  if (reason) throw new Error(reason)
  if (entry) {
    const target = canonicalTarget(entry)
    const denied = coreWriteReason(target, harnessRoot)
    if (denied) throw new Error(denied)
    if (!under(canonicalTarget(dir), target)) throw new Error(deny(`plugin entry escapes its source directory: ${entry}`))
  }
}
const PATCH_TARGET = /^(?:\+\+\+|---)\s+(?:[ab]\/)?(?:packages|apps|vendor|scripts|config)\/|^\*\*\* (?:Update|Add|Delete) File:\s*(?:[ab]\/)?(?:packages|apps|vendor|scripts|config)\//m
const SKIP = new Set(['node_modules', 'lib', 'dist', 'out', 'coverage', 'tests', 'test', 'fixtures'])
/** Release gate for concrete Host patches and compiler writes; not a proof that
 * arbitrary third-party programs are safe. Never executes plugin scripts. */
export function auditPluginSource(harnessRoot, dir) {
  const findings = []
  assertPluginSource(harnessRoot, dir)
  let count = 0
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      if (++count > 10000) throw new Error(deny('plugin boundary inventory exceeds 10000 files'))
      const path = join(folder, entry.name)
      if (entry.isSymbolicLink()) {
        const reason = coreWriteReason(path, harnessRoot)
        if (reason) findings.push({ path, message: reason })
        continue
      }
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.isFile() || lstatSync(path).size > 1024 * 1024) continue
      if (/\.(patch|diff)$/.test(entry.name) && PATCH_TARGET.test(readFileSync(path, 'utf8'))) {
        findings.push({ path, message: deny('plugin contains a patch targeting official Host files') })
      }
      if (/^tsconfig.*\.json$/.test(entry.name)) {
        // Conservative JSONC extraction: relevant path strings only, no code.
        const source = readFileSync(path, 'utf8')
        for (const match of source.matchAll(/"(?:outDir|outFile|declarationDir|tsBuildInfoFile)"\s*:\s*"([^"\n]+)"/g)) {
          const output = canonicalTarget(match[1], folder)
          if (!under(canonicalTarget(dir), output)) findings.push({ path, message: deny(`TypeScript output escapes the plugin: ${match[1]}`) })
        }
        const refs = source.match(/"references"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
        for (const match of refs.matchAll(/"path"\s*:\s*"([^"\n]+)"/g)) {
          const reason = coreWriteReason(match[1], harnessRoot, folder)
          if (reason) findings.push({ path, message: deny(`TypeScript project reference can rebuild official source: ${match[1]}`) })
        }
      }
    }
  }
  walk(dir)
  return findings
}

function readOnlyShell(command) {
  if (/[;&|`$><\n]/.test(command)) return false
  if (/^\s*(?:cat|head|tail|ls|pwd|stat|realpath|readlink|rg)\b/.test(command)) return !/--pre\b/.test(command)
  return /^\s*git\s+(?:(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+))?(?:status|diff|show|log|ls-files|rev-parse)\b/.test(command)
    && !/--(?:ext-diff|textconv|output|exec-path)\b/.test(command)
}
export function creatorCoreMutationReason(exec, harnessRoot, policy) {
  const args = exec?.arguments ?? {}, cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
  if (['write', 'edit', 'write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file'].includes(exec?.name)) {
    for (const key of ['file_path', 'path', 'destination', 'source', 'target']) {
      if (typeof args[key] === 'string') { const reason = coreWriteReason(args[key], harnessRoot, cwd); if (reason) return reason }
    }
    return undefined
  }
  if (exec?.name === 'apply_patch') {
    const patch = args.patch ?? args.input ?? ''
    for (const match of patch.matchAll(/^\*\*\* (?:(?:Update|Add|Delete) File|Move to):\s*(.+)$/gm)) {
      const reason = coreWriteReason(match[1], harnessRoot, cwd); if (reason) return reason
    }
    return undefined
  }
  if (!['bash', 'terminal_open', 'terminal_send'].includes(exec?.name)) return undefined
  const command = args.command ?? args.text ?? ''
  if (readOnlyShell(command)) return undefined
  if (args.sandbox_permissions === 'danger-full-access') return deny('unconfined shell execution cannot protect official source')
  if (!policy || !['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode)) {
    return `CREATOR_SANDBOX_UNAVAILABLE: cannot verify a confined shell policy${policy?.unavailableReason ? ` (${policy.unavailableReason})` : ''}. The command was not executed. Repair Creator Mode+ sandbox service wiring; this is not evidence of an official-source write.`
  }
  if (exec.name === 'bash' && policy.shellConfined === false) return deny('the active shell executor does not enforce the sandbox policy')
  if (policy?.mode === 'danger-full-access') return deny('switch Creator shell to workspace-write so the Host sandbox confines build scripts')
  if (policy?.mode === 'workspace-write' && harnessRoot && under(canonicalTarget(policy.workspaceRoot), canonicalTarget(harnessRoot))) return deny('the shell workspace contains the official Harness; use a plugin-only workspace')
  const workdir = canonicalTarget(args.workdir ?? args.cwd ?? cwd, cwd)
  const atCore = coreWriteReason(workdir, harnessRoot)
  if (atCore) return atCore
  if (/\b(?:install-host-seam|patch-host|host-patches)(?:[/.\s]|$)/.test(command)) return deny('Host patch installation is outside plugin development')
  for (const match of command.matchAll(/\/(?:[^\s"'`()[\]{};,<>|]+)/g)) {
    const reason = coreWriteReason(match[0], harnessRoot, workdir)
    if (reason) return reason
  }
  // This catches direct shell/REPL targets and git -C. The Host sandbox remains
  // responsible for code that assembles a path dynamically.
  for (const match of command.matchAll(/"([^"\n]+)"|'([^'\n]+)'|([^\s;|&()<>]+)/g)) {
    const token = match[1] ?? match[2] ?? match[3]
    if (!token.includes('/') || token.includes('://')) continue
    const reason = coreWriteReason(token.replace(/^[\w]+=/, ''), harnessRoot, workdir)
    if (reason) return reason
  }
  return undefined
}
