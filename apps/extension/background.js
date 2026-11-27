import { currentAccount } from './api.js'
import { attach, debuggerEvent, detach, fallback, flushRequests, pageEvent } from './diagnostics.js'
import { saveDraft } from './store.js'

const extensionOrigin = chrome.runtime.getURL('')
const recorderUrl = chrome.runtime.getURL('offscreen.html')
let recording
let starting = false
let offscreen

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
})

const popupUrl = chrome.runtime.getURL('popup.html')
const PANEL_TTL_MS = 6 * 60 * 60 * 1000

async function hidePanel(tabId) {
  await chrome.tabs.sendMessage(tabId, { to: 'panel', type: 'close' }, { frameId: 0 }).catch(() => {})
}

// Clicking the toolbar icon opens the Zapp panel inside the page, which we can style freely.
async function openPanel(tab) {
  if (!tab?.id) return
  const nonce = crypto.randomUUID()
  try {
    await chrome.storage.session.set({ [`panel:${tab.id}`]: { nonce, expiresAt: Date.now() + PANEL_TTL_MS } })
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel-overlay.js'] })
    const shown = await chrome.tabs.sendMessage(tab.id, { to: 'panel', type: 'toggle', url: `${popupUrl}?panel=${nonce}` }, { frameId: 0 })
    if (!shown) throw new Error('The panel could not open.')
  } catch {
    // Pages that block scripts (chrome://, the Web Store) get the regular popup instead.
    await chrome.storage.session.remove(`panel:${tab.id}`).catch(() => {})
    await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html' }).catch(() => {})
    await chrome.action.openPopup().catch(() => {})
  }
}

chrome.action.onClicked.addListener((tab) => { void openPanel(tab) })

// The popup page is trusted when it is the toolbar popup (no tab), or the panel we opened in a tab,
// which proves itself with the one-off nonce in its URL. A website that frames popup.html has neither.
async function fromPopup(sender) {
  if (!sender.tab) return sender.url === popupUrl
  if (sender.frameId === 0 || !sender.url?.startsWith(`${popupUrl}?panel=`)) return false
  const key = `panel:${sender.tab.id}`
  const { [key]: panel } = await chrome.storage.session.get(key)
  return Boolean(panel) && panel.expiresAt > Date.now() && sender.url === `${popupUrl}?panel=${panel.nonce}`
}

async function recorder(type, fields = {}) {
  const result = await chrome.runtime.sendMessage({ to: 'recorder', type, ...fields })
  if (!result?.ok) throw new Error(result?.error ?? 'The recorder is unavailable.')
  return result.value
}

async function openRecorder() {
  offscreen ??= (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [recorderUrl],
    })
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Record the tab selected for a Zapp bug report.',
      })
    }
  })().finally(() => { offscreen = null })
  await offscreen
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !/^https?:\/\//.test(tab.url ?? '')) throw new Error('Open a website tab to capture it.')
  return tab
}

async function makeDraft(type, tab) {
  const account = await currentAccount()
  if (!account?.token || !account?.workspaceId || Date.parse(account.expiresAt) <= Date.now()) {
    throw new Error('Sign in and select a workspace before capturing.')
  }
  return {
    id: crypto.randomUUID(), type, createdAt: Date.now(),
    origin: account.origin, workspaceId: account.workspaceId, userId: account.userId,
    title: tab.title?.slice(0, 180) || (type === 'video' ? 'Tab recording' : 'Screenshot'),
  }
}

function status(session) {
  return {
    id: session.draft.id, tabId: session.tabId, paused: Boolean(session.pausedAt),
    durationMs: session.elapsed(),
  }
}

