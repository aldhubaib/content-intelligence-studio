// CI: Content Intelligence Studio build flags.
//
// `VITE_CI_STUDIO=1` is the compile-time switch for the hosted Studio service
// (ADR-058 §8). Vite inlines `import.meta.env.VITE_CI_STUDIO` as a string
// literal, so every `if (CI_STUDIO)` / `v-if="!CI_STUDIO"` guard folds away in
// the upstream build and the stripped surfaces (collab / share, cloud storage
// accounts, MCP, demo route, desktop updater) never reach the hosted bundle.
//
// Runtime hosted-mode detection (URL parameters written by the app) lives in
// `./hosted.ts`; this file only knows what the bundle was built for.

/** True when the bundle was produced with `VITE_CI_STUDIO=1` (the Studio service). */
export const CI_STUDIO: boolean = import.meta.env.VITE_CI_STUDIO === "1";
