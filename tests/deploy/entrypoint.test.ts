// CI: the container entrypoint supervises the sidecar and lives with nginx (S-11, INC-18).
//
// The script is spawned with a fake `bun` (first on PATH) and a fake nginx
// entrypoint, both tiny shell programs that record their starts and exit codes
// in the temp directory, so the loop's decisions can be read back from files
// and from the JSON lines on stdout. Timings follow the real 1 s tick.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRYPOINT = fileURLToPath(new URL('../../deploy/entrypoint.sh', import.meta.url))

/** The fake sidecar: pops the next exit code from PLAN, sleeps, exits; TERM → records it and exits 0. */
const FAKE_BUN = `#!/bin/sh
# fake bun: "$1" is studio-render/server.ts
dir="$FAKE_DIR"
echo "start $$" >> "$dir/sidecar.log"
trap 'echo term >> "$dir/sidecar.log"; exit 0' TERM INT
n=$(cat "$dir/plan.index" 2>/dev/null || echo 0)
code=$(sed -n "$((n + 1))p" "$dir/plan" 2>/dev/null)
echo $((n + 1)) > "$dir/plan.index"
if [ -z "$code" ]; then
  # Plan exhausted: stay up until told to stop.
  while :; do sleep 1; done
fi
sleep "\${FAKE_BUN_SLEEP:-0.2}"
echo "exit $code" >> "$dir/sidecar.log"
exit "$code"
`

/** The fake nginx entrypoint: writes its pid, stays up, exits 0 on TERM. */
const FAKE_NGINX = `#!/bin/sh
dir="$FAKE_DIR"
echo $$ > "$dir/nginx.pid"
echo "start $*" >> "$dir/nginx.log"
trap 'echo term >> "$dir/nginx.log"; exit 0' TERM INT
while :; do sleep 1; done
`

interface Harness {
  dir: string
  proc: ReturnType<typeof Bun.spawn>
  stdout: Promise<string>
  sidecarLog: () => Promise<string[]>
  nginxPid: () => Promise<number>
}

const harnesses: Harness[] = []

/** Lines of a log the fakes append to; absent before the first write. */
async function readLines(path: string): Promise<string[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  return (await file.text()).split('\n').filter(Boolean)
}

async function start(plan: number[], env: Record<string, string> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'studio-entrypoint-'))
  const bin = join(dir, 'bin')
  await Bun.write(join(bin, 'bun'), FAKE_BUN)
  await Bun.write(join(dir, 'nginx-entrypoint.sh'), FAKE_NGINX)
  await Bun.$`chmod +x ${join(bin, 'bun')} ${join(dir, 'nginx-entrypoint.sh')}`.quiet()
  await writeFile(join(dir, 'plan'), plan.map(String).join('\n') + '\n')
  const proc = Bun.spawn(['sh', ENTRYPOINT, 'nginx', '-g', 'daemon off;'], {
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_DIR: dir,
      STUDIO_HOME: dir,
      NGINX_ENTRYPOINT: join(dir, 'nginx-entrypoint.sh'),
      STUDIO_INTERNAL_SECRET: 'test-secret-0123456789abcdef',
      ...env
    },
    stdout: 'pipe',
    stderr: 'inherit'
  })
  const harness: Harness = {
    dir,
    proc,
    stdout: new Response(proc.stdout).text(),
    sidecarLog: () => readLines(join(dir, 'sidecar.log')),
    nginxPid: async () => Number((await readFile(join(dir, 'nginx.pid'), 'utf8')).trim())
  }
  harnesses.push(harness)
  return harness
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

interface LogLine {
  event: string
  code?: number
  restartInMs?: number | null
  starts?: number
  uptimeSec?: number
}

function parseLog(stdout: string): LogLine[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as LogLine)
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    // A test that ended early leaves the supervisor running; `kill` on an exited process is a no-op.
    if (h.proc.exitCode === null) h.proc.kill('SIGKILL')
    await h.proc.exited
    await rm(h.dir, { recursive: true, force: true })
  }
})

