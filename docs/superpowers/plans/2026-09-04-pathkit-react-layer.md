# pathkit React Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `pathkit` a browser-side layer: per-reader progress, a context form, and unstyled React components that render a resolved path with its evidence and sources visible.

**Architecture:** A third package entry, `pathkit/react`, alongside the existing browser and node entries. Components are structurally complete and visually minimal: semantic HTML with stable `pk-` class names and `data-` attributes, no CSS shipped, so each consuming site keeps its own look. React is a peer dependency. This plan also closes the `ContentSource` abstraction debt left by Plan 1, because a second implementation of that interface becomes plausible the moment a browser consumer exists.

**Tech Stack:** TypeScript 5.9, React 19 (peer), Vitest with jsdom, @testing-library/react, tsup.

**Spec:** `docs/superpowers/specs/2026-09-03-guided-learning-engine-design.md` (sections 9 and 10)

**Repo:** `~/Documents/visualstudiocode/pathkit`, currently at 17 commits with 115 tests passing. Every path below is relative to that repo root.

## Global Constraints

- **No em dashes** anywhere: code, comments, docs, commit messages. En dashes are fine.
- TypeScript strict mode on, with `noUncheckedIndexedAccess`. No `any` in exported signatures.
- Node 20+, npm, ESM source. `@types/node` is pinned to `^20`; TypeScript is held at `^5.9.3` because version 7 dropped `ts.sys`, which tsup's declaration generation needs.
- **Content errors fail the build; runtime errors degrade quietly.** Everything in this plan is runtime: no component or store may throw on bad input, unavailable storage, or a malformed resolved path. Warn through an injected `onWarn` where one exists, and render something usable.
- **The package renders no untrusted HTML.** No `dangerouslySetInnerHTML` anywhere. Markdown rendering is supplied by the consumer.
- **No CSS ships.** Components emit class names and data attributes; consuming sites own all styling.
- React and `react/jsx-runtime` are peer dependencies and must be `external` in the build, never bundled.
- Evidence levels: `established`, `consensus`, `contested`, `anecdotal`. Sources required: 1, 1, 2, 0 respectively; omitting `evidence` is allowed and requires none.
- Commit messages: bare imperative, no conventional-commit prefix.
- **Verify "pristine output" with `npx vitest run --reporter=verbose`.** The default
  reporter suppresses console output for passing tests, so a React warning such as a
  duplicate-key error is invisible in a green run. A claim that output is clean,
  made from the default reporter, is not evidence.

## Decisions this plan locks in

1. **Markdown is the consumer's job.** Components accept `renderMarkdown?: (markdown: string) => ReactNode`. The default renders blank-line-separated paragraphs as plain text. The package never injects HTML, so a consumer choosing a markdown renderer also chooses its sanitizer. This continues Plan 1's decision that `resolve()` returns strings.
2. **The context form sits behind an explicit control**, not a first-visit prompt. Readers arriving from search want the answer; the base guide is already correct, so a gate costs a reader and buys nothing. `<PathView>` renders the base version and a "personalize this guide" toggle.
3. **Progress is anonymous and per-browser.** `LocalStorageProgressStore` with an in-memory fallback, exactly as the spec's section 9 requires. No accounts.
4. **The `ContentSource` debt is closed first**, in Task 1, before any of the React work. Plan 1 left `validateArea` and `validateAll` typed to the concrete `FileContentSource`, which means a database-backed source would require rewriting the validator that enforces the product's central promise.

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Extended: `ContentSource` gains `listAreas` and `readPathSteps`; adds `ProgressStore`. |
| `src/content/file-source.ts` | Extended: implements the widened interface, adds a lenient step reader. |
| `src/content/validate.ts` | Modified: typed against `ContentSource`, not `FileContentSource`. |
| `src/progress/memory.ts` | `InMemoryProgressStore`, also the fallback. |
| `src/progress/local-storage.ts` | `LocalStorageProgressStore`. |
| `src/progress/index.ts` | Progress exports. |
| `src/react/markdown.tsx` | The default plain-paragraph renderer and the `RenderMarkdown` type. |
| `src/react/evidence.tsx` | `<EvidenceBadge>` and `<SourceList>`. |
| `src/react/steps.tsx` | `<StepItem>` and `<StepList>`. |
| `src/react/context-form.tsx` | `<ContextForm>`. |
| `src/react/path-view.tsx` | `<PathView>` and `<MythCard>`. |
| `src/react/hooks.ts` | `useProgress` and `usePersistedContext`. |
| `src/react/index.ts` | The `pathkit/react` entry surface. |

## Task Ordering Note

Task 1 is independent of the React work and closes existing debt. Tasks 2 through 6 build up from leaves to composites, so each has something real to test before the thing that uses it exists.

---

### Task 1: Close the ContentSource abstraction

**Files:**
- Modify: `src/types.ts` (the `ContentSource` interface, and `PathManifest` moves here)
- Modify: `src/content/parse.ts` (re-export `PathManifest` from its new home)
- Modify: `src/content/file-source.ts`
- Modify: `src/content/validate.ts`
- Test: `test/validate.test.ts`, `test/file-source.test.ts`

**Interfaces:**
- Consumes: everything Plan 1 built.
- Produces: `ContentSource` widened with four members, and `validateArea(source: ContentSource, areaId: string)` / `validateAll(source: ContentSource)` accepting any implementation:
  - `listAreas(): Promise<string[]>`
  - `listPathDirectories(area: string): Promise<string[]>`
  - `getPathManifest(area: string, directory: string): Promise<PathManifest>`
  - `readPathSteps(area: string, directory: string): Promise<StepReadResult>`, where `StepReadResult = { steps: Step[]; problems: StepReadProblem[] }` and `StepReadProblem = { file: string; message: string }`

`getPath` stays exactly as it is. It is the consumer-facing method: it assembles a path in manifest order and throws on any problem, which is what a site rendering a guide wants. The three new members are the validator-facing decomposition: enumerate, read the manifest, read the steps leniently. Splitting them is what lets the validator stop reaching into the filesystem.

This closes two items parked during Plan 1. The validator was typed to the concrete filesystem class and rebuilt path directories from `source.root`, so a database-backed source could not be validated at all. Separately, a single unparseable step file aborted its whole path, hiding the problems in its valid siblings. One change fixes both: the source gains a **lenient** step reader that returns the steps it could parse alongside the problems it could not, and the validator consumes that instead of reaching for the filesystem.

- [ ] **Step 1: Write the failing tests**

Add to `test/validate.test.ts`:

```ts
  it('reports problems in the valid steps of a path that also has a broken step', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/03-broken.mdx':
        '---\nid: broken\ntitle: Broken\ncadence: sometimes\n---\nBody.',
      'plants/paths/leaf-propagation/path.yml':
        'id: leaf-propagation\ntitle: Propagating from a leaf\nsteps: [select-leaf, callus, broken]\n',
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\nevidence: established\n---\nChoose a leaf.',
    })
    expect(messages.join(' ')).toContain('cadence')
    expect(messages.join(' ')).toContain('established')
  })
```

Add to `test/file-source.test.ts`:

```ts
  it('readPathSteps returns parsable steps alongside problems', async () => {
    const source = await sourceFor({
      'plants/paths/leaf-propagation/03-broken.mdx':
        '---\nid: broken\ntitle: Broken\ncadence: sometimes\n---\nBody.',
    })
    const result = await source.readPathSteps('plants', 'leaf-propagation')
    expect(result.steps.map((step) => step.id).sort()).toEqual(['callus', 'select-leaf'])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]?.message).toContain('cadence')
  })

  it('readPathSteps reports a duplicate step id as a problem rather than throwing', async () => {
    const source = await sourceFor({
      'plants/paths/leaf-propagation/03-dupe.mdx': '---\nid: callus\ntitle: Dupe\n---\nBody.',
    })
    const result = await source.readPathSteps('plants', 'leaf-propagation')
    expect(result.problems.some((problem) => problem.message.includes('duplicate'))).toBe(true)
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/validate.test.ts test/file-source.test.ts`
Expected: FAIL, `readPathSteps` is not a function.

