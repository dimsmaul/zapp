(() => {
  if (globalThis.zappReviewOverlay) return
  globalThis.zappReviewOverlay = true
  const extensionUrl = chrome.runtime.getURL('')
  let currentDialog

  function open(url) {
    currentDialog?.close()
    const focused = document.activeElement
    const host = document.createElement('zapp-capture-review')
    host.style.setProperty('all', 'initial', 'important')
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      dialog { box-sizing: border-box; position: relative; width: min(96vw, 1440px); height: min(92dvh, 1000px); max-width: none; max-height: none; padding: 0; margin: auto; overflow: hidden; border: 1px solid oklch(0.922 0 0); border-radius: 24px; background: oklch(1 0 0); color: oklch(0.145 0 0); color-scheme: light dark; box-shadow: 0 24px 64px #0004; font: 14px/1.5 system-ui; }
      dialog[open] { display: flex; }
      dialog::backdrop { background: oklch(0.145 0 0 / 70%); backdrop-filter: blur(2px); }
      iframe { width: 100%; height: 100%; border: 0; }
      .message { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 12px; text-align: center; background: inherit; }
      .message[hidden] { display: none; }
      button { border: 1px solid oklch(0.922 0 0); border-radius: 12px; padding: 6px 14px; background: oklch(1 0 0); color: inherit; font: inherit; cursor: pointer; }
      button:hover { background: oklch(0.97 0 0); }
      button:focus-visible { outline: 2px solid oklch(0.601 0.187 277.8); outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        dialog { border-color: oklch(1 0 0 / 12%); background: oklch(0.145 0 0); color: oklch(0.985 0 0); }
        button { border-color: oklch(1 0 0 / 12%); background: oklch(0.205 0 0); }
        button:hover { background: oklch(0.269 0 0); }
      }
    `)
    shadow.adoptedStyleSheets = [sheet]
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Zapp capture preview')

    // Shown until the preview page reports it is ready, and with a way out if it never does.
    const fallback = document.createElement('div')
    fallback.className = 'message'
    fallback.setAttribute('role', 'status')
    const text = document.createElement('span')
    text.textContent = 'Loading preview…'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.hidden = true
    close.addEventListener('click', () => dialog.close())
    fallback.append(text, close)
    const frame = document.createElement('iframe')
    frame.title = 'Zapp capture preview'
    frame.allow = 'clipboard-write; fullscreen'
    frame.src = url
    const deadline = setTimeout(() => {
      text.textContent = 'The preview did not load on this page. Your capture is saved as a draft in the Zapp panel.'
      close.hidden = false
    }, 5000)

    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.origin !== extensionUrl.slice(0, -1)) return
      if (event.data === 'zapp-preview-ready') {
        clearTimeout(deadline)
        fallback.hidden = true
      }
      if (event.data === 'zapp-preview-close') dialog.close()
    }
    window.addEventListener('message', onMessage)
    dialog.addEventListener('close', () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(deadline)
      host.remove()
      if (currentDialog === dialog) {
        currentDialog = undefined
        focused?.focus?.()
      }
    }, { once: true })
    dialog.append(frame, fallback)
    shadow.append(dialog)
    document.documentElement.append(host)
    currentDialog = dialog
    dialog.showModal()
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.to !== 'review' || sender.id !== chrome.runtime.id || sender.tab) return
    if (typeof message.url !== 'string' || !message.url.startsWith(`${extensionUrl}preview.html?`)) return
    open(message.url)
    reply(true)
  })
})()
