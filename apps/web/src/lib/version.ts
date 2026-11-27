// Injected at build time from the release tag (web-vX.Y.Z or web-vX.Y.Z-beta.N).
export const VERSION: string = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_ZAPP_VERSION ?? "dev";
export const IS_BETA = VERSION.includes("-beta");
