import { readFileSync } from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'

// Runs against the Firestore emulator started by `npm run test:rules`. The
// demo- project id keeps every read and write away from the real project.
export const PROJECT_ID = 'demo-hengam'

export async function createEnv() {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':')
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host,
      port: Number(port),
    },
  })
}

// Writes fixtures with rules switched off, the way the Admin SDK would.
export async function seed(env, docs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [path, data] of Object.entries(docs)) await db.doc(path).set(data)
  })
}
