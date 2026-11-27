// Runs on the Zapp website only (registered when you connect to a server). It lets the website's
// "New Zapp" button open the extension panel. The page can ask for nothing else.
(() => {
  if (globalThis.zappBridge) return
  globalThis.zappBridge = true
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.zapp !== 'open') return
    let opened = false
    try {
      const result = await chrome.runtime.sendMessage({ to: 'background', type: 'open-panel' })
      opened = Boolean(result?.ok)
    } catch {
      // The extension was reloaded or removed while this page stayed open.
    }
    window.postMessage({ zapp: opened ? 'opened' : 'unavailable' }, location.origin)
  })
})()
