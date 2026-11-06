const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')
const previousLoader = require.extensions['.ts']
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  module._compile(outputText, filename)
}
const { isolateDialogInput } = require('../src/utils/dialogIsolation.ts')
if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']

function setup() {
  const listeners = []
  const focusable = (name) => ({ name, focus() { globalThis.document.activeElement = this } })
  const first = focusable('first')
  const last = focusable('last')
  const canvasButton = focusable('canvas')
  const dialog = {
    ...focusable('dialog'),
    querySelectorAll: () => [first, last],
    contains: (el) => [dialog, first, last].includes(el),
  }
  globalThis.document = { activeElement: canvasButton }
  globalThis.window = {
    addEventListener: (...args) => listeners.push(args),
    removeEventListener: (type, fn, capture) => {
      const index = listeners.findIndex((l) => l[0] === type && l[1] === fn && l[2] === capture)
      assert.notEqual(index, -1)
      listeners.splice(index, 1)
    },
  }
  let escaped = 0
  const release = isolateDialogInput(dialog, () => { escaped += 1 })
  const fire = (type, init = {}) => {
    const event = { ...init, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true }, preventDefault() { this.prevented = true } }
    listeners.filter((l) => l[0] === type).forEach((l) => l[1](event))
    return event
  }
  return { listeners, first, last, canvasButton, dialog, release, fire, escaped: () => escaped }
}

test('listens in the capture phase so the canvas shortcuts on window never run', () => {
  const { listeners } = setup()
  assert.deepEqual(listeners.map((l) => [l[0], l[2]]), [['keydown', true], ['paste', true]])
})

test('canvas shortcuts and paste stop at the dialog without blocking native input', () => {
  const { fire } = setup()
  for (const init of [{ key: 'Delete' }, { key: 'Backspace' }, { key: 'z', ctrlKey: true }, { key: 'v', metaKey: true }, { key: ' ' }, { key: 'a' }]) {
    const event = fire('keydown', init)
    assert.equal(event.stopped, true, init.key)
    assert.equal(event.prevented, false, init.key)
  }
  const paste = fire('paste')
  assert.equal(paste.stopped, true)
  assert.equal(paste.prevented, false)
})

test('takes focus on open, pulls stray focus back and restores focus on close', () => {
  const { dialog, canvasButton, release, fire } = setup()
  assert.equal(document.activeElement, dialog)
  document.activeElement = null
  fire('keydown', { key: 'Delete' })
  assert.equal(document.activeElement, dialog)
  release()
  assert.equal(document.activeElement, canvasButton)
})

test('tab wraps inside the dialog in both directions', () => {
  const { first, last, fire } = setup()
  assert.equal(fire('keydown', { key: 'Tab' }).prevented, true)
  assert.equal(document.activeElement, first)
  assert.equal(fire('keydown', { key: 'Tab' }).prevented, false)
  document.activeElement = last
  fire('keydown', { key: 'Tab' })
  assert.equal(document.activeElement, first)
  fire('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, last)
})

test('escape closes the dialog only, and nothing is intercepted after release', () => {
  const { release, fire, escaped, listeners } = setup()
  const event = fire('keydown', { key: 'Escape' })
  assert.equal(escaped(), 1)
  assert.equal(event.stopped, true)
  release()
  assert.equal(listeners.length, 0)
})
