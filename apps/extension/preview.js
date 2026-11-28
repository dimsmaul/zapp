import { api, ApiError, currentAccount, send, serverOrigin } from './api.js'
import { hydrate, icon } from './lucide.js'
import { getDraft, listDrafts, removeDraft, saveDraft } from './store.js'

hydrate()

const $ = (id) => document.getElementById(id)
const id = new URL(location.href).searchParams.get('id')
const embedded = window.top !== window
const video = $('video')
let draft
let busy = false

function status(message = '', error = false) {
  $('status').textContent = message
  $('status').hidden = !message
  $('status').dataset.error = String(error)
}

function time(seconds) {
  const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const SKIP_SECONDS = 5
let idleTimer

// A recording from MediaRecorder often reports no duration, so fall back to the one we measured.
function knownDuration() {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (draft.durationMs ?? 0) / 1000
}

function setIcon(button, name, filled = false) {
  button.replaceChildren(icon(name, { filled }))
}

function updatePlayer() {
  const duration = knownDuration()
  const ratio = duration > 0 ? Math.min(video.currentTime / duration, 1) : 0
  $('seek-fill').style.width = `${ratio * 100}%`
  $('seek-thumb').style.left = `${ratio * 100}%`
  $('seek').setAttribute('aria-valuemax', String(Math.floor(duration)))
  $('seek').setAttribute('aria-valuenow', String(Math.floor(video.currentTime)))
  $('seek').setAttribute('aria-valuetext', `${time(video.currentTime)} of ${time(duration)}`)
  $('clock').textContent = `${time(video.currentTime)} / ${time(duration)}`
  setIcon($('play'), video.paused ? 'play' : 'pause', true)
  $('play').setAttribute('aria-label', video.paused ? 'Play preview' : 'Pause preview')
  const silent = video.muted || video.volume === 0
  setIcon($('mute'), silent ? 'volume-x' : 'volume-2')
  $('mute').setAttribute('aria-label', silent ? 'Unmute' : 'Mute')
  $('volume').value = silent ? '0' : String(video.volume)
}

function seekTo(seconds) {
  const duration = knownDuration()
  video.currentTime = Math.min(Math.max(0, seconds), duration || seconds)
  updatePlayer()
}

// Like YouTube: the controls hide after a moment while the video plays, and return on pointer move.
function wake() {
  $('player').classList.remove('is-idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { if (!video.paused) $('player').classList.add('is-idle') }, 2500)
}

function showMedia() {
  const url = URL.createObjectURL(draft.blob)
  addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true })
  if (draft.type === 'screenshot') {
    $('image').src = url
    $('image').hidden = false
    return
  }
  video.src = url
  video.hidden = false
  $('player').hidden = false
  setIcon($('fullscreen'), 'maximize')
  for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended', 'volumechange']) {
    video.addEventListener(event, updatePlayer)
  }
  // timeupdate only fires a few times a second, so follow the frame rate while playing.
  video.addEventListener('play', function tick() {
    if (video.paused) return
    updatePlayer()
    requestAnimationFrame(tick)
  })
  video.addEventListener('pause', wake)
  video.addEventListener('error', () => status('The browser could not play this recording.', true))

  const toggle = () => {
    if (video.paused) void video.play().catch(() => status('Could not play this recording.', true))
    else video.pause()
  }
  $('play').addEventListener('click', toggle)
  video.addEventListener('click', toggle)
  $('back').addEventListener('click', () => seekTo(video.currentTime - SKIP_SECONDS))
  $('forward').addEventListener('click', () => seekTo(video.currentTime + SKIP_SECONDS))
  $('mute').addEventListener('click', () => { video.muted = !video.muted })
  $('volume').addEventListener('input', (event) => {
    video.muted = false
    video.volume = Number(event.target.value)
  })
  $('speed').addEventListener('change', (event) => { video.playbackRate = Number(event.target.value) })

  const seek = $('seek')
  let scrubbing = false
  const fromPointer = (event) => {
    const rect = seek.getBoundingClientRect()
    if (rect.width > 0) seekTo(Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * knownDuration())
  }
  seek.addEventListener('pointerdown', (event) => { scrubbing = true; seek.setPointerCapture(event.pointerId); fromPointer(event) })
  seek.addEventListener('pointermove', (event) => { if (scrubbing) fromPointer(event) })
  seek.addEventListener('pointerup', () => { scrubbing = false })
  seek.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    seekTo(video.currentTime + (event.key === 'ArrowRight' ? SKIP_SECONDS : -SKIP_SECONDS))
  })

  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await $('media').requestFullscreen()
    } catch {
      status('Fullscreen is unavailable.', true)
    }
  })
  document.addEventListener('fullscreenchange', () => {
    const full = document.fullscreenElement === $('media')
    setIcon($('fullscreen'), full ? 'minimize' : 'maximize')
    $('fullscreen').setAttribute('aria-label', full ? 'Exit fullscreen' : 'Fullscreen')
  })
  $('media').addEventListener('pointermove', wake)
  $('media').addEventListener('pointerleave', () => { if (!video.paused) $('player').classList.add('is-idle') })
  updatePlayer()
}

