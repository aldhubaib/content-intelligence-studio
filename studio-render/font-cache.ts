// CI: content-addressed in-memory font cache for the render sidecar (Track E3c Part E).
//
// Faces are keyed by the sha256 of their bytes. A ref without `data` whose
// hash is unknown is reported as missing (→ 428); a ref with `data` is
// verified against its declared hash before it is admitted — a mismatch is a
// bad request, never a poisoned cache. LRU by bytes, bounded by
// STUDIO_RENDER_FONT_CACHE_MB.

import type { FontRef } from './protocol'

export interface CachedFont {
  family: string
  weight: 400 | 700
  hash: string
  data: ArrayBuffer
}

export type ResolveFontsResult =
  | { ok: true; fonts: CachedFont[] }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'hash_mismatch' | 'bad_base64'; hash: string }

export class FontCache {
  private readonly entries = new Map<string, CachedFont>()
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size
  }

  get byteLength(): number {
    return this.bytes
  }

  has(hash: string): boolean {
    return this.entries.has(hash)
  }

  /** Admit `data` under `hash` after verifying the digest. */
  async put(ref: Omit<FontRef, 'data'>, data: ArrayBuffer): Promise<CachedFont | null> {
    const digest = await sha256Hex(data)
    if (digest !== ref.hash) return null
    const existing = this.entries.get(ref.hash)
    if (existing) {
      this.touch(ref.hash, existing)
      return existing
    }
    const entry: CachedFont = { family: ref.family, weight: ref.weight, hash: ref.hash, data }
    this.entries.set(ref.hash, entry)
    this.bytes += data.byteLength
    this.evict()
    return entry
  }

  /** Every ref resolved to bytes, or the list of hashes the caller must send. */
  async resolve(refs: readonly FontRef[]): Promise<ResolveFontsResult> {
    const fonts: CachedFont[] = []
    const missing: string[] = []
    for (const ref of refs) {
      const cached = this.entries.get(ref.hash)
      if (cached) {
        this.touch(ref.hash, cached)
        // The family / weight travel with the request; the bytes are what is cached.
        fonts.push({ ...cached, family: ref.family, weight: ref.weight })
        continue
      }
      if (ref.data === undefined) {
        missing.push(ref.hash)
        continue
      }
      let data: ArrayBuffer
      try {
        data = decodeBase64(ref.data)
      } catch {
        return { ok: false, reason: 'bad_base64', hash: ref.hash }
      }
      const entry = await this.put(ref, data)
      if (!entry) return { ok: false, reason: 'hash_mismatch', hash: ref.hash }
      fonts.push(entry)
    }
    if (missing.length)
      return { ok: false, reason: 'missing', missing: Array.from(new Set(missing)) }
    return { ok: true, fonts }
  }

  private touch(hash: string, entry: CachedFont): void {
    // Map iteration order is insertion order: re-insert to mark as most recently used.
    this.entries.delete(hash)
    this.entries.set(hash, entry)
  }

  private evict(): void {
    for (const [hash, entry] of this.entries) {
      if (this.bytes <= this.maxBytes || this.entries.size <= 1) return
      this.entries.delete(hash)
      this.bytes -= entry.data.byteLength
    }
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function decodeBase64(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