async function start() {
  if (starting || recording) throw new Error('A tab recording is already in progress.')
  starting = true
  try {
    const tab = await activeTab()
    const { preferredTab } = await chrome.storage.session.get('preferredTab')
    if (preferredTab && tab.id !== preferredTab) throw new Error('Open Zapp from the selected tab to start recording.')
    const draft = await makeDraft('video', tab)
    await hidePanel(tab.id) // keep the panel out of the recording
    await openRecorder()
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    const startedAt = await recorder('start', { streamId, draft })
    const session = {
      draft, tabId: tab.id, startedAt, pausedAt: 0, pausedTotal: 0,
      events: [], eventBytes: 0, warnings: [], requests: new Map(), pendingEvents: new Set(), bodyReads: 0,
      elapsed() { return Math.max(0, (this.pausedAt || Date.now()) - this.startedAt - this.pausedTotal) },
    }
    recording = session
    await chrome.storage.session.remove('preferredTab').catch(() => {})
    await chrome.action.setBadgeText({ text: '', tabId: tab.id }).catch(() => {})
    // Install the controls immediately. Attaching Chrome's debugger can display a browser prompt.
    session.attach = attach(session)
    session.mount = mount(session)
    await chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' }).catch(() => {})
    await chrome.action.setBadgeText({ text: 'REC' }).catch(() => {})
  } finally {
    starting = false
  }
}

async function mount(session) {
  if (recording !== session || session.stopping) return
  const target = { tabId: session.tabId }
  try {
    await chrome.scripting.executeScript({ target, files: ['overlay.js'] })
    await chrome.tabs.sendMessage(session.tabId, { to: 'overlay', type: 'show', ...status(session) })
    await session.attach
    if (recording === session && !session.stopping && !session.debuggerAttached) {
      await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['page-log.js'] })
    }
  } catch {
    const warning = 'On-page controls or fallback logs were unavailable on part of this tab. Recording controls are also available in the Zapp popup.'
    if (!session.warnings.includes(warning)) session.warnings.push(warning)
  }
}

async function changePause() {
  const session = recording
  if (!session || session.stopping || session.changingPause) return
  session.changingPause = true
  try {
    if (session.pausedAt) {
      await recorder('resume')
      session.pausedTotal += Date.now() - session.pausedAt
      session.pausedAt = 0
    } else {
      flushRequests(session)
      await recorder('pause')
      session.pausedAt = Date.now()
    }
    await chrome.tabs.sendMessage(session.tabId, { to: 'overlay', type: 'update', ...status(session) }).catch(() => {})
  } finally {
    session.changingPause = false
  }
}

function stop() {
  const session = recording
  if (!session) return
  session.stopPromise ??= finish(session).catch((error) => {
    session.stopPromise = null
    throw error
  })
  return session.stopPromise
}

async function finish(session) {
  if (!session.stopping) {
    flushRequests(session)
    session.stopping = true
    session.durationMs = session.elapsed()
    await recorder('seal').catch(() => {})
    await Promise.allSettled([session.attach, session.mount, ...session.pendingEvents])
    await detach(session)
    await chrome.tabs.sendMessage(session.tabId, { to: 'overlay', type: 'hide', id: session.draft.id }).catch(() => {})
  }
  try {
    await recorder('finish', {
      events: session.events, warnings: session.warnings, durationMs: session.durationMs,
    })
  } catch (error) {
    if (error.message === 'The selected tab produced no video.' || error.message === 'The recorder has closed.') {
      recording = null
      await chrome.action.setBadgeText({ text: '' }).catch(() => {})
    }
    throw error
  }
  recording = null
  await chrome.action.setBadgeText({ text: '' }).catch(() => {})
  await preview(session.tabId, session.draft.id)
}

async function preview(tabId, id) {
  const key = `preview:${tabId}`
  const params = new URLSearchParams({ id, dialog: crypto.randomUUID() })
  const url = chrome.runtime.getURL(`preview.html?${params}`)
  try {
    await chrome.storage.session.set({ [key]: { url, expiresAt: Date.now() + 60_000 } })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['review-overlay.js'] })
    const shown = await chrome.tabs.sendMessage(tabId, { to: 'review', url }, { frameId: 0 })
    if (!shown) throw new Error('Preview dialog could not open.')
  } catch {
    await chrome.storage.session.remove(key).catch(() => {})
    await chrome.action.setBadgeText({ text: 'DRAFT', tabId }).catch(() => {})
  }
}

