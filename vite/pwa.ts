import process from "node:process";

import { VitePWA } from "vite-plugin-pwa";

export function openPencilPwaPlugin() {
  return VitePWA({
    // CI: the hosted Studio is an iframe served by nginx with immutable hashed assets;
    // a service worker would pin a stale bundle against a newer host protocol (ADR-058 §8).
    disable: process.env.VITE_CI_STUDIO === "1",
    registerType: "autoUpdate",
    devOptions: { enabled: false },
    workbox: {
      maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      globPatterns: ["**/*.{js,css,html,wasm,png,svg,ico,ttf,webmanifest}"],
      navigateFallback: "/index.html",
    },
    manifest: {
      name: "OpenPencil",
      short_name: "OpenPencil",
      description: "Open-source design editor",
      display: "standalone",
      orientation: "any",
      start_url: "/",
      scope: "/",
      theme_color: "#1e1e1e",
      background_color: "#1e1e1e",
      categories: ["design", "productivity"],
      icons: [
        {
          src: "/brand/pwa-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/brand/pwa-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/brand/pwa-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
  });
}
