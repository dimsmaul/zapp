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
      dialog { box-sizing: border-box; width: min(96vw, 1440px); height: min(92dvh, 1000px); max-width: none; max-height: none; padding: 0; margin: auto; overflow: hidden; border: 1px solid #d4d4d8; border-radius: 16px; background: #fafafa; color: #18181b; box-shadow: 0 24px 64px #0004; font: 14px/1.5 system-ui; }
      dialog[open] { display: flex; flex-direction: column; }
      dialog::backdrop { background: #18181bb3; }
      header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #e4e4e7; }
      button { border: 1px solid #e4e4e7; border-radius: 8px; padding: 6px 12px; background: white; color: inherit; font: inherit; cursor: pointer; }
      button:focus-visible { outline: 2px solid #52525b; outline-offset: 2px; }
      iframe { width: 100%; min-height: 0; flex: 1; border: 0; }
      p { margin: 1rem; }
    `)
    shadow.adoptedStyleSheets = [sheet]
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Zapp capture preview')
    const header = document.createElement('header')
    const title = document.createElement('strong')
    title.textContent = 'Zapp capture preview'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.autofocus = true
    close.addEventListener('click', () => dialog.close())
    header.append(title, close)

    const fallback = document.createElement('p')
    fallback.textContent = 'Loading preview…'
    fallback.setAttribute('role', 'status')
    const frame = document.createElement('iframe')
    frame.title = 'Zapp capture preview'
    frame.allow = 'clipboard-write; fullscreen'
    frame.src = url
    const deadline = setTimeout(() => {
      fallback.textContent = 'Preview did not load. Your capture is saved in Zapp drafts.'
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
    dialog.append(header, fallback, frame)
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
