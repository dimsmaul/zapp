(() => {
  if (globalThis.zappPanel) return
  globalThis.zappPanel = true
  const extensionUrl = chrome.runtime.getURL('')
  const PANEL_WIDTH = 380
  let host

  function close() {
    host?.remove()
    host = null
  }

  function open(url) {
    close()
    host = document.createElement('zapp-panel')
    host.style.setProperty('all', 'initial', 'important')
    host.style.setProperty('position', 'fixed', 'important')
    host.style.setProperty('top', '16px', 'important')
    host.style.setProperty('right', '16px', 'important')
    host.style.setProperty('z-index', '2147483647', 'important')
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      :host { color-scheme: light dark; }
      .panel { box-sizing: border-box; width: ${PANEL_WIDTH}px; max-width: calc(100vw - 32px); overflow: hidden; border: 1px solid oklch(0.922 0 0); border-radius: 20px; background: oklch(1 0 0); box-shadow: 0 16px 48px #0004, 0 2px 8px #0002; animation: enter .14s ease-out; }
      iframe { display: block; width: 100%; height: 280px; border: 0; background: transparent; }
      @keyframes enter { from { opacity: 0; transform: translateY(-6px) scale(.985); } }
      @media (prefers-color-scheme: dark) { .panel { border-color: oklch(1 0 0 / 14%); background: oklch(0.145 0 0); } }
      @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
    `)
    shadow.adoptedStyleSheets = [sheet]
    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Zapp')
    const frame = document.createElement('iframe')
    frame.title = 'Zapp'
    frame.allow = 'clipboard-write'
    frame.src = url
    panel.append(frame)
    shadow.append(panel)
    document.documentElement.append(host)

    // The panel page reports its content height and asks to be closed; nothing else is trusted.
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== extensionUrl.slice(0, -1)) return
      const message = event.data
      if (message === 'zapp-panel-close') return close()
      if (message?.type === 'zapp-panel-size' && Number.isFinite(message.height)) {
        frame.style.height = `${Math.min(Math.max(Math.ceil(message.height), 120), innerHeight - 34)}px`
      }
    }
    window.addEventListener('message', onMessage)
    const observer = new MutationObserver(() => {
      if (host && !host.isConnected) {
        window.removeEventListener('message', onMessage)
        observer.disconnect()
      }
    })
    observer.observe(document.documentElement, { childList: true })
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.to !== 'panel' || sender.id !== chrome.runtime.id || sender.tab) return
    if (message.type === 'close') {
      close()
      reply(true)
      return
    }
    if (message.type === 'toggle') {
      if (host) close()
      else if (typeof message.url === 'string' && message.url.startsWith(`${extensionUrl}popup.html?`)) open(message.url)
      reply(true)
    }
  })
})()
