(() => {
  if (globalThis.zappRecordingControls) return
  globalThis.zappRecordingControls = true
  let host
  let timer
  let state
  let paint
  let position
  let receivedAt

  function send(type, data = {}) {
    return chrome.runtime.sendMessage({ to: 'background', type, id: state?.id, ...data })
  }

  function hide() {
    window.dispatchEvent(new Event('zapp:stop-observing'))
    clearInterval(timer)
    host?.remove()
    host = null
    state = null
  }

  function show() {
    if (host) return
    host = document.createElement('zapp-recording-controls')
    host.style.setProperty('all', 'initial', 'important')
    host.style.setProperty('position', 'fixed', 'important')
    host.style.setProperty('z-index', '2147483647', 'important')
    const shadow = host.attachShadow({ mode: 'closed' })
    const styles = new CSSStyleSheet()
    styles.replaceSync(`
        :host { color-scheme: light; }
        .pill { display:flex; align-items:center; gap:7px; padding:5px 6px; color:#fff; background:#18181b; border:1px solid #3f3f46; border-radius:999px; box-shadow:0 5px 20px #0004; font:500 13px/1.3 system-ui; }
        .dot { width:8px; height:8px; border-radius:50%; background:#f87171; }
        .paused .dot { background:#a1a1aa; }
        button { padding:6px 8px; border:0; border-radius:999px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
        button:hover { background:#3f3f46; }
        button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
        time { font-variant-numeric:tabular-nums; min-width:36px; }
        .move { cursor:grab; touch-action:none; color:#d4d4d8; }
        .stop { background:#991b1b; }
        .stop:hover { background:#b91c1c; }
    `)
    shadow.adoptedStyleSheets = [styles]
    const pill = document.createElement('div')
    pill.className = 'pill'
    pill.setAttribute('role', 'group')
    pill.setAttribute('aria-label', 'Zapp recording controls')
    const move = button('⠿', 'move')
    move.setAttribute('aria-label', 'Move recording controls with drag or arrow keys')
    move.title = 'Drag to move'
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.setAttribute('aria-hidden', 'true')
    const duration = document.createElement('time')
    duration.setAttribute('aria-label', 'Recording duration')
    const pause = button('Pause', 'pause')
    const stop = button('Stop', 'stop')
    pill.append(move, dot, duration, pause, stop)
    shadow.append(pill)
    const act = (button, action) => async () => {
      button.disabled = true
      try {
        const result = await send(action)
        if (!result?.ok) button.title = result?.error ?? 'Try using the Zapp popup.'
      } catch {
        button.title = 'Try using the Zapp popup.'
      } finally {
        button.disabled = false
      }
    }
    pause.addEventListener('click', act(pause, 'toggle-pause'))
    stop.addEventListener('click', act(stop, 'stop'))
    document.documentElement.append(host)
    place(position?.x ?? innerWidth - pill.offsetWidth - 24, position?.y ?? innerHeight - pill.offsetHeight - 24)
    let drag
    move.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      drag = { pointer: event.pointerId, x: event.clientX - position.x, y: event.clientY - position.y }
      move.setPointerCapture(event.pointerId)
    })
    move.addEventListener('pointermove', (event) => {
      if (drag?.pointer === event.pointerId) place(event.clientX - drag.x, event.clientY - drag.y)
    })
    move.addEventListener('lostpointercapture', () => { drag = null })
    move.addEventListener('keydown', (event) => {
      const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key]
      if (!delta) return
      event.preventDefault()
      place(position.x + delta[0], position.y + delta[1])
    })
    paint = () => {
      const seconds = Math.floor((state.durationMs + (state.paused ? 0 : performance.now() - receivedAt)) / 1000)
      duration.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      pause.textContent = state.paused ? 'Resume' : 'Pause'
      pill.classList.toggle('paused', state.paused)
    }
    timer = setInterval(paint, 250)
  }

  function button(text, className) {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = className
    element.textContent = text
    return element
  }

  function place(x, y) {
    const rect = host.getBoundingClientRect()
    position = {
      x: Math.round(Math.max(0, Math.min(x, innerWidth - rect.width))),
      y: Math.round(Math.max(0, Math.min(y, innerHeight - rect.height))),
    }
    host.style.setProperty('left', `${position.x}px`, 'important')
    host.style.setProperty('top', `${position.y}px`, 'important')
  }

  window.addEventListener('resize', () => { if (host) place(position.x, position.y) }, { passive: true })
  window.addEventListener('zapp:page-observation', (event) => {
    if (!state || state.paused || typeof event.detail !== 'string' || event.detail.length > 4500) return
    try {
      const data = JSON.parse(event.detail)
      if (data && ['console', 'resource'].includes(data.kind)) void send('page-event', { data }).catch(() => {})
    } catch {
      // The page can dispatch arbitrary events. Ignore malformed observations.
    }
  })
  window.addEventListener('click', (event) => {
    if (!state || state.paused || !event.isTrusted || event.composedPath().includes(host)) return
    const tag = event.target instanceof Element ? event.target.tagName.toLowerCase() : ''
    if (tag) void send('page-event', { data: { kind: 'click', tag } }).catch(() => {})
  }, { capture: true, passive: true })
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message.to !== 'overlay') return
    if (message.type === 'hide' && state?.id === message.id) {
      hide()
      return
    }
    if (message.type !== 'show' && !(message.type === 'update' && state?.id === message.id)) return
    state = message
    receivedAt = performance.now()
    show()
    paint()
  })
})()