async function screenshot() {
  if (starting || recording) throw new Error('Stop the current recording before taking a screenshot.')
  const tab = await activeTab()
  const draft = await makeDraft('screenshot', tab)
  if ((await activeTab()).id !== tab.id) throw new Error('The active tab changed. Try again.')
  await hidePanel(tab.id) // keep the panel out of the screenshot
  await new Promise((resolve) => setTimeout(resolve, 200))
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const blob = await (await fetch(data)).blob()
  await saveDraft({ ...draft, blob, events: [], warnings: [] })
  await preview(tab.id, draft.id)
}

async function switchTab(id) {
  if (recording || starting) throw new Error('Stop the current recording before switching tabs.')
  const target = await chrome.tabs.get(id)
  if (!/^https?:\/\//.test(target.url ?? '')) throw new Error('Choose a website tab.')
  await clearTab()
  await chrome.storage.session.set({ preferredTab: id })
  await chrome.action.setBadgeText({ text: 'GO', tabId: id }).catch(() => {})
  await chrome.tabs.update(id, { active: true })
  await chrome.windows.update(target.windowId, { focused: true })
}

async function clearTab() {
  const { preferredTab } = await chrome.storage.session.get('preferredTab')
  await chrome.storage.session.remove('preferredTab')
  if (preferredTab) await chrome.action.setBadgeText({ text: '', tabId: preferredTab }).catch(() => {})
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Unrecognized connection.')
  if (message.type === 'authorize-preview') {
    if (!sender.tab || !sender.frameId || !sender.url?.startsWith(chrome.runtime.getURL('preview.html?'))) {
      throw new Error('This preview must be opened from the recording tab.')
    }
    const key = `preview:${sender.tab.id}`
    const { [key]: pending } = await chrome.storage.session.get(key)
    if (pending?.url !== sender.url || pending.expiresAt < Date.now()) {
      throw new Error('This preview link expired. Your capture is saved in Zapp drafts.')
    }
    await chrome.storage.session.remove(key)
    return true
  }
  if (sender.tab && sender.frameId === 0 && !sender.url?.startsWith(extensionOrigin)) {
    if (!recording || sender.tab.id !== recording.tabId || message.id !== recording.draft.id) return
    if (message.type === 'page-event') return pageEvent(recording, message.data)
    if (message.type === 'toggle-pause') return changePause()
    if (message.type === 'stop') return stop()
    return
  }
  if (sender.url === recorderUrl) {
    if (message.type === 'recorder-ended' && message.id === recording?.draft.id) return stop()
    return
  }
  if (!(await fromPopup(sender))) throw new Error('Unrecognized extension page.')
  switch (message.type) {
    case 'state': return recording ? status(recording) : null
    case 'select-tab': return switchTab(message.tabId)
    case 'clear-tab': return clearTab()
    case 'start': return start()
    case 'screenshot': return screenshot()
    case 'toggle-pause': return changePause()
    case 'stop': return stop()
    default: throw new Error('Unknown capture action.')
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.to !== 'background') return
  handle(message, sender).then(
    (value) => reply({ ok: true, value }),
    (error) => reply({ ok: false, error: error.message }),
  )
  return true
})

chrome.debugger.onEvent.addListener((target, method, params) => {
  const session = recording
  if (!session || target.tabId !== session.tabId || session.stopping) return
  const pending = debuggerEvent(session, method, params).catch(() => {})
  session.pendingEvents.add(pending)
  void pending.finally(() => session.pendingEvents.delete(pending))
})

chrome.debugger.onDetach.addListener((target) => {
  const session = recording
  if (session?.tabId === target.tabId && session.debuggerAttached && !session.stopping) {
    flushRequests(session)
    fallback(session)
    session.mount = mount(session)
  }
})

chrome.tabs.onUpdated.addListener((id, change) => {
  if (recording?.tabId === id && change.status === 'complete' && !recording.stopping) {
    recording.mount = mount(recording)
  }
})

chrome.tabs.onRemoved.addListener((id) => {
  if (recording?.tabId === id) void stop()?.catch(() => {})
  void chrome.storage.session.remove([`preview:${id}`, `panel:${id}`]).catch(() => {})
  void chrome.storage.session.get('preferredTab').then(({ preferredTab }) => {
    if (preferredTab === id) return chrome.storage.session.remove('preferredTab')
  })
})