async function showList() {
  const captures = (await listDrafts()).sort((a, b) => b.createdAt - a.createdAt)
  $('draft-list').hidden = false
  if (!captures.length) {
    $('draft-items').textContent = 'No local drafts.'
    return
  }
  for (const capture of captures) {
    const link = document.createElement('a')
    link.className = 'draft-card'
    link.href = `preview.html?id=${encodeURIComponent(capture.id)}`
    link.textContent = capture.title
    const metadata = document.createElement('p')
    metadata.className = 'muted'
    metadata.textContent = `${capture.type === 'video' ? 'Tab recording' : 'Screenshot'} · ${new Date(capture.createdAt).toLocaleString()}`
    link.append(metadata)
    $('draft-items').append(link)
  }
}

function showShare(url) {
  $('link').value = url
  $('open-report').href = url
  $('share').hidden = false
  $('save').hidden = true
  $('discard').hidden = true
  $('title').readOnly = true
  $('description').readOnly = true
}

async function persist(fields) {
  draft = { ...draft, ...fields }
  await saveDraft(draft)
}

// Uploads go through the Zapp server, so only the configured server address is ever contacted.
// XMLHttpRequest, not fetch: fetch cannot report upload progress.
function upload(account, kind, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const fail = (message) => reject(new Error(`Upload failed: ${message} Your draft is still saved locally.`))
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', new URL(`/api/v1/captures/${encodeURIComponent(draft.reportId)}/upload/${kind}`, account.origin))
    xhr.setRequestHeader('Authorization', `Bearer ${account.token}`)
    xhr.setRequestHeader('Content-Type', blob.type)
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onerror = () => fail('could not reach the server.')
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let message = `HTTP ${xhr.status}.`
      try { message = JSON.parse(xhr.responseText).message ?? message } catch { /* keep the HTTP status */ }
      fail(message)
    }
    xhr.send(blob)
  })
}

// Uploads the capture and its debugger events together, with one overall progress bar.
async function uploadAll(account) {
  const parts = [['capture', draft.blob]]
  if (draft.events.length) parts.push(['debugger', new Blob([JSON.stringify({ events: draft.events })], { type: 'application/json' })])
  const total = parts.reduce((sum, [, blob]) => sum + blob.size, 0)
  const loaded = new Map()
  const bar = $('upload-progress')
  bar.value = 0
  bar.hidden = false
  const report = (kind) => (bytes) => {
    loaded.set(kind, bytes)
    const done = [...loaded.values()].reduce((sum, value) => sum + value, 0)
    bar.value = Math.min(done / total, 1)
    status(`Uploading ${Math.round(bar.value * 100)}%`)
  }
  try {
    await Promise.all(parts.map(([kind, blob]) => upload(account, kind, blob, report(kind))))
  } finally {
    bar.hidden = true
  }
}

async function recoverReport(account) {
  if (!draft.reportId || draft.published) return
  try {
    await api(account, `/api/v1/reports/${encodeURIComponent(draft.reportId)}`)
    await persist({ published: true })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }
}

async function submit() {
  await navigator.locks.request(`zapp-publish-${id}`, async () => {
    const saved = await getDraft(id)
    if (!saved) throw new Error('This local draft is no longer available.')
    draft = saved
    await publish()
  })
}

