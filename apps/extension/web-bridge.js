// Runs on the Zapp website only (registered when you connect to a server). It lets the website's
// "New Zapp" button open the extension panel. The page can ask for nothing else.
(() => {
  if (globalThis.zappBridge) return
  globalThis.zappBridge = true
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.zapp !== 'open') return
    // A recording link says where the recording should go. Anything that is not a short string is dropped.
    const short = (value) => (typeof value === 'string' && value.length <= 80 ? value : null)
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