- [ ] **Step 3: Widen the interface in `src/types.ts`**

```ts
export interface StepReadProblem {
  file: string
  message: string
}

export interface StepReadResult {
  steps: Step[]
  problems: StepReadProblem[]
}

export interface ContentSource {
  getArea(area: string): Promise<Area>
  listAreas(): Promise<string[]>
  listPaths(area: string): Promise<PathSummary[]>
  listPathDirectories(area: string): Promise<string[]>
  getPath(area: string, id: string): Promise<Path>
  getPathManifest(area: string, directory: string): Promise<PathManifest>
  readPathSteps(area: string, directory: string): Promise<StepReadResult>
  getSubject(area: string, id: string): Promise<Subject>
  listSubjects(area: string): Promise<Subject[]>
  listMyths(area: string): Promise<Myth[]>
}
```

Import `PathManifest` into `src/types.ts` from `./content/parse`, or move the `PathManifest` interface into `src/types.ts` and re-export it from `parse.ts`. Prefer the move: types belong in the types module, and `parse.ts` already imports from there.

`listAreas` was already implemented on `FileContentSource` but deliberately left off the interface. It moves onto it now, because `validateAll` needs it and any source must be able to enumerate its areas.

- [ ] **Step 4: Add the three validator-facing methods to `src/content/file-source.ts`**

`listPathDirectories` and `getPathManifest` are extracted from what `listPaths` and `getPath` already do, so implement them first and have the existing methods call them rather than duplicating the logic:

```ts
  async listPathDirectories(area: string): Promise<string[]> {
    return readdirOrEmpty(join(this.root, area, 'paths'), { directoriesOnly: true })
  }

  async getPathManifest(area: string, directory: string): Promise<PathManifest> {
    assertSafeId(area, directory)
    const file = join(this.root, area, 'paths', directory, 'path.yml')
    return parsePathManifest(file, await readContentFile(file))
  }
```

Then rewrite `listPaths` to use them, so there is one place that knows the layout:

```ts
  async listPaths(area: string): Promise<PathSummary[]> {
    const summaries: PathSummary[] = []
    for (const directory of await this.listPathDirectories(area)) {
      const manifest = await this.getPathManifest(area, directory)
      summaries.push({ id: manifest.id, title: manifest.title, summary: manifest.summary })
    }
    return summaries.sort((a, b) => a.id.localeCompare(b.id))
  }
```

Now add the lenient reader:

```ts
  // Lenient counterpart to readSteps: returns what parsed, plus a problem per
  // file that did not, so one broken step cannot hide the rest of its path.
  async readPathSteps(area: string, directory: string): Promise<StepReadResult> {
    assertSafeId(area, directory)
    const dir = join(this.root, area, 'paths', directory)
    const steps: Step[] = []
    const problems: StepReadProblem[] = []
    const seen = new Set<string>()

    for (const name of await readdirOrEmpty(dir, { extension: '.mdx' })) {
      const file = join(dir, name)
      try {
        const step = parseStep(file, await readContentFile(file))
        if (seen.has(step.id)) {
          problems.push({ file, message: `duplicate step id "${step.id}"` })
          continue
        }
        seen.add(step.id)
        steps.push(step)
      } catch (error) {
        if (error instanceof ContentError) {
          for (const issue of error.issues) problems.push({ file: error.file, message: issue })
          continue
        }
        throw error
      }
    }

    return { steps, problems }
  }
```

Import `StepReadProblem` and `StepReadResult` from `../types`.

- [ ] **Step 5: Retype the validator and consume the lenient reader**

In `src/content/validate.ts`, change both signatures to accept `ContentSource`:

```ts
export async function validateAll(source: ContentSource): Promise<ValidationProblem[]>
export async function validateArea(source: ContentSource, areaId: string): Promise<ValidationProblem[]>
```

Import `ContentSource` and `PathManifest` from `../types` and drop the `FileContentSource` import. Nothing in this file should reference `node:path` or `source.root` when you are done; check for both before committing.

Replace the whole per-path loop. It now enumerates directories, reads each manifest, and reads each directory's steps leniently, so no filesystem knowledge remains in this file. Delete the helper that rebuilt a directory path from `source.root`, and delete the `listPaths` call, which is now only a consumer-facing convenience:

```ts
  for (const directory of await collect(() => source.listPathDirectories(areaId), problems, `${areaId}/paths`)) {
    const where = `${areaId}/paths/${directory}`

    let manifest: PathManifest
    try {
      manifest = await source.getPathManifest(areaId, directory)
    } catch (error) {
      problems.push(...toProblems(error, `${where}/path.yml`))
      continue
    }

    if (manifest.id !== directory) {
      problems.push({
        file: `${where}/path.yml`,
        message: `manifest id "${manifest.id}" does not match its directory name "${directory}"`,
      })
    }

    const read = await source.readPathSteps(areaId, directory)
    problems.push(...read.problems)

    const byId = new Map(read.steps.map((step) => [step.id, step]))
    for (const stepId of manifest.steps) {
      if (!byId.has(stepId)) {
        problems.push({ file: `${where}/path.yml`, message: `no file defines step "${stepId}"` })
      }
    }
    for (const step of read.steps) {
      if (!manifest.steps.includes(step.id)) {
        problems.push({ file: where, message: `step "${step.id}" is defined but not listed in path.yml` })
      }
    }

    for (const step of read.steps) {
      const stepWhere = `${where}/${step.id}`
      problems.push(...evidenceProblems(stepWhere, step.evidence, step.sources))
      problems.push(...conditionProblems(stepWhere, step, declaredKeys))
      problems.push(...interpolationProblems(stepWhere, step, subjects))
    }
  }
```

Note what changed in behavior, deliberately: a manifest listing a step with no file used to abort the whole path because `getPath` threw. It is now one problem among the others, so the steps that do exist still get their evidence and condition checks. That is the same fix as the broken-step-file case, applied to the missing-step case.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS including the new ones, no type errors. The 115 existing tests must still pass unmodified. If one fails, stop and report rather than editing it.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/content/file-source.ts src/content/validate.ts test/validate.test.ts test/file-source.test.ts
git commit -m "type the validator against ContentSource and read steps leniently"
```

---

### Task 2: ProgressStore

**Files:**
- Modify: `src/types.ts` (add `ProgressStore`)
- Create: `src/progress/memory.ts`, `src/progress/local-storage.ts`, `src/progress/index.ts`
- Test: `src/progress/local-storage.test.ts`, `src/progress/memory.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ProgressStore` with `get(pathId): Promise<Record<string, boolean>>` and `setStepDone(pathId, stepId, done): Promise<void>`. `InMemoryProgressStore` (constructor takes nothing). `LocalStorageProgressStore` (constructor takes an optional `{ keyPrefix?: string; storage?: Storage; onWarn?: (message: string) => void }`). Task 4's `useProgress` hook consumes both.

Storage access throws in more situations than people expect: private browsing modes, disabled site data, and embedded webviews all reject it, and some throw on read as well as write. Nothing about ticking a step off may prevent someone from reading a guide, so every access is guarded and falls back to memory.

- [ ] **Step 1: Write the failing tests**

`src/progress/memory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryProgressStore } from './memory'

describe('InMemoryProgressStore', () => {
  it('starts empty', async () => {
    expect(await new InMemoryProgressStore().get('p')).toEqual({})
  })

  it('records a step as done', async () => {
    const store = new InMemoryProgressStore()
    await store.setStepDone('p', 's', true)
    expect(await store.get('p')).toEqual({ s: true })
  })

  it('removes a step when set to not done', async () => {
    const store = new InMemoryProgressStore()
    await store.setStepDone('p', 's', true)
    await store.setStepDone('p', 's', false)
    expect(await store.get('p')).toEqual({})
  })

  it('keeps paths separate', async () => {
    const store = new InMemoryProgressStore()
    await store.setStepDone('a', 's', true)
    expect(await store.get('b')).toEqual({})
  })
})
```

`src/progress/local-storage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { LocalStorageProgressStore } from './local-storage'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