describe('deploy/entrypoint.sh', () => {
  test(
    'a recycle (exit 0) restarts the sidecar at once; a crash restarts after a backoff that doubles',
    async () => {
      // exit 0 → at once; exit 3 → 1 s; exit 3 → 2 s; then stays up.
      const h = await start([0, 3, 3])
      await waitFor(async () => (await h.sidecarLog()).filter((l) => l.startsWith('start')).length >= 4, 8000, '4 sidecar starts')
      const lines = await h.sidecarLog()
      expect(lines.filter((l) => l.startsWith('exit'))).toEqual(['exit 0', 'exit 3', 'exit 3'])
      // nginx never noticed.
      expect(await readLines(join(h.dir, 'nginx.log'))).toEqual(['start nginx -g daemon off;'])
      expect(h.proc.exitCode).toBeNull()

      h.proc.kill('SIGTERM')
      expect(await h.proc.exited).toBe(1)
      const log = parseLog(await h.stdout)
      const exits = log.filter((l) => l.event === 'sidecar-exited')
      expect(exits.map((l) => [l.code, l.restartInMs])).toEqual([
        [0, 0],
        [3, 1000],
        [3, 2000],
        [0, null] // the running sidecar, stopped by the forwarded TERM
      ])
      expect(log.filter((l) => l.event === 'sidecar-started').map((l) => l.starts)).toEqual([1, 2, 3, 4])
      expect(log.some((l) => l.event === 'stopping')).toBe(true)
      expect(log.at(-1)?.event).toBe('nginx-exited')
      expect((await h.sidecarLog()).at(-1)).toBe('term')
      expect(await readLines(join(h.dir, 'nginx.log'))).toEqual(['start nginx -g daemon off;', 'term'])
    },
    20_000
  )

  test(
    'the backoff caps and resets after a long enough life',
    async () => {
      // Cap at 2 s; a sidecar that lived ≥ 1 s resets the backoff to 1 s.
      const h = await start([1, 1, 1, 1], {
        STUDIO_SIDECAR_BACKOFF_MAX_S: '2',
        STUDIO_SIDECAR_BACKOFF_RESET_S: '1',
        FAKE_BUN_SLEEP: '1.1'
      })
      await waitFor(async () => (await h.sidecarLog()).filter((l) => l.startsWith('start')).length >= 5, 15_000, '5 sidecar starts')
      h.proc.kill('SIGTERM')
      await h.proc.exited
      const exits = parseLog(await h.stdout).filter((l) => l.event === 'sidecar-exited' && l.restartInMs !== null)
      // Every life lasted ≥ 1 s, so the backoff resets before each crash: 1 s, 1 s, 1 s, 1 s.
      expect(exits.map((l) => l.restartInMs)).toEqual([1000, 1000, 1000, 1000])
      expect(exits.every((l) => (l.uptimeSec ?? 0) >= 1)).toBe(true)
    },
    30_000
  )

  test(
    'the backoff doubles up to the cap while the sidecar keeps dying young',
    async () => {
      const h = await start([1, 1, 1], { STUDIO_SIDECAR_BACKOFF_MAX_S: '2' })
      await waitFor(async () => (await h.sidecarLog()).filter((l) => l.startsWith('start')).length >= 4, 12_000, '4 sidecar starts')
      h.proc.kill('SIGTERM')
      await h.proc.exited
      const exits = parseLog(await h.stdout).filter((l) => l.event === 'sidecar-exited' && l.restartInMs !== null)
      expect(exits.map((l) => l.restartInMs)).toEqual([1000, 2000, 2000])
    },
    20_000
  )

  test(
    'when nginx exits the container exits 1 and the sidecar is stopped',
    async () => {
      const h = await start([])
      await waitFor(async () => (await h.sidecarLog()).length >= 1, 5000, 'the sidecar to start')
      const nginxPid = await h.nginxPid()
      // nginx "exits 0": the container must still exit non-zero.
      process.kill(nginxPid, 'SIGTERM')
      expect(await h.proc.exited).toBe(1)
      const log = parseLog(await h.stdout)
      expect(log.at(-1)).toEqual({ event: 'nginx-exited', code: 0, service: 'studio-entrypoint' } as LogLine)
      expect(await h.sidecarLog()).toEqual([(await h.sidecarLog())[0] ?? '', 'term'])
      expect(log.some((l) => l.event === 'sidecar-exited')).toBe(false)
    },
    15_000
  )

  test(
    'SIGINT is forwarded to both and the sidecar is not restarted after a stop was requested',
    async () => {
      const h = await start([])
      await waitFor(async () => (await h.sidecarLog()).length >= 1, 5000, 'the sidecar to start')
      h.proc.kill('SIGINT')
      expect(await h.proc.exited).toBe(1)
      const log = parseLog(await h.stdout)
      expect(log.filter((l) => l.event === 'sidecar-started')).toHaveLength(1)
      expect(log.find((l) => l.event === 'sidecar-exited')?.restartInMs).toBeNull()
      expect((await h.sidecarLog()).at(-1)).toBe('term')
      expect((await readLines(join(h.dir, 'nginx.log'))).at(-1)).toBe('term')
    },
    15_000
  )
})