async function publish() {
  const account = await currentAccount()
  if (
    !account?.token || account.origin !== draft.origin || account.userId !== draft.userId ||
    Date.parse(account.expiresAt) <= Date.now()
  ) {
    throw new Error('Sign in to the original Zapp server and account from the extension popup, then try again.')
  }
  if (account.workspaceId !== draft.workspaceId) {
    throw new Error('Select the original workspace from the extension popup, then try again.')
  }
  if (draft.shareUrl) return showShare(draft.shareUrl)

  await recoverReport(account)
  if (!draft.published) {
    const title = draft.uploadKey ? draft.title : $('title').value.trim()
    const description = draft.uploadKey ? (draft.description ?? '') : $('description').value.trim()
    if (!title) throw new Error('Enter a report title.')
    if (!draft.uploadKey || Date.now() - draft.uploadStartedAt >= 14 * 60 * 1000) {
      await persist({ uploadKey: crypto.randomUUID(), uploadStartedAt: Date.now(), reportId: null, title, description })
    }
    $('title').readOnly = true
    $('description').readOnly = true
    status('Preparing upload…')
    const targets = await api(account, '/api/v1/captures/upload-sessions', {
      method: 'POST', idempotencyKey: draft.uploadKey,
      body: {
        attachmentType: draft.type, captureContentType: draft.blob.type, hasDebuggerPayload: Boolean(draft.events.length), title,
        ...(draft.folderId ? { folderId: draft.folderId } : {}),
        ...(description ? { description } : {}),
      },
    })
    if (!targets.bugReportId) throw new Error('The server did not return a capture ID.')
    await persist({ reportId: targets.bugReportId })
    status('Uploading 0%')
    await uploadAll(account)
    status('Publishing report…')
    await api(account, `/api/v1/captures/${encodeURIComponent(draft.reportId)}/finalize`, {
      method: 'POST', body: { debuggerContentEncoding: 'identity' },
    })
    await persist({ published: true })
  }
  status('Creating share link…')
  const { shareUrl } = await api(account, `/api/v1/reports/${encodeURIComponent(draft.reportId)}/share-links`, {
    method: 'POST', body: {},
  })
  serverOrigin(shareUrl)
  await persist({ shareUrl, blob: null, events: [] })
  showShare(shareUrl)
  status('Report saved. The share link is ready.')
}

async function run(callback) {
  if (busy) return
  busy = true
  $('save').disabled = true
  $('discard').disabled = true
  try {
    await callback()
  } catch (error) {
    status(error.message, true)
  } finally {
    busy = false
    $('save').disabled = false
    $('discard').disabled = false
  }
}

$('save-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void run(submit)
})
$('discard').addEventListener('click', () => void run(async () => {
  if (!confirm('Discard this local draft?')) return
  await removeDraft(id)
  if (embedded) window.parent.postMessage('zapp-preview-close', '*')
  else location.href = 'preview.html'
}))
// Closing keeps the draft. Discard (the trash button) is the only thing that deletes it.
$('close').addEventListener('click', () => {
  if (embedded) window.parent.postMessage('zapp-preview-close', '*')
  else location.href = 'preview.html'
})
$('copy').addEventListener('click', () => void run(async () => {
  await navigator.clipboard.writeText($('link').value)
  await removeDraft(id)
  status('Link copied.')
}))

async function init() {
  if (embedded) {
    if (!id) throw new Error('Open this preview from Zapp.')
    await send('authorize-preview')
    document.body.dataset.embedded = 'true'
    $('all-drafts').hidden = true
    window.parent.postMessage('zapp-preview-ready', '*')
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !busy && !document.fullscreenElement) {
        window.parent.postMessage('zapp-preview-close', '*')
      }
    })
  }
  if (!id) return showList()
  draft = await getDraft(id)
  if (!draft) throw new Error('This local draft is no longer available.')
  $('review').hidden = false
  $('title').value = draft.title
  $('title').readOnly = Boolean(draft.uploadKey)
  $('description').value = draft.description ?? ''
  $('description').readOnly = Boolean(draft.uploadKey)
  if (draft.blob) showMedia()
  if (draft.shareUrl) {
    showShare(draft.shareUrl)
    return
  }
}

init().catch((error) => status(error.message, true))
