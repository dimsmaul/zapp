import { api, ApiError, currentAccount, hostPattern, send, serverOrigin } from './api.js'
import { hydrate, icon } from './lucide.js'
import { getDraft, listDrafts, removeDraft, saveDraft } from './store.js'

hydrate()

const $ = (id) => document.getElementById(id)
const id = new URL(location.href).searchParams.get('id')
const embedded = window.top !== window
const video = $('video')
let draft
let busy = false
let uploadOrigins = []

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
  $('grant').hidden = true
  $('discard').hidden = true
  $('title').readOnly = true
  $('description').readOnly = true
}

async function persist(fields) {
  draft = { ...draft, ...fields }
  await saveDraft(draft)
}

function storageOrigins(targets) {
  return [...new Set(targets.map((target) => {
    if (target?.method !== 'PUT' || !target.url) throw new Error('The server did not return a valid upload destination.')
    return hostPattern(serverOrigin(target.url))
  }))]
}

async function upload(target, blob) {
  const headers = new Headers()
  const contentType = new Headers(target.headers).get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  const response = await fetch(target.url, {
    method: 'PUT', headers, body: blob, redirect: 'error', credentials: 'omit',
  })
  if (!response.ok) throw new Error(`Storage upload failed (HTTP ${response.status}). Your draft is still saved locally.`)
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
        ...(description ? { description } : {}),
      },
    })
    if (!targets.bugReportId) throw new Error('The server did not return a capture ID.')
    await persist({ reportId: targets.bugReportId })
    const uploads = [targets.captureUpload, ...(draft.events.length ? [targets.debuggerUpload] : [])]
    uploadOrigins = storageOrigins(uploads)
    if (!await chrome.permissions.contains({ origins: uploadOrigins })) {
      $('grant').hidden = false
      status('Allow upload to the configured storage host to publish this report.')
      return
    }
    $('grant').hidden = true
    status('Uploading capture…')
    await Promise.all([
      upload(targets.captureUpload, draft.blob),
      ...(draft.events.length ? [upload(targets.debuggerUpload, new Blob([JSON.stringify({ events: draft.events })], { type: 'application/json' }))] : []),
    ])
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
  $('grant').disabled = true
  try {
    await callback()
  } catch (error) {
    status(error.message, true)
  } finally {
    busy = false
    $('save').disabled = false
    $('discard').disabled = false
    $('grant').disabled = false
  }
}

$('save-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void run(submit)
})
$('grant').addEventListener('click', () => void run(async () => {
  if (!await chrome.permissions.request({ origins: uploadOrigins })) throw new Error('Storage permission is required to upload.')
  await submit()
}))
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
