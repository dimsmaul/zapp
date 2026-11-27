import { saveDraft } from './store.js'

const MAX_BYTES = 94 * 1024 * 1024
let capture

async function start(streamId, draft, source = 'tab') {
  if (capture) throw new Error('Another recording is already active.')
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId, maxFrameRate: 24 } },
    audio: false,
  })
  try {
    // Chrome's own "Stop sharing" button (desktop) or closing the shared tab ends the video track.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => requestStop(draft.id), { once: true })
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 1_500_000 })
    const state = { draft, stream, recorder, chunks: [], bytes: 0, limitReached: false }
    state.stopped = new Promise((resolve) => {
      recorder.addEventListener('stop', resolve, { once: true })
    })
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data.size) return
      if (state.bytes + data.size <= 100 * 1024 * 1024) {
        state.chunks.push(data)
        state.bytes += data.size
      } else {
        state.limitReached = true
      }
      if (state.bytes >= MAX_BYTES || state.limitReached) {
        state.limitReached = true
        requestStop(draft.id)
      }
    })
    recorder.addEventListener('stop', () => requestStop(draft.id), { once: true })
    recorder.addEventListener('error', () => requestStop(draft.id), { once: true })
    recorder.start(1000)
    capture = state
    return Date.now()
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    throw error
  }
}

function requestStop(id) {
  chrome.runtime.sendMessage({ to: 'background', type: 'recorder-ended', id }).catch(() => {})
}

async function finish({ events, warnings, durationMs }) {
  const state = capture
  if (!state) throw new Error('The recorder has closed.')
  if (state.recorder.state !== 'inactive') state.recorder.stop()
  await state.stopped
  for (const track of state.stream.getTracks()) track.stop()
  const blob = new Blob(state.chunks, { type: 'video/webm' })
  if (!blob.size) {
    capture = null
    throw new Error('The selected tab produced no video.')
  }
  if (state.limitReached) warnings.push('Recording stopped at the upload size limit.')
  await saveDraft({ ...state.draft, blob, events, warnings, durationMs })
  capture = null
}

async function handle(message) {
  if (message.type === 'start') return start(message.streamId, message.draft, message.source)
  if (message.type === 'seal' && capture && capture.recorder.state !== 'inactive') capture.recorder.stop()
  if (message.type === 'finish') return finish(message)
  if (message.type === 'pause' && capture?.recorder.state === 'recording') capture.recorder.pause()
  if (message.type === 'resume' && capture?.recorder.state === 'paused') capture.recorder.resume()
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.to !== 'recorder' || sender.id !== chrome.runtime.id || sender.tab) return
  handle(message).then(
    (value) => reply({ ok: true, value }),
    (error) => reply({ ok: false, error: error.message }),
  )
  return true
})

// Keep the service worker available for the currently visible recording controls.
setInterval(() => {
  if (capture) chrome.runtime.sendMessage({ to: 'background', type: 'recorder-heartbeat' }).catch(() => {})
}, 15_000)
