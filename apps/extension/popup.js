import { api, ApiError, currentAccount, hostPattern, send, serverOrigin } from './api.js'
import { hydrate } from './lucide.js'
import { draftIds } from './store.js'

hydrate()

// Beta builds get version_name "X.Y.Z-beta.N" from the release workflow.
const versionName = chrome.runtime.getManifest().version_name ?? ''
if (versionName.includes('-beta')) {
  const badge = document.getElementById('beta-badge')
  badge.hidden = false
  badge.title = versionName
}

const $ = (id) => document.getElementById(id)
const screens = ['connect', 'login', 'workspace', 'capture', 'recording']

// Opened from the toolbar icon, this page runs inside a panel on the website. On pages that block
// that, Chrome shows it as a regular popup instead. Both use the same code.
const embedded = window.top !== window
if (embedded) {
  document.documentElement.dataset.embedded = 'true'
  const main = document.querySelector('main')
  new ResizeObserver(() => {
    parent.postMessage({ type: 'zapp-panel-size', height: main.offsetHeight }, '*')
  }).observe(main)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel()
  })
}

function closePanel() {
  if (embedded) parent.postMessage('zapp-panel-close', '*')
  else window.close()
}
let account
let timer
let busy = false

function show(screen) {
  clearInterval(timer)
  for (const id of screens) $(id).hidden = id !== screen
  $('change-server').hidden = screen === 'connect' || screen === 'recording'
}

function status(message = '', error = false) {
  $('status').textContent = message
  $('status').hidden = !message
  $('status').dataset.error = String(error)
}

async function commit(value) {
  account = value
  await chrome.storage.local.set({ account })
}

function act(element, event, callback) {
  element.addEventListener(event, async (e) => {
    e.preventDefault()
    if (busy) return
    busy = true
    const button = e.submitter ?? element
    button.disabled = true
    status()
    try {
      await callback(e)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && account?.token) {
        await commit({ origin: account.origin })
        showLogin()
      }
      status(error.message, true)
    } finally {
      button.disabled = false
      busy = false
    }
  })
}

function showLogin() {
  $('server').textContent = account.origin
  $('login').reset()
  show('login')
}

async function showWorkspace() {
  const { items } = await api(account, '/api/v1/workspaces')
  const select = $('workspace').elements.id
  select.replaceChildren(...items.map((item) => new Option(item.name, item.id, false, item.id === account.workspaceId)))
  $('workspace').querySelector('button').disabled = !items.length
  $('workspace-hint').textContent = items.length ? 'Captures will be saved here.' : 'Create a workspace on your Zapp server, then reopen the extension.'
  show('workspace')
}

async function showCapture() {
  show('capture')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const { preferredTab } = await chrome.storage.session.get('preferredTab')
  if (preferredTab) {
    $('selection').textContent = preferredTab === tab?.id
      ? 'Selected tab ready. Click Record tab.'
      : 'Open Zapp in the selected tab, or choose another tab.'
  } else {
    $('selection').textContent = tab?.title ?? 'Current tab'
  }
}

function showRecording(state) {
  show('recording')
  const started = performance.now()
  $('pause').textContent = state.paused ? 'Resume' : 'Pause'
  const refresh = () => {
    const seconds = Math.floor((state.durationMs + (state.paused ? 0 : performance.now() - started)) / 1000)
    $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  refresh()
  timer = setInterval(refresh, 250)
}

async function init() {
  account = await currentAccount()
  const [state, drafts] = await Promise.all([send('state'), draftIds()])
  $('drafts').hidden = !drafts.length
  $('drafts').textContent = drafts.length === 1 ? 'Open draft' : `Open drafts (${drafts.length})`
  if (state) return showRecording(state)
  if (!account?.origin) return show('connect')
  if (!account.token || Date.parse(account.expiresAt) <= Date.now()) return showLogin()
  if (!account.workspaceId) return showWorkspace()
  return showCapture()
}

act($('connect'), 'submit', async () => {
  const origin = serverOrigin($('connect').elements.origin.value, { originOnly: true })
  if (!await chrome.permissions.request({ origins: [hostPattern(origin)] })) {
    throw new Error('Allow access to this server to continue.')
  }
  await commit({ origin })
  showLogin()
})

act($('login'), 'submit', async () => {
  const form = $('login')
  const body = { email: form.elements.email.value.trim(), password: form.elements.password.value }
  form.elements.password.value = ''
  const result = await api({ origin: account.origin }, '/api/v1/auth/login', { method: 'POST', body })
  if (!result.token || !result.user?.id || !Number.isFinite(Date.parse(result.expiresAt))) {
    throw new Error('The server returned an invalid login response.')
  }
  await commit({
    origin: account.origin, token: result.token, expiresAt: result.expiresAt,
    userId: result.user.id, workspaceId: result.workspaceId,
  })
  if (account.workspaceId) await showCapture()
  else await showWorkspace()
})

act($('workspace'), 'submit', async () => {
  const workspaceId = $('workspace').elements.id.value
  const result = await api(account, '/api/v1/session/workspace', { method: 'PUT', body: { workspaceId } })
  await commit({ ...account, workspaceId: result.workspaceId })
  await showCapture()
})

act($('change-server'), 'click', async () => {
  const previous = account
  if (previous?.token) await api(previous, '/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
  await chrome.storage.local.remove('account')
  await send('clear-tab')
  account = undefined
  $('connect').elements.origin.value = previous?.origin ?? ''
  show('connect')
})

act($('logout'), 'click', async () => {
  await api(account, '/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
  await commit({ origin: account.origin })
  showLogin()
})

act($('switch-workspace'), 'click', showWorkspace)
act($('screenshot'), 'click', async () => { await send('screenshot'); closePanel() })
act($('record'), 'click', async () => {
  await send('start')
  closePanel()
})
act($('pause'), 'click', async () => {
  await send('toggle-pause')
  const state = await send('state')
  if (state) showRecording(state)
  else await showCapture()
})
act($('stop'), 'click', async () => { await send('stop'); closePanel() })
act($('show-tabs'), 'click', async () => {
  const picker = $('tab-picker')
  if (picker.hidden) {
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const candidates = tabs.filter((tab) => /^https?:\/\//.test(tab.url ?? ''))
    if (!candidates.length) throw new Error('No website tabs in this window.')
    picker.elements.tab.replaceChildren(...candidates.map((tab) => new Option(tab.title || tab.url, tab.id, false, tab.active)))
  }
  picker.hidden = !picker.hidden
  $('show-tabs').setAttribute('aria-expanded', String(!picker.hidden))
})
act($('tab-picker'), 'submit', async () => {
  const id = Number($('tab-picker').elements.tab.value)
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (id === current?.id) {
    await send('clear-tab')
    await send('start')
  } else {
    await send('select-tab', { tabId: id })
  }
  closePanel()
})

$('close-panel').addEventListener('click', closePanel)

$('drafts').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') }))

init().catch(async (error) => {
  if (error instanceof ApiError && error.status === 401 && account?.origin) {
    await commit({ origin: account.origin })
    showLogin()
  }
  status(error.message, true)
})
