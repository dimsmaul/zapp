/**
 * Gives the extension the session made for it after sign-in (through its content script on this site).
 * Rejects with a readable message when the extension is missing, not connected, or refuses the sign-in.
 */
export function signInExtension(session: { state: string; token: string; expiresAt: string; userId: string }, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.zapp === "signed-in") finish();
      if (event.data?.zapp === "sign-in-failed") finish(String(event.data.error ?? "The extension could not finish signing in."));
    };
    const timer = setTimeout(() => finish("The Zapp extension did not respond. Make sure it is up to date and connected to this server, then reload this page."), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ zapp: "sign-in", ...session }, window.location.origin);
  });
}

/** Where a recording should go. Sent along when a recording link opens the extension. */
export type RecordingTarget = { workspaceId: string; folderId: string | null; folderName: string | null };

// Asks the Zapp extension (through its content script on this site) to open its panel.
// Resolves false when the extension is not installed, not connected to this site, or does not answer.
export function openExtension(target?: RecordingTarget, timeoutMs = 800): Promise<boolean> {
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
    window.postMessage({ zapp: "open", target }, window.location.origin);
  });
}