function throwingStorage(): Storage {
  const message = 'storage is disabled'
  return {
    length: 0,
    clear: () => {
      throw new Error(message)
    },
    getItem: () => {
      throw new Error(message)
    },
    key: () => {
      throw new Error(message)
    },
    removeItem: () => {
      throw new Error(message)
    },
    setItem: () => {
      throw new Error(message)
    },
  }
}

describe('LocalStorageProgressStore', () => {
  it('persists a step across instances sharing storage', async () => {
    const storage = fakeStorage()
    await new LocalStorageProgressStore({ storage }).setStepDone('p', 's', true)
    expect(await new LocalStorageProgressStore({ storage }).get('p')).toEqual({ s: true })
  })

  it('namespaces by path id', async () => {
    const storage = fakeStorage()
    const store = new LocalStorageProgressStore({ storage })
    await store.setStepDone('a', 's', true)
    expect(await store.get('b')).toEqual({})
  })

  it('falls back to memory and warns when storage throws', async () => {
    const onWarn = vi.fn()
    const store = new LocalStorageProgressStore({ storage: throwingStorage(), onWarn })
    await store.setStepDone('p', 's', true)
    expect(await store.get('p')).toEqual({ s: true })
    expect(onWarn).toHaveBeenCalled()
  })

  it('returns empty rather than throwing on corrupt stored JSON', async () => {
    const storage = fakeStorage()
    await new LocalStorageProgressStore({ storage }).setStepDone('p', 'seed', true)
    const key = storage.key(0)
    expect(key).not.toBeNull()
    storage.setItem(key as string, 'not json at all')

    const onWarn = vi.fn()
    expect(await new LocalStorageProgressStore({ storage, onWarn }).get('p')).toEqual({})
    expect(onWarn).toHaveBeenCalled()
  })

  it('ignores stored JSON of the wrong shape', async () => {
    const storage = fakeStorage()
    await new LocalStorageProgressStore({ storage }).setStepDone('p', 'seed', true)
    const key = storage.key(0)
    storage.setItem(key as string, '["not", "an", "object"]')

    const onWarn = vi.fn()
    expect(await new LocalStorageProgressStore({ storage, onWarn }).get('p')).toEqual({})
    expect(onWarn).toHaveBeenCalled()
  })

  it('degrades when touching the ambient localStorage throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied')
      },
    })
    try {
      const store = new LocalStorageProgressStore()
      await store.setStepDone('p', 's', true)
      expect(await store.get('p')).toEqual({ s: true })
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'localStorage')
      } else {
        Object.defineProperty(globalThis, 'localStorage', descriptor)
      }
    }
  })

  it('degrades to memory when no storage exists at all', async () => {
    const store = new LocalStorageProgressStore({ storage: undefined })
    await store.setStepDone('p', 's', true)
    expect(await store.get('p')).toEqual({ s: true })
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/progress`
Expected: FAIL, cannot resolve `./memory` and `./local-storage`.

- [ ] **Step 3: Add `ProgressStore` to `src/types.ts`**

```ts
export interface ProgressStore {
  get(pathId: string): Promise<Record<string, boolean>>
  setStepDone(pathId: string, stepId: string, done: boolean): Promise<void>
}
```

- [ ] **Step 4: Write `src/progress/memory.ts`**

```ts
import type { ProgressStore } from '../types'

export class InMemoryProgressStore implements ProgressStore {
  private readonly byPath = new Map<string, Record<string, boolean>>()

  async get(pathId: string): Promise<Record<string, boolean>> {
    return { ...(this.byPath.get(pathId) ?? {}) }
  }

  async setStepDone(pathId: string, stepId: string, done: boolean): Promise<void> {
    const current = { ...(this.byPath.get(pathId) ?? {}) }
    if (done) {
      current[stepId] = true
    } else {
      delete current[stepId]
    }
    this.byPath.set(pathId, current)
  }
}
```

- [ ] **Step 5: Write `src/progress/local-storage.ts`**

```ts
import type { ProgressStore } from '../types'
import { InMemoryProgressStore } from './memory'

export interface LocalStorageProgressStoreOptions {
  keyPrefix?: string
  storage?: Storage
  onWarn?: (message: string) => void
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Some browsers throw on merely touching localStorage when site data is blocked.
    return undefined
  }
}

export class LocalStorageProgressStore implements ProgressStore {
  private readonly prefix: string
  private readonly storage: Storage | undefined
  private readonly onWarn: ((message: string) => void) | undefined
  private readonly fallback = new InMemoryProgressStore()
  private degraded = false

  constructor(options: LocalStorageProgressStoreOptions = {}) {
    this.prefix = options.keyPrefix ?? 'pathkit:progress:'
    this.storage = 'storage' in options ? options.storage : defaultStorage()
    this.onWarn = options.onWarn
    if (this.storage === undefined) this.degraded = true
  }

  private key(pathId: string): string {
    return `${this.prefix}${pathId}`
  }

  private degrade(message: string): void {
    if (!this.degraded) {
      this.degraded = true
      this.onWarn?.(`${message}; progress will not persist in this browser`)
    }
  }

  async get(pathId: string): Promise<Record<string, boolean>> {
    if (this.degraded || this.storage === undefined) return this.fallback.get(pathId)

    let raw: string | null
    try {
      raw = this.storage.getItem(this.key(pathId))
    } catch (error) {
      this.degrade(`Could not read progress: ${(error as Error).message}`)
      return this.fallback.get(pathId)
    }
    if (raw === null) return {}

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.onWarn?.(`Stored progress for "${pathId}" is not valid JSON; ignoring it`)
      return {}
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

    const done: Record<string, boolean> = {}
    for (const [stepId, value] of Object.entries(parsed)) {
      if (value === true) done[stepId] = true
    }
    return done
  }

  async setStepDone(pathId: string, stepId: string, done: boolean): Promise<void> {
    if (this.degraded || this.storage === undefined) {
      return this.fallback.setStepDone(pathId, stepId, done)
    }

    const current = await this.get(pathId)
    if (done) {
      current[stepId] = true
    } else {
      delete current[stepId]
    }

    try {
      this.storage.setItem(this.key(pathId), JSON.stringify(current))
    } catch (error) {
      this.degrade(`Could not save progress: ${(error as Error).message}`)
      await this.fallback.setStepDone(pathId, stepId, done)
    }
  }
}
```

Note the `'storage' in options` check: passing `{ storage: undefined }` explicitly must mean "no storage", while omitting it means "use the ambient localStorage". A plain `??` would conflate the two and break the last test.

Two further points the tests above depend on. Warn on wrong-shape stored JSON as
well as on unparseable JSON, so a reader debugging a silent progress reset gets
the same signal either way. And do not assume a thrown value is an `Error`:
use a `describeError(error: unknown)` helper returning
`error instanceof Error ? error.message : String(error)` in both catch blocks,
or a non-Error throw produces a warning reading "undefined".

The corrupt-data tests deliberately seed through the store's own write and then
overwrite whichever key it chose, rather than naming `pathkit:progress:p`
directly. Task 5 refactors this class onto a shared storage helper and requires
these tests to pass unchanged, so a test that hardcodes the key layout would
break on a refactor that changed nothing about the public contract.

- [ ] **Step 6: Write `src/progress/index.ts`**

```ts
export { InMemoryProgressStore } from './memory'
export { LocalStorageProgressStore } from './local-storage'
export type { LocalStorageProgressStoreOptions } from './local-storage'
```

- [ ] **Step 7: Run the tests and the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/progress
git commit -m "add progress stores with an in-memory fallback"
```

---

### Task 3: React entry, markdown default, and the evidence components

**Files:**
- Modify: `package.json` (peer deps, dev deps, `./react` export), `tsconfig.json` (jsx), `tsup.config.ts` (react entry)
- Create: `src/react/markdown.tsx`, `src/react/evidence.tsx`, `src/react/index.ts`, `vitest.setup.ts`
- Modify: `vitest.config.ts`
- Test: `src/react/evidence.test.tsx`

**Interfaces:**
- Consumes: `EvidenceLevel` and `Source` from `src/types.ts`.
- Produces:
  - `type RenderMarkdown = (markdown: string) => ReactNode`
  - `renderPlainParagraphs: RenderMarkdown`
  - `<EvidenceBadge evidence={EvidenceLevel | undefined} />`
  - `<SourceList sources={Source[]} heading?: string />`

These two components are where the product's central promise becomes visible to a reader, so they are built before anything that composes them.

Note the key on each source list item deliberately falls back to title plus index
rather than to `reference`. Two different books can share a short-form citation
like "Chapter 4", and a `reference`-based key would collide for them. A step marked `contested` must look different from one marked `established`, and the sources have to be reachable, or the evidence model is invisible bookkeeping.

- [ ] **Step 1: Add the toolchain**

```bash
cd ~/Documents/visualstudiocode/pathkit
npm install --save-peer react
npm install -D react react-dom @types/react @types/react-dom @testing-library/react @testing-library/dom @testing-library/user-event jsdom
```

In `package.json`, set the peer range and add the export. `peerDependencies` should read `"react": "^18 || ^19"`, and add to `exports`:

```json
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js",
      "require": "./dist/react/index.cjs"
    }
```

In `tsconfig.json`, add `"jsx": "react-jsx"` to `compilerOptions`.

In `vitest.config.ts`, widen the include glob to pick up `.tsx` test files and add
a setup file. Without the first change the React tests are silently never
collected, which looks exactly like passing; without the second, Testing Library
never auto-cleans the DOM between tests and they pollute each other:

```ts
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
```

Create `vitest.setup.ts` at the repo root:

```ts
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

In `tsup.config.ts`, add `'src/react/index.ts'` to `entry` and add `external: ['react', 'react/jsx-runtime']` so React is never bundled into the package.

Tests in Tasks 4, 5 and 6 use `userEvent` from `@testing-library/user-event`, which is why it is in the install list above. The assertions throughout use plain Vitest matchers, so `@testing-library/jest-dom` is deliberately not needed.

- [ ] **Step 2: Write the failing test `src/react/evidence.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EvidenceBadge, SourceList } from './evidence'
import { renderPlainParagraphs } from './markdown'

