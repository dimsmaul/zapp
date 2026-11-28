// Runs on the Zapp website only (registered when you connect to a server). It lets the website's
// "New Zapp" button open the extension panel. The page can ask for nothing else.
(() => {
  if (globalThis.zappBridge) return
  globalThis.zappBridge = true
  const short = (value, max = 80) => (typeof value === 'string' && value.length <= max ? value : null)

  // The website hands over the session it just made for this extension after you sign in.
  async function signIn(data) {
    const session = {
      state: short(data.state), token: short(data.token, 512), expiresAt: short(data.expiresAt), userId: short(data.userId),
    }
    let error = 'The extension could not finish signing in.'
    try {
      const result = await chrome.runtime.sendMessage({ to: 'background', type: 'auth-session', ...session })
      if (result?.ok) return window.postMessage({ zapp: 'signed-in' }, location.origin)
      error = result?.error ?? error
    } catch {
      // The extension was reloaded or removed while this page stayed open.
    }
    window.postMessage({ zapp: 'sign-in-failed', error }, location.origin)
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    if (event.data?.zapp === 'sign-in') return signIn(event.data)
    if (event.data?.zapp !== 'open') return
    // A recording link says where the recording should go. Anything that is not a short string is dropped.
    const raw = event.data.target
    const target = raw && short(raw.workspaceId)
      ? { workspaceId: short(raw.workspaceId), folderId: short(raw.folderId), folderName: short(raw.folderName) }
      : null
    let opened = false
    try {
      const result = await chrome.runtime.sendMessage({ to: 'background', type: 'open-panel', target })
      opened = Boolean(result?.ok)
    } catch {
      // The extension was reloaded or removed while this page stayed open.
    }
    window.postMessage({ zapp: opened ? 'opened' : 'unavailable' }, location.origin)
  })
})()
