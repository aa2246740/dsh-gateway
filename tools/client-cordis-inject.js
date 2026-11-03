/** Static guard for Cordis service reads in an external Web client entry. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

// Context members and Cordis mixins are available without plugin service inject.
const CORE_CONTEXT_MEMBERS = new Set([
  'accessor',
  'baseUrl',
  'bail',
  'effect',
  'emit',
  'events',
  'extend',
  'fiber',
  'get',
  'inject',
  'intercept',
  'isolate',
  'logger',
  'mixin',
  'on',
  'once',
  'parallel',
  'plugin',
  'provide',
  'reflect',
  'registry',
  'root',
  'runtime',
  'serial',
  'set',
  'waterfall',
])

function unwrap(expression) {
  let current = expression
  while (ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function exportedInject(source) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'inject') continue
      if (!declaration.initializer) return { declared: new Set(), static: false }
      const initializer = unwrap(declaration.initializer)
      if (!ts.isArrayLiteralExpression(initializer)) return { declared: new Set(), static: false }
      const declared = new Set()
      for (const element of initializer.elements) {
        const value = unwrap(element)
        if (!ts.isStringLiteralLike(value)) return { declared, static: false }
        declared.add(value.text)
      }
      return { declared, static: true }
    }
  }
  return { declared: new Set(), static: true }
}

function contextNames(source) {
  const names = new Set()
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement)
      || statement.name?.text !== 'apply'
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    const parameter = statement.parameters[0]
    if (parameter && ts.isIdentifier(parameter.name)) names.add(parameter.name.text)
  }

  let changed = true
  while (changed) {
    changed = false
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && ts.isIdentifier(unwrap(node.initializer))
        && names.has(unwrap(node.initializer).text)
        && !names.has(node.name.text)) {
        names.add(node.name.text)
        changed = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return names
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
}

/**
 * Compare direct Cordis service reads with the client entry's exported inject.
 * @param {string} path absolute client source entry.
 * @returns {{ path: string, declared: string[], accessed: string[], missing: string[], staticInject: boolean }}
 */
export function inspectClientCordisInject(path) {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const { declared, static: staticInject } = exportedInject(source)
  const contexts = contextNames(source)
  const accessed = new Set()

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && contexts.has(node.expression.text)
      && !CORE_CONTEXT_MEMBERS.has(node.name.text)) {
      accessed.add(node.name.text)
    }
    if (ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && contexts.has(node.expression.text)
      && node.argumentExpression) {
      const name = propertyName(unwrap(node.argumentExpression))
      if (name && !CORE_CONTEXT_MEMBERS.has(name)) accessed.add(name)
    }
    if (ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && ts.isIdentifier(unwrap(node.initializer))
      && contexts.has(unwrap(node.initializer).text)) {
      for (const element of node.name.elements) {
        const name = propertyName(element.propertyName ?? element.name)
        if (name && !CORE_CONTEXT_MEMBERS.has(name)) accessed.add(name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  const sorted = values => [...values].sort()
  return {
    path,
    declared: sorted(declared),
    accessed: sorted(accessed),
    missing: sorted([...accessed].filter(name => !declared.has(name))),
    staticInject,
  }
}

/** Resolve the source entry declared by the dshx client build adapter. */
export function resolveClientSource(pluginDir) {
  const configPath = join(pluginDir, 'tsdown.config.ts')
  if (existsSync(configPath)) {
    const config = readFileSync(configPath, 'utf8')
    const match = config.match(/\bclientEntry\s*:\s*(['"])([^'"]+)\1/u)
    if (match) return { path: resolve(pluginDir, match[2]), declared: true }
  }
  for (const candidate of ['src/client/index.tsx', 'src/client/index.ts', 'src/client/index.jsx', 'src/client/index.js']) {
    const path = join(pluginDir, candidate)
    if (existsSync(path)) return { path, declared: false }
  }
}

/** Fail a client build before emitting a bundle with undeclared service reads. */
export function assertClientCordisInject(packageRoot, clientEntry) {
  const path = resolve(packageRoot, clientEntry)
  if (!existsSync(path)) return
  const result = inspectClientCordisInject(path)
  if (!result.staticInject) {
    throw new Error(`dshx client build: ${clientEntry} must export a static string-literal Cordis inject array`)
  }
  if (result.missing.length > 0) {
    throw new Error(
      `dshx client build: ${clientEntry} reads undeclared Cordis service ${JSON.stringify(result.missing[0])}; `
      + `add it to the entry-level export const inject (missing: ${result.missing.join(', ')}). `
      + 'package.json dsh.client.inject is package metadata and cannot satisfy Cordis services',
    )
  }
}