describe('EvidenceBadge', () => {
  it('names the level in readable words', () => {
    render(<EvidenceBadge evidence="established" />)
    expect(screen.getByText('Supported by research')).toBeDefined()
  })

  it('distinguishes contested from established', () => {
    const { container } = render(<EvidenceBadge evidence="contested" />)
    expect(container.querySelector('[data-evidence="contested"]')).not.toBeNull()
    expect(screen.getByText('Credible people disagree')).toBeDefined()
  })

  it('names the consensus level in practitioner terms', () => {
    render(<EvidenceBadge evidence="consensus" />)
    expect(screen.getByText('Growers broadly agree')).toBeDefined()
  })

  it('says plainly that anecdotal is one person experience', () => {
    render(<EvidenceBadge evidence="anecdotal" />)
    expect(screen.getByText("One grower's experience")).toBeDefined()
  })

  it('renders nothing when no level is declared', () => {
    const { container } = render(<EvidenceBadge evidence={undefined} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('SourceList', () => {
  const sources = [
    { title: 'A study', url: 'https://example.org/a', finding: 'Found the thing.' },
    { title: 'A book', reference: 'Chapter 4' },
  ]

  it('renders a link for a source with a url', () => {
    render(<SourceList sources={sources} />)
    const link = screen.getByRole('link', { name: 'A study' })
    expect(link.getAttribute('href')).toBe('https://example.org/a')
  })

  it('opens external links safely', () => {
    render(<SourceList sources={sources} />)
    const link = screen.getByRole('link', { name: 'A study' })
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('shows what a source actually found', () => {
    render(<SourceList sources={sources} />)
    expect(screen.getByText('Found the thing.')).toBeDefined()
  })

  it('renders a reference-only source as text, not a link', () => {
    render(<SourceList sources={sources} />)
    expect(screen.queryByRole('link', { name: 'A book' })).toBeNull()
    expect(screen.getByText('Chapter 4')).toBeDefined()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<SourceList sources={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('does not collide keys for two sources sharing a reference', () => {
    const shared = [
      { title: 'One book', reference: 'Chapter 4' },
      { title: 'Another book', reference: 'Chapter 4' },
    ]
    const { container } = render(<SourceList sources={shared} />)
    expect(container.querySelectorAll('li.pk-source')).toHaveLength(2)
    expect(screen.getByText('One book')).toBeDefined()
    expect(screen.getByText('Another book')).toBeDefined()
  })

  it('renders a source with neither url nor reference as a plain title', () => {
    render(<SourceList sources={[{ title: 'Just a title' }]} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Just a title')).toBeDefined()
  })
})

describe('renderPlainParagraphs', () => {
  it('splits blank-line separated text into paragraphs', () => {
    const { container } = render(<div>{renderPlainParagraphs('One.\n\nTwo.')}</div>)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('does not interpret markup', () => {
    render(<div>{renderPlainParagraphs('a <b>bold</b> claim')}</div>)
    expect(screen.getByText('a <b>bold</b> claim')).toBeDefined()
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/react/evidence.test.tsx`
Expected: FAIL, cannot resolve `./evidence`.

- [ ] **Step 4: Write `src/react/markdown.tsx`**

```tsx
import type { ReactNode } from 'react'

export type RenderMarkdown = (markdown: string) => ReactNode

// The package never injects HTML. A consumer that wants real markdown supplies
// its own renderer, and with it its own sanitizer.
export const renderPlainParagraphs: RenderMarkdown = (markdown) => {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  return paragraphs.map((block, index) => (
    <p key={index} className="pk-paragraph">
      {block}
    </p>
  ))
}
```

- [ ] **Step 5: Write `src/react/evidence.tsx`**

```tsx
import type { EvidenceLevel, Source } from '../types'

const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  established: 'Supported by research',
  consensus: 'Growers broadly agree',
  contested: 'Credible people disagree',
  anecdotal: "One grower's experience",
}

export interface EvidenceBadgeProps {
  evidence: EvidenceLevel | undefined
}

// A step with no declared evidence is a routine procedural instruction, not an
// unsupported claim, so it gets no badge rather than a reassuring one.
export function EvidenceBadge({ evidence }: EvidenceBadgeProps) {
  if (evidence === undefined) return null
  return (
    <span className="pk-evidence" data-evidence={evidence}>
      {EVIDENCE_LABEL[evidence]}
    </span>
  )
}

export interface SourceListProps {
  sources: Source[]
  heading?: string
}

export function SourceList({ sources, heading = 'Sources' }: SourceListProps) {
  if (sources.length === 0) return null
  return (
    <div className="pk-sources">
      <h3 className="pk-sources-heading">{heading}</h3>
      <ol className="pk-source-items">
        {sources.map((source, index) => (
          <li className="pk-source" key={source.url ?? `${source.title}-${index}`}>
            {source.url === undefined ? (
              <span className="pk-source-title">{source.title}</span>
            ) : (
              <a className="pk-source-title" href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            )}
            {source.reference !== undefined && <span className="pk-source-reference">{source.reference}</span>}
            {source.finding !== undefined && <p className="pk-source-finding">{source.finding}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 6: Run the test and the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Create `src/react/index.ts`**

The tsup entry and the `./react` package export both point at this file, so it has
to exist for the build to succeed. Task 6 extends it with the rest of the surface:

```ts
// The React surface. Components take an optional renderMarkdown prop and
// default to plain paragraphs; this package never calls
// dangerouslySetInnerHTML or bundles a markdown parser.
export { EvidenceBadge, SourceList } from './evidence'
export type { EvidenceBadgeProps, SourceListProps } from './evidence'
export { renderPlainParagraphs } from './markdown'
export type { RenderMarkdown } from './markdown'
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts vitest.setup.ts src/react
git commit -m "add react entry with evidence badge and source list"
```

---

### Task 4: Steps and the progress hook

**Files:**
- Create: `src/react/hooks.ts`, `src/react/steps.tsx`
- Test: `src/react/steps.test.tsx`

**Interfaces:**
- Consumes: `ResolvedStep` from `src/types.ts`, `ProgressStore` from Task 2, `EvidenceBadge` from Task 3, `RenderMarkdown` and `renderPlainParagraphs` from Task 3.
- Produces:
  - `useProgress(store: ProgressStore, pathId: string): { done: Record<string, boolean>; setStepDone: (stepId: string, done: boolean) => void; ready: boolean }`
  - `<StepItem step={ResolvedStep} index={number} done={boolean} onToggle={(done: boolean) => void} renderMarkdown?={RenderMarkdown} />`
  - `<StepList steps={ResolvedStep[]} done={Record<string, boolean>} onToggle={(stepId: string, done: boolean) => void} renderMarkdown?={RenderMarkdown} />`

The step number sits outside the `<h3>` on purpose. `heading.textContent` is
recursive, so a number nested inside the heading would make the accessible heading
text read "1Let it callus", and the `StepList` test below asserts the headings are
exactly the step titles.

The `why` field renders inside a `<details>` element, collapsed by default. The spec's reasoning is that a reader who knows why bottom-watering works can adapt when their situation differs from the author's, which is the difference between a guide and a recipe. Collapsed keeps the instruction scannable while leaving the mechanism one click away.

- [ ] **Step 1: Write the failing test `src/react/steps.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StepItem, StepList } from './steps'
import type { ResolvedStep } from '../types'

const step: ResolvedStep = {
  id: 'callus',
  title: 'Let it callus',
  body: 'Dry the leaf for 3 days.',
  cadence: null,
  evidence: 'consensus',
  why: 'A dry wound resists rot.',
  sources: [{ title: 'A guide', url: 'https://example.org/a' }],
}

describe('StepItem', () => {
  it('renders the title and body', () => {
    render(<StepItem step={step} index={0} done={false} onToggle={() => {}} />)
    expect(screen.getByText('Let it callus')).toBeDefined()
    expect(screen.getByText('Dry the leaf for 3 days.')).toBeDefined()
  })

  it('shows the evidence level', () => {
    render(<StepItem step={step} index={0} done={false} onToggle={() => {}} />)
    expect(screen.getByText('Growers broadly agree')).toBeDefined()
  })

  it('keeps the why collapsed but present', () => {
    const { container } = render(<StepItem step={step} index={0} done={false} onToggle={() => {}} />)
    const details = container.querySelector('details.pk-why')
    expect(details).not.toBeNull()
    expect((details as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText('A dry wound resists rot.')).toBeDefined()
  })

  it('omits the why element entirely when there is none', () => {
    const { container } = render(
      <StepItem step={{ ...step, why: undefined }} index={0} done={false} onToggle={() => {}} />
    )
    expect(container.querySelector('details.pk-why')).toBeNull()
  })

  it('reports a toggle', async () => {
    const onToggle = vi.fn()
    render(<StepItem step={step} index={0} done={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('marks itself done for styling and assistive tech', () => {
    const { container } = render(<StepItem step={step} index={0} done onToggle={() => {}} />)
    expect(container.querySelector('[data-done="true"]')).not.toBeNull()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('shows a cadence when the step repeats', () => {
    render(<StepItem step={{ ...step, cadence: '7d' }} index={0} done={false} onToggle={() => {}} />)
    expect(screen.getByText('Repeat every 7d')).toBeDefined()
  })
})

describe('StepList', () => {
  const steps: ResolvedStep[] = [
    step,
    { id: 'plant', title: 'Plant it', body: 'Set it on dry mix.', cadence: null, sources: [] },
  ]

  it('renders every step in order', () => {
    render(<StepList steps={steps} done={{}} onToggle={() => {}} />)
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['Let it callus', 'Plant it'])
  })

  it('passes the done state through per step', () => {
    const { container } = render(<StepList steps={steps} done={{ callus: true }} onToggle={() => {}} />)
    const items = container.querySelectorAll('li.pk-step')
    expect(items[0]?.getAttribute('data-done')).toBe('true')
    expect(items[1]?.getAttribute('data-done')).toBe('false')
  })

  it('reports which step was toggled', async () => {
    const onToggle = vi.fn()
    render(<StepList steps={steps} done={{}} onToggle={onToggle} />)
    await userEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
    expect(onToggle).toHaveBeenCalledWith('plant', true)
  })

  it('renders nothing for an empty step list', () => {
    const { container } = render(<StepList steps={[]} done={{}} onToggle={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing test for the hook, appended to the same file**

```tsx
import { InMemoryProgressStore } from '../progress/memory'
import { useProgress } from './hooks'

function ProgressProbe({ store }: { store: InMemoryProgressStore }) {
  const { done, setStepDone, ready } = useProgress(store, 'p')
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="done">{Object.keys(done).sort().join(',')}</span>
      <button onClick={() => setStepDone('s', true)}>mark</button>
    </div>
  )
}

describe('useProgress', () => {
  it('starts not ready and becomes ready after loading', async () => {
    render(<ProgressProbe store={new InMemoryProgressStore()} />)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
  })

  it('loads existing progress from the store', async () => {
    const store = new InMemoryProgressStore()
    await store.setStepDone('p', 'already', true)
    render(<ProgressProbe store={store} />)
    await waitFor(() => expect(screen.getByTestId('done').textContent).toBe('already'))
  })

  it('updates immediately on toggle and persists to the store', async () => {
    const store = new InMemoryProgressStore()
    render(<ProgressProbe store={store} />)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    await userEvent.click(screen.getByRole('button', { name: 'mark' }))
    await waitFor(() => expect(screen.getByTestId('done').textContent).toBe('s'))
    expect(await store.get('p')).toEqual({ s: true })
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/react/steps.test.tsx`
Expected: FAIL, cannot resolve `./steps` and `./hooks`.

- [ ] **Step 4: Write `src/react/hooks.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import type { ProgressStore } from '../types'

export interface UseProgressResult {
  done: Record<string, boolean>
  setStepDone: (stepId: string, done: boolean) => void
  ready: boolean
}

export function useProgress(store: ProgressStore, pathId: string): UseProgressResult {
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    setReady(false)
    store
      .get(pathId)
      .then((loaded) => {
        if (active) {
          setDone(loaded)
          setReady(true)
        }
      })
      .catch(() => {
        // A store that cannot load must not stop someone reading the guide.
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [store, pathId])

  const setStepDone = useCallback(
    (stepId: string, isDone: boolean) => {
      // Update locally first so the checkbox responds immediately, then persist.
      setDone((current) => {
        const next = { ...current }
        if (isDone) {
          next[stepId] = true
        } else {
          delete next[stepId]
        }
        return next
      })
      void store.setStepDone(pathId, stepId, isDone).catch(() => {})
    },
    [store, pathId]
  )

  return { done, setStepDone, ready }
}
```

- [ ] **Step 5: Write `src/react/steps.tsx`**

```tsx
import type { ResolvedStep } from '../types'
import { EvidenceBadge } from './evidence'
import { renderPlainParagraphs, type RenderMarkdown } from './markdown'

export interface StepItemProps {
  step: ResolvedStep
  index: number
  done: boolean
  onToggle: (done: boolean) => void
  renderMarkdown?: RenderMarkdown
}

export function StepItem({ step, index, done, onToggle, renderMarkdown = renderPlainParagraphs }: StepItemProps) {
  const checkboxId = `pk-step-${step.id}`
  return (
    <li className="pk-step" data-done={String(done)} data-step-id={step.id}>
      <div className="pk-step-header">
        <input
          className="pk-step-check"
          id={checkboxId}
          type="checkbox"
          checked={done}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className="pk-step-number">{index + 1}</span>
        <h3 className="pk-step-title">
          <label htmlFor={checkboxId}>{step.title}</label>
        </h3>
        <EvidenceBadge evidence={step.evidence} />
      </div>

      <div className="pk-step-body">{renderMarkdown(step.body)}</div>

      {step.cadence !== null && <p className="pk-step-cadence">Repeat every {step.cadence}</p>}

      {step.why !== undefined && (
        <details className="pk-why">
          <summary className="pk-why-summary">Why this works</summary>
          <div className="pk-why-body">{renderMarkdown(step.why)}</div>
        </details>
      )}
    </li>
  )
}

export interface StepListProps {
  steps: ResolvedStep[]
  done: Record<string, boolean>
  onToggle: (stepId: string, done: boolean) => void
  renderMarkdown?: RenderMarkdown
}

export function StepList({ steps, done, onToggle, renderMarkdown }: StepListProps) {
  if (steps.length === 0) return null
  return (
    <ol className="pk-steps">
      {steps.map((step, index) => (
        <StepItem
          key={step.id}
          step={step}
          index={index}
          done={done[step.id] === true}
          onToggle={(isDone) => onToggle(step.id, isDone)}
          renderMarkdown={renderMarkdown}
        />
      ))}
    </ol>
  )
}
```

- [ ] **Step 6: Run the tests and the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/react/hooks.ts src/react/steps.tsx src/react/steps.test.tsx
git commit -m "add step components and the progress hook"
```

---

### Task 5: Persisted context and the context form

**Files:**
- Create: `src/storage/json.ts`
- Modify: `src/progress/local-storage.ts` (use the shared helper)
- Modify: `src/react/hooks.ts` (add `usePersistedContext`)
- Create: `src/react/context-form.tsx`
- Test: `src/storage/json.test.ts`, `src/react/context-form.test.tsx`

**Interfaces:**
- Consumes: `Area`, `Context`, `ContextValue` from `src/types.ts`; `withDefaults` and `defaultContext` from `src/resolve/index.ts`.
- Produces:
  - `safeGetJson(storage: Storage | undefined, key: string, onWarn?): unknown`
  - `safeSetJson(storage: Storage | undefined, key: string, value: unknown, onWarn?): boolean`
  - `defaultStorage(): Storage | undefined`
  - `usePersistedContext(area: Area, options?: { storage?: Storage; keyPrefix?: string; onWarn?: (message: string) => void }): { context: Context; setContext: (next: Context) => void; hydrated: boolean }`
  - `<ContextForm area={Area} value={Context} onChange={(next: Context) => void} />`

Task 2 put the storage guards inside `LocalStorageProgressStore`. Context persistence needs the same guards, so this task extracts them into one place rather than writing the try/catch pattern a second time, and points the progress store at the extracted version.

**The hydration rule, which matters more than it looks.** The consuming site statically generates the base version of a guide using `defaultContext(area)`. If `usePersistedContext` returned the stored context on its very first client render, that render would disagree with the server HTML and React would report a hydration mismatch. So the hook returns the default context on first render and applies the stored value in an effect, after hydration. `hydrated` tells a caller which state it is in.

- [ ] **Step 1: Write the failing test `src/storage/json.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { safeGetJson, safeSetJson } from './json'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('storage is disabled')
  }
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom }
}

describe('safeGetJson', () => {
  it('round trips a value', () => {
    const storage = fakeStorage()
    safeSetJson(storage, 'k', { a: 1 })
    expect(safeGetJson(storage, 'k')).toEqual({ a: 1 })
  })

  it('returns undefined for a missing key', () => {
    expect(safeGetJson(fakeStorage(), 'nope')).toBeUndefined()
  })

  it('returns undefined and warns on invalid JSON', () => {
    const storage = fakeStorage()
    storage.setItem('k', 'not json')
    const onWarn = vi.fn()
    expect(safeGetJson(storage, 'k', onWarn)).toBeUndefined()
    expect(onWarn).toHaveBeenCalled()
  })

  it('returns undefined and warns when storage throws', () => {
    const onWarn = vi.fn()
    expect(safeGetJson(throwingStorage(), 'k', onWarn)).toBeUndefined()
    expect(onWarn).toHaveBeenCalled()
  })

  it('returns undefined when there is no storage at all', () => {
    expect(safeGetJson(undefined, 'k')).toBeUndefined()
  })
})

describe('safeSetJson', () => {
  it('reports success', () => {
    expect(safeSetJson(fakeStorage(), 'k', 1)).toBe(true)
  })

  it('reports failure and warns when storage throws', () => {
    const onWarn = vi.fn()
    expect(safeSetJson(throwingStorage(), 'k', 1, onWarn)).toBe(false)
    expect(onWarn).toHaveBeenCalled()
  })

  it('reports failure when there is no storage', () => {
    expect(safeSetJson(undefined, 'k', 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/storage/json.test.ts`
Expected: FAIL, cannot resolve `./json`.

- [ ] **Step 3: Write `src/storage/json.ts`**

```ts
export type WarnFn = (message: string) => void

export function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Some browsers throw on merely touching localStorage when site data is blocked.
    return undefined
  }
}

export function safeGetJson(storage: Storage | undefined, key: string, onWarn?: WarnFn): unknown {
  if (storage === undefined) return undefined

  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch (error) {
    onWarn?.(`Could not read "${key}": ${(error as Error).message}`)
    return undefined
  }
  if (raw === null) return undefined

  try {
    return JSON.parse(raw)
  } catch {
    onWarn?.(`Stored value for "${key}" is not valid JSON; ignoring it`)
    return undefined
  }
}

export function safeSetJson(
  storage: Storage | undefined,
  key: string,
  value: unknown,
  onWarn?: WarnFn
): boolean {
  if (storage === undefined) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    onWarn?.(`Could not save "${key}": ${(error as Error).message}`)
    return false
  }
}
```

- [ ] **Step 4: Point the progress store at the shared helper**

In `src/progress/local-storage.ts`, delete the local `defaultStorage` and replace the inline read and write logic with `safeGetJson` and `safeSetJson`, keeping the existing degrade-to-memory behavior:

```ts
import { defaultStorage, safeGetJson, safeSetJson } from '../storage/json'
```

`get` becomes: call `safeGetJson`; if the result is `undefined`, return `{}`; if it is not a non-array object, return `{}`; otherwise keep only entries whose value is exactly `true`. `setStepDone` becomes: compute the next map, then `if (!safeSetJson(...)) { this.degrade(...); await this.fallback.setStepDone(...) }`.

All six existing `LocalStorageProgressStore` tests must still pass unchanged. If one fails, stop and report: the refactor is wrong.

- [ ] **Step 5: Write the failing test `src/react/context-form.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextForm } from './context-form'
import type { Area } from '../types'

const area: Area = {
  id: 'plants',
  title: 'Plant care',
  context: {
    zone: { type: 'usda-zone', optional: true },
    indoor: { type: 'boolean', default: true },
    humidity: { type: 'number', unit: 'percent', optional: true },
    light: { type: 'enum', values: ['bright', 'medium', 'low'], optional: true },
  },
}

describe('ContextForm', () => {
  it('renders one control per declared field', () => {
    render(<ContextForm area={area} value={{ indoor: true }} onChange={() => {}} />)
    expect(screen.getByLabelText('zone')).toBeDefined()
    expect(screen.getByLabelText('indoor')).toBeDefined()
    expect(screen.getByLabelText('humidity')).toBeDefined()
    expect(screen.getByLabelText('light')).toBeDefined()
  })

  it('offers the declared enum values', () => {
    render(<ContextForm area={area} value={{}} onChange={() => {}} />)
    const select = screen.getByLabelText('light') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['', 'bright', 'medium', 'low'])
  })

  it('offers every USDA zone for a zone field', () => {
    render(<ContextForm area={area} value={{}} onChange={() => {}} />)
    const select = screen.getByLabelText('zone') as HTMLSelectElement
    expect(select.options.length).toBe(27)
    expect([...select.options].map((option) => option.value)).toContain('9b')
  })

  it('shows the unit when one is declared', () => {
    render(<ContextForm area={area} value={{}} onChange={() => {}} />)
    expect(screen.getByText('percent')).toBeDefined()
  })

  it('emits a boolean when a checkbox changes', async () => {
    const onChange = vi.fn()
    render(<ContextForm area={area} value={{ indoor: true }} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('indoor'))
    expect(onChange).toHaveBeenCalledWith({ indoor: false })
  })

  it('emits a number, not a string, from a number field', async () => {
    const onChange = vi.fn()
    render(<ContextForm area={area} value={{}} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('humidity'), '70')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ humidity: 70 }))
  })

  it('removes a field when it is cleared rather than storing an empty string', async () => {
    const onChange = vi.fn()
    render(<ContextForm area={area} value={{ zone: '9b' }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('zone'), '')
    expect(onChange).toHaveBeenCalledWith({})
  })
})
```

The number-field test is the one that matters most. Plan 1's condition evaluator coerces by declared type, but emitting `'70'` where the area declares a number would lean on that coercion for something the form itself should get right.

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run src/react/context-form.test.tsx`
Expected: FAIL, cannot resolve `./context-form`.

- [ ] **Step 7: Write `src/react/context-form.tsx`**

```tsx
import type { Area, Context, ContextFieldSchema, ContextValue } from '../types'

const USDA_ZONES = Array.from({ length: 13 }, (_, index) => index + 1).flatMap((number) => [
  `${number}a`,
  `${number}b`,
])

export interface ContextFormProps {
  area: Area
  value: Context
  onChange: (next: Context) => void
}

export function ContextForm({ area, value, onChange }: ContextFormProps) {
  function update(key: string, next: ContextValue | undefined): void {
    const merged: Context = { ...value }
    if (next === undefined) {
      delete merged[key]
    } else {
      merged[key] = next
    }
    onChange(merged)
  }

  return (
    <div className="pk-context-form">
      {Object.entries(area.context).map(([key, schema]) => (
        <div className="pk-context-field" key={key} data-field={key} data-field-type={schema.type}>
          <Field fieldKey={key} schema={schema} value={value[key]} onUpdate={update} />
          {schema.unit !== undefined && <span className="pk-context-unit">{schema.unit}</span>}
        </div>
      ))}
    </div>
  )
}

interface FieldProps {
  fieldKey: string
  schema: ContextFieldSchema
  value: ContextValue | undefined
  onUpdate: (key: string, next: ContextValue | undefined) => void
}

function Field({ fieldKey, schema, value, onUpdate }: FieldProps) {
  const id = `pk-context-${fieldKey}`
  const label = (
    <label className="pk-context-label" htmlFor={id}>
      {fieldKey}
    </label>
  )

  if (schema.type === 'boolean') {
    return (
      <>
        <input
          className="pk-context-input"
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onUpdate(fieldKey, event.target.checked)}
        />
        {label}
      </>
    )
  }

  if (schema.type === 'number') {
    return (
      <>
        {label}
        <input
          className="pk-context-input"
          id={id}
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value
            onUpdate(fieldKey, raw === '' ? undefined : Number(raw))
          }}
        />
      </>
    )
  }

  const options = schema.type === 'usda-zone' ? USDA_ZONES : (schema.values ?? [])
  return (
    <>
      {label}
      <select
        className="pk-context-input"
        id={id}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => onUpdate(fieldKey, event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  )
}
```

- [ ] **Step 8: Add `usePersistedContext` to `src/react/hooks.ts`**

```ts
import type { Area, Context } from '../types'
import { defaultContext, withDefaults } from '../resolve/index'
import { defaultStorage, safeGetJson, safeSetJson, type WarnFn } from '../storage/json'

export interface UsePersistedContextOptions {
  storage?: Storage
  keyPrefix?: string
  onWarn?: WarnFn
}

export interface UsePersistedContextResult {
  context: Context
  setContext: (next: Context) => void
  hydrated: boolean
}

export function usePersistedContext(
  area: Area,
  options: UsePersistedContextOptions = {}
): UsePersistedContextResult {
  // Destructure rather than depending on the options object. The default
  // parameter builds a fresh {} on every invocation, so an effect that depends
  // on `options` re-fires on every render, reloads, sets state, re-renders, and
  // never settles. Depend on the stable values inside it.
  const { onWarn } = options
  const prefix = options.keyPrefix ?? 'pathkit:context:'
  const key = `${prefix}${area.id}`
  const storage = 'storage' in options ? options.storage : defaultStorage()

  // The first render must match the statically generated HTML, which used the
  // default context. The stored value is applied after hydration, in an effect.
  const [context, setContextState] = useState<Context>(() => defaultContext(area))
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = safeGetJson(storage, key, onWarn)
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
      setContextState(withDefaults(area, stored as Context))
    }
    setHydrated(true)
    // area.id and key identify the area; the storage object is stable per mount.
  }, [area, key, storage, onWarn])

  const setContext = useCallback(
    (next: Context) => {
      setContextState(next)
      safeSetJson(storage, key, next, onWarn)
    },
    [storage, key, onWarn]
  )

  return { context, setContext, hydrated }
}
```

- [ ] **Step 9: Run the tests and the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS including the six unmodified progress-store tests, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/storage src/progress/local-storage.ts src/react/hooks.ts src/react/context-form.tsx src/react/context-form.test.tsx src/storage/json.test.ts
git commit -m "add persisted reader context and the context form"
```

---

### Task 6: PathView, MythCard, the react entry surface, and docs

**Files:**
- Create: `src/react/path-view.tsx`, `src/react/index.ts`
- Modify: `README.md`
- Test: `src/react/path-view.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2 to 5, plus `resolve` from `src/resolve/index.ts`.
- Produces: the `pathkit/react` entry exporting `PathView`, `MythCard`, `StepList`, `StepItem`, `ContextForm`, `EvidenceBadge`, `SourceList`, `useProgress`, `usePersistedContext`, `renderPlainParagraphs`, and the types `RenderMarkdown`, `PathViewProps`, `MythCardProps`, `StepListProps`, `StepItemProps`, `ContextFormProps`, `EvidenceBadgeProps`, `SourceListProps`, `UseProgressResult`, `UsePersistedContextResult`, `UsePersistedContextOptions`.

`PathView` takes the unresolved `path`, `subject` and `area` rather than a `ResolvedPath`, and calls `resolve` itself on every render. That is what makes the spec's rendering model work: the server renders with the default context and produces indexable HTML, and once a reader personalizes, the same component re-resolves on the client with no round trip.

- [ ] **Step 1: Write the failing test `src/react/path-view.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MythCard, PathView } from './path-view'
import { InMemoryProgressStore } from '../progress/memory'
import type { Area, Myth, Path, Subject } from '../types'

const area: Area = {
  id: 'plants',
  title: 'Plant care',
  context: {
    indoor: { type: 'boolean', default: true },
    humidity: { type: 'number', optional: true },
  },
}

const subject: Subject = { id: 'echeveria', name: 'Echeveria', fields: { callus_days: 3 } }

const path: Path = {
  id: 'leaf-propagation',
  title: 'Propagating from a leaf',
  summary: 'Grow a new plant from one leaf.',
  steps: [
    {
      id: 'callus',
      title: 'Let it callus',
      body: 'Dry it for {{ callus_days }} days.',
      evidence: 'consensus',
      sources: [{ title: 'A guide', url: 'https://example.org/a' }],
      variants: [{ when: { indoor: false }, action: 'replace', body: 'Dry it in the shade outdoors.' }],
    },
    { id: 'plant', title: 'Plant it', body: 'Set it on dry mix.' },
  ],
}

function view(store = new InMemoryProgressStore()) {
  return render(<PathView path={path} subject={subject} area={area} progressStore={store} />)
}

describe('PathView', () => {
  it('renders the title and summary', () => {
    view()
    expect(screen.getByRole('heading', { level: 2, name: 'Propagating from a leaf' })).toBeDefined()
    expect(screen.getByText('Grow a new plant from one leaf.')).toBeDefined()
  })

  it('interpolates subject fields into the base version', () => {
    view()
    expect(screen.getByText('Dry it for 3 days.')).toBeDefined()
  })

  it('lists the deduplicated path sources once', () => {
    view()
    expect(screen.getAllByRole('link', { name: 'A guide' })).toHaveLength(1)
  })

  it('hides the context form until the reader asks for it', () => {
    const { container } = view()
    expect(container.querySelector('.pk-context-form')).toBeNull()
    expect(screen.getByRole('button', { name: /personalize/i })).toBeDefined()
  })

  it('reveals the context form on request', async () => {
    const { container } = view()
    await userEvent.click(screen.getByRole('button', { name: /personalize/i }))
    expect(container.querySelector('.pk-context-form')).not.toBeNull()
  })

  it('re-resolves the guide when the reader changes their context', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: /personalize/i }))
    await userEvent.click(screen.getByLabelText('indoor'))
    await waitFor(() => expect(screen.getByText('Dry it in the shade outdoors.')).toBeDefined())
  })

  it('persists a ticked step to the progress store', async () => {
    const store = new InMemoryProgressStore()
    view(store)
    await userEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement)
    await waitFor(async () => expect(await store.get('leaf-propagation')).toEqual({ callus: true }))
  })

  it('renders without a subject rather than failing', () => {
    render(<PathView path={path} subject={null} area={area} progressStore={new InMemoryProgressStore()} />)
    expect(screen.getByText('Dry it for days.')).toBeDefined()
  })
})

describe('MythCard', () => {
  const myth: Myth = {
    id: 'misting',
    title: 'Misting keeps succulents healthy',
    verdict: 'misleading',
    evidence: 'consensus',
    sources: [{ title: 'A reference', url: 'https://example.org/b' }],
    body: 'Misting does not water roots.',
  }

  it('shows the claim, the verdict and the evidence', () => {
    const { container } = render(<MythCard myth={myth} />)
    expect(screen.getByText('Misting keeps succulents healthy')).toBeDefined()
    expect(container.querySelector('[data-verdict="misleading"]')).not.toBeNull()
    expect(screen.getByText('Growers broadly agree')).toBeDefined()
  })

  it('shows the sources that back the refutation', () => {
    render(<MythCard myth={myth} />)
    expect(screen.getByRole('link', { name: 'A reference' })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/react/path-view.test.tsx`
Expected: FAIL, cannot resolve `./path-view`.

- [ ] **Step 3: Write `src/react/path-view.tsx`**

```tsx
import { useState } from 'react'
import { resolve } from '../resolve/index'
import type { Area, Myth, Path, ProgressStore, Subject } from '../types'
import { ContextForm } from './context-form'
import { EvidenceBadge, SourceList } from './evidence'
import { useProgress, usePersistedContext } from './hooks'
import { renderPlainParagraphs, type RenderMarkdown } from './markdown'
import { StepList } from './steps'

const VERDICT_LABEL: Record<Myth['verdict'], string> = {
  false: 'This is false',
  misleading: 'This is misleading',
  oversimplified: 'This is oversimplified',
}

export interface PathViewProps {
  path: Path
  subject: Subject | null
  area: Area
  progressStore: ProgressStore
  renderMarkdown?: RenderMarkdown
  personalizeLabel?: string
  onWarn?: (message: string) => void
}

export function PathView({
  path,
  subject,
  area,
  progressStore,
  renderMarkdown = renderPlainParagraphs,
  personalizeLabel = 'Personalize this guide',
  onWarn,
}: PathViewProps) {
  const { context, setContext } = usePersistedContext(area, { onWarn })
  const { done, setStepDone } = useProgress(progressStore, path.id)
  const [showForm, setShowForm] = useState(false)

  const resolved = resolve(path, subject, context, { area, onWarn })

  return (
    <article className="pk-path" data-path-id={path.id}>
      <header className="pk-path-header">
        <h2 className="pk-path-title">{resolved.title}</h2>
        {resolved.summary !== undefined && <p className="pk-path-summary">{resolved.summary}</p>}
      </header>

      <div className="pk-personalize">
        <button className="pk-personalize-toggle" type="button" onClick={() => setShowForm((open) => !open)}>
          {personalizeLabel}
        </button>
        {showForm && <ContextForm area={area} value={context} onChange={setContext} />}
      </div>

      <StepList steps={resolved.steps} done={done} onToggle={setStepDone} renderMarkdown={renderMarkdown} />

      <SourceList sources={resolved.sources} />
    </article>
  )
}

export interface MythCardProps {
  myth: Myth
  renderMarkdown?: RenderMarkdown
}

export function MythCard({ myth, renderMarkdown = renderPlainParagraphs }: MythCardProps) {
  return (
    <section className="pk-myth" data-myth-id={myth.id} data-verdict={myth.verdict}>
      <h3 className="pk-myth-claim">{myth.title}</h3>
      <p className="pk-myth-verdict">{VERDICT_LABEL[myth.verdict]}</p>
      <EvidenceBadge evidence={myth.evidence} />
      <div className="pk-myth-body">{renderMarkdown(myth.body)}</div>
      <SourceList sources={myth.sources ?? []} />
    </section>
  )
}
```

- [ ] **Step 4: Write `src/react/index.ts`**

```ts
Task 3 created this file with the evidence exports only. Replace its contents with
the full surface:

```ts
export { EvidenceBadge, SourceList } from './evidence'
export type { EvidenceBadgeProps, SourceListProps } from './evidence'

export { StepItem, StepList } from './steps'
export type { StepItemProps, StepListProps } from './steps'

export { ContextForm } from './context-form'
export type { ContextFormProps } from './context-form'

export { MythCard, PathView } from './path-view'
export type { MythCardProps, PathViewProps } from './path-view'

export { useProgress, usePersistedContext } from './hooks'
export type { UseProgressResult, UsePersistedContextOptions, UsePersistedContextResult } from './hooks'

export { renderPlainParagraphs } from './markdown'
export type { RenderMarkdown } from './markdown'

export { InMemoryProgressStore, LocalStorageProgressStore } from '../progress/index'
export type { LocalStorageProgressStoreOptions } from '../progress/index'
```

The progress stores are re-exported here because a React consumer is the only kind that needs them, and they are browser-safe.

- [ ] **Step 5: Add a React section to `README.md`**

Insert after the existing "Resolving a path" section:

````markdown
## Rendering in React

```tsx
import { LocalStorageProgressStore, PathView } from 'pathkit/react'

const store = new LocalStorageProgressStore()

export function Guide({ path, subject, area }) {
  return <PathView path={path} subject={subject} area={area} progressStore={store} />
}
```

`PathView` renders the base version of the guide on the server, so the page is
statically generated and indexable. When a reader opens "Personalize this guide"
and sets their zone or growing conditions, the same component re-resolves on the
client. Their answers and their ticked-off steps persist in that browser only.

The package ships no CSS. Components emit `pk-` prefixed class names and
`data-` attributes (`data-evidence`, `data-verdict`, `data-done`) for you to
style.

Step bodies are Markdown. By default they render as plain paragraphs with no
markup interpreted, because the package never injects HTML. To render real
Markdown, pass your own renderer and with it your own sanitizer:

```tsx
<PathView ... renderMarkdown={(md) => <YourMarkdown>{md}</YourMarkdown>} />
```
````

- [ ] **Step 6: Build, run everything, and check the bundle boundary**

Run: `npm run build && npx vitest run && npx tsc --noEmit`
Expected: build clean, all tests pass, no type errors.

Then confirm React was not bundled and the browser entry is still clean:

```bash
grep -c "jsx-runtime" dist/react/index.js   # expect a match, meaning React stayed external
grep -c "node:" dist/index.js               # expect 0
grep -c "node:" dist/react/index.js         # expect 0
```

If `dist/react/index.js` contains a `node:` import, the react entry has pulled in the filesystem layer and the `external` config or an import path is wrong. Stop and report rather than shipping it.

- [ ] **Step 7: Commit**

```bash
git add src/react package.json README.md
git commit -m "add path view, myth card and the react entry surface"
```

---

## What Plan 3 picks up

Plan 3 integrates this into plant-app and authors the first real content:

- Routes for a guide index, a guide page, and a myths index
- Static generation via `defaultContext(area)`, with client re-resolution
- The first real plant guides, with real citations, written against the evidence rules
- Tailwind styling for the `pk-` class names, matching the existing shadcn design
- `pathkit validate ./content` wired into plant-app's CI so a broken or unsupported guide fails the build
