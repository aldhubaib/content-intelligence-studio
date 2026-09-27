// CI: the nginx site keeps the S-11 contract — a restarting sidecar is 503, never a bare 502 (INC-18).
//
// nginx is not available where the unit tests run (`nginx -t` happens in the
// image build); this reads the template as text and asserts the structure the
// worker's deferral depends on.
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('../../deploy/nginx/studio.conf.template', import.meta.url))

/** Body of every `location <selector> { … }` block, keyed by its selector. */
function locations(conf: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /location\s+([^{]+?)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(conf)) !== null) {
    let depth = 1
    let i = re.lastIndex
    for (; i < conf.length && depth > 0; i += 1) {
      if (conf[i] === '{') depth += 1
      else if (conf[i] === '}') depth -= 1
    }
    out.set(match[1]?.trim() ?? '', conf.slice(re.lastIndex, i - 1))
  }
  return out
}

describe('deploy/nginx/studio.conf.template (S-11)', () => {
  test('every location proxied to the sidecar turns 502 / 504 into 503 render_unavailable', async () => {
    const conf = await readFile(TEMPLATE, 'utf8')
    const blocks = locations(conf)
    const proxied = [...blocks.entries()].filter(([, body]) => body.includes('proxy_pass'))
    expect(proxied.map(([selector]) => selector).sort()).toEqual(
      ['/internal/', '= /healthz/render', '= /internal/healthz'].sort()
    )
    for (const [selector, body] of proxied) {
      const target = selector === '= /healthz/render' ? '/healthz/render/unavailable' : '/internal/unavailable'
      expect(body, selector).toContain(`error_page 502 504 =503 ${target};`)
      // The sidecar's own 503s (render_busy, render_unavailable, not_configured) must pass through.
      expect(body, selector).not.toContain('proxy_intercept_errors')
    }
  })

  test('the unavailable answers are internal, JSON, 503, with Retry-After', async () => {
    const blocks = locations(await readFile(TEMPLATE, 'utf8'))
    for (const selector of ['= /internal/unavailable', '= /healthz/render/unavailable']) {
      const body = blocks.get(selector)
      expect(body, selector).toBeDefined()
      expect(body).toContain('internal;')
      expect(body).toContain('default_type application/json;')
      expect(body).toContain('add_header Retry-After "2" always;')
      expect(body).toMatch(/return 503 '\{[^']*"error":"render_unavailable"[^']*\}';/)
    }
    expect(blocks.get('= /healthz/render/unavailable')).toContain('"ok":false')
  })

  test('/healthz stays the static editor probe and /healthz/render reaches the sidecar without a bearer', async () => {
    const blocks = locations(await readFile(TEMPLATE, 'utf8'))
    expect(blocks.get('= /healthz')).toContain('return 200 "ok\\n";')
    expect(blocks.get('= /healthz')).not.toContain('proxy_pass')
    const render = blocks.get('= /healthz/render') ?? ''
    // envsubst fills the port; the literal `${…}` is what the template must carry.
    expect(render).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:\$\{STUDIO_RENDER_PORT\}\/healthz\/render;/)
    expect(render).not.toContain('$http_authorization')
    // The bearer gate still guards the render route.
    expect(blocks.get('/internal/')).toContain('if ($http_authorization = "")')
  })

  test('braces balance (a broken template would fail nginx -t in the image)', async () => {
    const conf = await readFile(TEMPLATE, 'utf8')
    const open = (conf.match(/\{/g) ?? []).length
    const close = (conf.match(/\}/g) ?? []).length
    expect(open).toBe(close)
  })
})
