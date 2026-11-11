import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// The staging allowlist names real hosts and projects, so it is kept out of
// the public repository: loadtest/.data/targets.json (git-ignored) when it
// exists, otherwise the empty template in loadtest/config/targets.json.
export function targetsPath(loadtestRoot) {
  const local = resolve(loadtestRoot, '.data/targets.json')
  return existsSync(local) ? local : resolve(loadtestRoot, 'config/targets.json')
}
