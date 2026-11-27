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

// Sign-in happens on the Zapp website, not in the extension. The website sends the browser back to
// auth.html with a session; auth.js stores it and this panel notices through storage.onChanged.
function showLogin({ open = false } = {}) {
  $('server').textContent = account.origin
  show('login')
  if (open) void openLogin().catch((error) => status(error.message, true))
}

async function openLogin() {
  const { login } = await chrome.storage.session.get('login')
  if (login?.origin === account.origin && login.expiresAt > Date.now() && login.tabId) {
    // A sign-in tab is already open: bring it forward instead of opening another one.
    if (await chrome.tabs.update(login.tabId, { active: true }).catch(() => null)) return
  }
  const { webOrigin } = await api({ origin: account.origin }, '/api/v1/config')
  const web = serverOrigin(webOrigin, { originOnly: true })
  const state = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60_000
  await chrome.storage.session.set({ login: { state, origin: account.origin, expiresAt } })
  const query = new URLSearchParams({ ref: 'extension', ext: chrome.runtime.id, state })
  const tab = await chrome.tabs.create({ url: `${web}/login?${query}` })
  await chrome.storage.session.set({ login: { state, origin: account.origin, expiresAt, tabId: tab.id } })
}

chrome.storage.onChanged.addListener((changes, area) => {
  const next = changes.account?.newValue
  if (area !== 'local' || !next?.token || $('login').hidden) return
  account = next
  void (account.workspaceId ? showCapture() : showWorkspace()).catch((error) => status(error.message, true))
})

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
  if (!account.token || Date.parse(account.expiresAt) <= Date.now()) return showLogin({ open: true })
  if (!account.workspaceId) return showWorkspace()
  return showCapture()
}

act($('connect'), 'submit', async () => {
  const origin = serverOrigin($('connect').elements.origin.value, { originOnly: true })
  // The config call is public, so it can run before the permission prompt. One prompt then covers the
  // server and the website that serves its sign-in page.
  const web = serverOrigin((await api({ origin }, '/api/v1/config')).webOrigin, { originOnly: true })
  if (!await chrome.permissions.request({ origins: [...new Set([hostPattern(origin), hostPattern(web)])] })) {
    throw new Error('Allow access to this server to continue.')
  }
  // Lets the website's "New Zapp" button open this extension.
  await chrome.scripting.unregisterContentScripts({ ids: ['zapp-web'] }).catch(() => {})
  await chrome.scripting.registerContentScripts([{
    id: 'zapp-web', matches: [hostPattern(web)], js: ['web-bridge.js'], runAt: 'document_start', persistAcrossSessions: true,
  }])
  await chrome.storage.local.set({ webOrigin: web })
  await commit({ origin })
  showLogin({ open: true })
})

act($('open-login'), 'click', openLogin)

act($('workspace'), 'submit', async () => {
  const workspaceId = $('workspace').elements.id.value
  const result = await api(account, '/api/v1/session/workspace', { method: 'PUT', body: { workspaceId } })
  await commit({ ...account, workspaceId: result.workspaceId })
  await showCapture()
})

act($('change-server'), 'click', async () => {
  const previous = account
  if (previous?.token) await api(previous, '/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
  await chrome.storage.local.remove(['account', 'webOrigin'])
  await chrome.scripting.unregisterContentScripts({ ids: ['zapp-web'] }).catch(() => {})
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
// In the in-page panel, the page overlay shows a 3-2-1 circle in the middle of the screen first.
// Clicking the circle (or pressing Escape) cancels. The popup window fallback starts at once.
function countdown() {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      if (event.source !== parent || !['zapp-countdown-done', 'zapp-countdown-cancel'].includes(event.data)) return
      removeEventListener('message', onMessage)
      resolve(event.data === 'zapp-countdown-done')
    }
    addEventListener('message', onMessage)
    parent.postMessage('zapp-countdown', '*')
  })
}
// Record area: "Tab" records the active tab with tabCapture. "Desktop" opens Chrome's share dialog so the
// user can share the active tab, a window or the whole screen, and the recording follows what is shared.
let area = 'tab'
function setArea(next) {
  area = next
  $('area-tab').setAttribute('aria-pressed', String(area === 'tab'))
  $('area-desktop').setAttribute('aria-pressed', String(area === 'desktop'))
  $('record-label').textContent = area === 'desktop' ? 'Record desktop' : 'Record tab'
  $('show-tabs').hidden = area === 'desktop'
  if (area === 'desktop') $('tab-picker').hidden = true
}
for (const next of ['tab', 'desktop']) {
  $(`area-${next}`).addEventListener('click', () => {
    setArea(next)
    void chrome.storage.local.set({ recordArea: next })
  })
}
void chrome.storage.local.get('recordArea').then(({ recordArea }) => setArea(recordArea === 'desktop' ? 'desktop' : 'tab'))

function chooseScreen() {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(['tab', 'window', 'screen'], (streamId) => resolve(streamId || ''))
  })
}

act($('record'), 'click', async () => {
  const streamId = area === 'desktop' ? await chooseScreen() : undefined
  if (area === 'desktop' && !streamId) return // the share dialog was cancelled
  if (embedded && !await countdown()) return
  await send('start', { area, streamId })
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
