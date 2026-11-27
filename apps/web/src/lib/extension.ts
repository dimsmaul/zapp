// Asks the Zapp extension (through its content script on this site) to open its panel.
// Resolves false when the extension is not installed, not connected to this site, or does not answer.
export function openExtension(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (opened: boolean) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(opened);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.zapp === "opened") finish(true);
      if (event.data?.zapp === "unavailable") finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ zapp: "open" }, window.location.origin);
  });
}
