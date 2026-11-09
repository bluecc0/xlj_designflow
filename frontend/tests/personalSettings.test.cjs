const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

// 用项目自带的 Babel 把真实的 PersonalSettings.jsx 转成脚本执行，取出保存动作
const Babel = require('../vendor/babel.min.js')
const source = fs.readFileSync(path.join(__dirname, '../src/PersonalSettings.jsx'), 'utf8')
const code = Babel.transform(source, { presets: ['react'], sourceType: 'script' }).code
const sandboxWindow = {}
new Function('window', 'React', 'I', 'navigator', code)(sandboxWindow, {}, {}, { platform: 'MacIntel' })
const { createPersonalSettingsActions } = sandboxWindow

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// 模拟 React 的 setState：支持 updater 函数，状态始终是最新的
function harness(api) {
  let user = {
    id: 'u1', username: 'tester', nickname: '', avatar_url: '/avatars/old.png',
    preferences: { send_shortcut: 'enter', default_model: 'gpt-image-2.6', default_ratio: 'auto', default_resolution: '1K' },
  }
  const actions = createPersonalSettingsActions({
    api,
    getUser: () => user,
    onUserChange: (next) => { user = typeof next === 'function' ? next(user) : next },
  })
  return { actions, get user() { return user } }
}

test('avatar response does not undo a preference saved in parallel, in either order', async () => {
  for (const avatarFirst of [true, false]) {
    const avatar = deferred(), pref = deferred()
    const h = harness({
      uploadAvatar: () => avatar.promise,
      savePreferences: () => pref.promise,
    })
    const uploading = h.actions.uploadAvatar({})
    const saving = h.actions.savePreference('default_model', 'nano-banana-pro')
    const finishAvatar = () => { avatar.resolve('/avatars/new.png?v=2'); return uploading }
    const finishPref = () => {
      pref.resolve({ ...h.user.preferences, default_model: 'nano-banana-pro' })
      return saving
    }
    if (avatarFirst) { await finishAvatar(); await finishPref() } else { await finishPref(); await finishAvatar() }
    assert.equal(h.user.avatar_url, '/avatars/new.png?v=2')
    assert.equal(h.user.preferences.default_model, 'nano-banana-pro')
  }
})

test('nickname and preference responses each keep the other field', async () => {
  const name = deferred(), pref = deferred()
  const h = harness({ saveProfile: () => name.promise, savePreferences: () => pref.promise })
  const savingName = h.actions.saveNickname('阿明')
  const savingPref = h.actions.savePreference('send_shortcut', 'mod_enter')
  // 偏好接口返回的是请求发起时服务器上的整份偏好，不能借它覆盖别的项
  pref.resolve({ send_shortcut: 'mod_enter', default_model: 'gpt-image-2.6', default_ratio: 'auto', default_resolution: '1K' })
  await savingPref
  name.resolve({ nickname: '阿明' })
  await savingName
  assert.equal(h.user.nickname, '阿明')
  assert.equal(h.user.preferences.send_shortcut, 'mod_enter')
})

test('a stale preference response does not overwrite a newer parallel choice', async () => {
  const first = deferred(), second = deferred()
  const queue = [first, second]
  const h = harness({ savePreferences: () => queue.shift().promise })
  const savingRatio = h.actions.savePreference('default_ratio', '3:4')
  const savingModel = h.actions.savePreference('default_model', 'gpt-image-2')
  // 先发出的比例请求晚返回，且返回内容里模型仍是旧值
  second.resolve({ send_shortcut: 'enter', default_model: 'gpt-image-2', default_ratio: '3:4', default_resolution: '1K' })
  await savingModel
  first.resolve({ send_shortcut: 'enter', default_model: 'gpt-image-2.6', default_ratio: '3:4', default_resolution: '1K' })
  await savingRatio
  assert.equal(h.user.preferences.default_ratio, '3:4')
  assert.equal(h.user.preferences.default_model, 'gpt-image-2')
})

test('a failed preference rolls back only its own key, and not over a newer choice', async () => {
  const failing = deferred(), newer = deferred()
  const queue = [failing, newer]
  const h = harness({ savePreferences: () => queue.shift().promise, uploadAvatar: async () => '/avatars/new.png?v=3' })
  const savingFirst = h.actions.savePreference('default_resolution', '2K')
  await h.actions.uploadAvatar({})
  failing.reject(new Error('network'))
  await assert.rejects(savingFirst)
  assert.equal(h.user.preferences.default_resolution, '1K')
  assert.equal(h.user.avatar_url, '/avatars/new.png?v=3')

  // 同一项：第一次失败前用户又改成了 4K，回滚不能把 4K 改回去
  const again = deferred(), latest = deferred()
  const queue2 = [again, latest]
  const h2 = harness({ savePreferences: () => queue2.shift().promise })
  const savingA = h2.actions.savePreference('default_resolution', '2K')
  const savingB = h2.actions.savePreference('default_resolution', '4K')
  again.reject(new Error('network'))
  await assert.rejects(savingA)
  latest.resolve({ default_resolution: '4K' })
  await savingB
  assert.equal(h2.user.preferences.default_resolution, '4K')
})
