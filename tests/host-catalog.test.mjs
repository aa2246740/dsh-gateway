import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCatalog, formatHelp, mergeUserSkills, skillListViews, slashesFromCatalog } from '../lib/types/host-catalog.js'

test('buildCatalog lets host commands win over skills of the same name', () => {
  const catalog = buildCatalog(
    [{ name: 'goal', description: 'Host goal' }],
    [{ name: 'goal', description: 'Skill goal' }, { name: 'my-skill', description: 'Does a thing' }],
  )
  const goal = catalog.commands.find(spec => spec.name === 'goal')
  const skill = catalog.commands.find(spec => spec.name === 'my-skill')
  assert.equal(goal.source, 'command')
  assert.equal(goal.description, 'Host goal')
  assert.equal(skill.source, 'skill')
  assert.match(formatHelp(catalog), /Skills:/)
  assert.match(formatHelp(catalog), /\/my-skill/)
})

test('slashesFromCatalog always starts with /dsh and includes live names', () => {
  const catalog = buildCatalog([], [{ name: 'my-skill', description: 'Does a thing' }])
  const slashes = slashesFromCatalog(catalog)
  assert.equal(slashes[0].command, '/dsh')
  assert.equal(slashes.some(item => item.command === '/model'), true)
  assert.equal(slashes.some(item => item.command === '/new'), true)
  assert.equal(slashes.some(item => item.command === '/reset'), true)
  assert.equal(slashes.some(item => item.command === '/compact'), true)
  assert.equal(slashes.some(item => item.command === '/my-skill'), true)
})

test('mergeUserSkills keeps SkillHub session skills and drops model-only ones', () => {
  const merged = mergeUserSkills([
    [{ name: 'resume-codex', description: 'resume' }],
    [
      { name: 'ego-browser', description: 'browse', invocation: { userInvocable: true } },
      { name: 'hidden', description: 'no', invocation: { userInvocable: false } },
      { name: 'resume-codex', description: 'ignored duplicate' },
    ],
  ])
  assert.deepEqual(merged.map(item => item.name), ['resume-codex', 'ego-browser'])
})

test('skillListViews include a host-global read plus each messaging session', () => {
  const views = skillListViews(['session-feishu', 'session-feishu', ''])
  assert.equal(views.length, 2)
  assert.equal(views[0].scope, undefined)
  assert.equal(views[1].scope.session.id, 'session-feishu')
})
