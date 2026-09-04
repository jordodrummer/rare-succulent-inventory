# pathkit Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-free core of `pathkit`: the content model, the condition and variant resolver, the file-backed content source, and the CI validator that enforces the evidence rules.

**Architecture:** A standalone TypeScript library in a new repo, consumed later as a git dependency. The center is `resolve(path, subject, context)`, a pure function with no I/O that applies conditional variants and interpolates subject fields. Loading is hidden behind a `ContentSource` interface so a database-backed implementation can replace the file one later. Rendering is deliberately out of scope: `resolve()` returns Markdown strings and the consuming site renders them (Plan 2).

**Tech Stack:** TypeScript 5 (strict), Vitest, tsup, zod, gray-matter, yaml, Node 20+.

**Spec:** `docs/superpowers/specs/2026-09-03-guided-learning-engine-design.md` (in the plant-app repo)

**Repo location:** `~/Documents/visualstudiocode/pathkit` (matches where greenzofreaks lives). Change this if you keep projects elsewhere; every path below is relative to that repo root.

## Global Constraints

- **No em dashes** anywhere: code, comments, docs, commit messages. En dashes are fine.
- **TypeScript strict mode on.** No `any` in exported signatures.
- **No React, no Next.js, no DOM APIs** in this plan. Core must run in plain Node.
- **Node 20+**, npm, ESM source.
- **Content errors fail the build; runtime errors degrade quietly.** Parsing and validation throw or report. `resolve()` and `interpolate()` never throw on bad input; they warn through an injected `onWarn` callback and return usable output.
- **Evidence levels:** `established`, `consensus`, `contested`, `anecdotal`.
- **Myth verdicts:** `false`, `misleading`, `oversimplified`.
- **Condition operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`. Keys AND together; `any: [...]` is OR.
- **USDA zone encoding:** `Na` is `N.0`, `Nb` is `N.5`. A bare integer threshold covers the whole band, so `gte`/`lt` use `N.0` and `lte`/`gt` use `N.5`.
- **Deviation from spec, accepted:** the spec says validation errors report "file path and line". Line numbers are not available from frontmatter parsing without an AST walk. This plan reports **file path plus field path** (for example `variants.1.when`), which locates the problem just as precisely for a fraction of the work.

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Every exported type. No logic. |
| `src/resolve/conditions.ts` | Condition evaluation, comparators, zone encoding. |
| `src/resolve/interpolate.ts` | `{{ field }}` substitution and whitespace repair. |
| `src/resolve/index.ts` | `resolve()`, `withDefaults()`, `defaultContext()`. |
| `src/content/schema.ts` | zod schemas for every content file shape, plus error formatting. |
| `src/content/parse.ts` | Turning raw file text into typed content objects. |
| `src/content/file-source.ts` | `FileContentSource`, the filesystem implementation of `ContentSource`. |
| `src/content/validate.ts` | Cross-file rules: evidence, unknown context keys, orphan steps, interpolation coverage. |
| `src/cli/validate.ts` | The `pathkit validate` command. |
| `src/index.ts` | Public exports. |
| `test/fixtures/` | A small valid content tree plus deliberately broken files. |

Tests live beside their source as `*.test.ts`, except fixture-driven content tests which live in `test/`.

---

### Task 1: Scaffold, core types, condition evaluator

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, `.gitignore`
- Create: `src/types.ts`
- Create: `src/resolve/conditions.ts`
- Test: `src/resolve/conditions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all types in `src/types.ts`. `zoneToNumber(zone: string | number): number | undefined`. `evaluate(condition: Condition, context: Context, options?: EvaluateOptions): boolean` where `EvaluateOptions = { area?: Area; onWarn?: (message: string) => void }`.

- [ ] **Step 1: Create the repo and install dependencies**

```bash
mkdir -p ~/Documents/visualstudiocode/pathkit
cd ~/Documents/visualstudiocode/pathkit
git init
npm init -y
npm install zod gray-matter yaml
npm install -D typescript vitest tsup @types/node
mkdir -p src/resolve src/content src/cli test/fixtures
```

- [ ] **Step 2: Write the config files**

`package.json` (replace the generated one):

```json
{
  "name": "pathkit",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "pathkit": "./dist/cli/validate.cjs" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepare": "tsup"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "yaml": "^2.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsup": "^8.2.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/validate.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
})
```

The CLI entry starts with a shebang and tsup preserves it, so no banner
configuration is needed.

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
})
```

`.gitignore`:

```
node_modules
dist
*.tsbuildinfo
```

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type EvidenceLevel = 'established' | 'consensus' | 'contested' | 'anecdotal'

export interface Source {
  title: string
  url?: string
  reference?: string
  finding?: string
}

export type ContextValue = string | number | boolean
export type Context = Record<string, ContextValue>

export interface Comparator {
  eq?: ContextValue
  neq?: ContextValue
  gt?: number | string
  gte?: number | string
  lt?: number | string
  lte?: number | string
  in?: ContextValue[]
  exists?: boolean
}

export interface Condition {
  any?: Condition[]
  [key: string]: ContextValue | Comparator | Condition[] | undefined
}

export type VariantAction = 'append' | 'replace' | 'hide'

export interface Variant {
  when: Condition
  action: VariantAction
  body?: string
}

export interface Step {
  id: string
  title: string
  body: string
  cadence?: string | null
  evidence?: EvidenceLevel
  why?: string
  sources?: Source[]
  variants?: Variant[]
}

export interface Path {
  id: string
  title: string
  summary?: string
  subjectType?: string
  steps: Step[]
}

export interface PathSummary {
  id: string
  title: string
  summary?: string
}

export interface Subject {
  id: string
  name: string
  commonNames?: string[]
  fields: Record<string, ContextValue>
}

export type MythVerdict = 'false' | 'misleading' | 'oversimplified'

export interface Myth {
  id: string
  title: string
  verdict: MythVerdict
  evidence?: EvidenceLevel
  sources?: Source[]
  paths?: string[]
  body: string
}

export interface ResolvedStep {
  id: string
  title: string
  body: string
  cadence: string | null
  evidence?: EvidenceLevel
  why?: string
  sources: Source[]
}

export interface ResolvedPath {
  id: string
  title: string
  summary?: string
  steps: ResolvedStep[]
  sources: Source[]
}

export type ContextFieldType = 'boolean' | 'number' | 'enum' | 'usda-zone'

export interface ContextFieldSchema {
  type: ContextFieldType
  values?: string[]
  unit?: string
  optional?: boolean
  default?: ContextValue
}

export interface Area {
  id: string
  title: string
  subjectType?: string
  context: Record<string, ContextFieldSchema>
}

export interface ContentSource {
  getArea(area: string): Promise<Area>
  listPaths(area: string): Promise<PathSummary[]>
  getPath(area: string, id: string): Promise<Path>
  getSubject(area: string, id: string): Promise<Subject>
  listSubjects(area: string): Promise<Subject[]>
  listMyths(area: string): Promise<Myth[]>
}
```

- [ ] **Step 4: Write the failing test `src/resolve/conditions.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { evaluate, zoneToNumber } from './conditions'
import type { Area } from '../types'

const area: Area = {
  id: 'plants',
  title: 'Plants',
  context: {
    zone: { type: 'usda-zone', optional: true },
    indoor: { type: 'boolean', default: true },
    humidity: { type: 'number', unit: 'percent', optional: true },
  },
}

describe('zoneToNumber', () => {
  it('encodes the a band as a whole number', () => {
    expect(zoneToNumber('9a')).toBe(9)
  })

  it('encodes the b band as a half step', () => {
    expect(zoneToNumber('9b')).toBe(9.5)
  })

  it('accepts a bare zone number', () => {
    expect(zoneToNumber('10')).toBe(10)
  })

  it('returns undefined for nonsense', () => {
    expect(zoneToNumber('tropical')).toBeUndefined()
  })
})

describe('evaluate', () => {
  it('matches a bare value as equality', () => {
    expect(evaluate({ indoor: true }, { indoor: true }, { area })).toBe(true)
    expect(evaluate({ indoor: true }, { indoor: false }, { area })).toBe(false)
  })

  it('ANDs multiple keys', () => {
    const condition = { indoor: false, humidity: { lte: 40 } }
    expect(evaluate(condition, { indoor: false, humidity: 30 }, { area })).toBe(true)
    expect(evaluate(condition, { indoor: false, humidity: 80 }, { area })).toBe(false)
  })

  it('ORs the branches of any', () => {
    const condition = { any: [{ humidity: { gte: 70 } }, { indoor: false }] }
    expect(evaluate(condition, { indoor: false, humidity: 20 }, { area })).toBe(true)
    expect(evaluate(condition, { indoor: true, humidity: 20 }, { area })).toBe(false)
  })

  it('treats a bare integer gte as covering the whole band', () => {
    expect(evaluate({ zone: { gte: 9 } }, { zone: '9a' }, { area })).toBe(true)
    expect(evaluate({ zone: { gte: 9 } }, { zone: '9b' }, { area })).toBe(true)
    expect(evaluate({ zone: { gte: 9 } }, { zone: '8b' }, { area })).toBe(false)
  })

  it('treats a bare integer lte as covering the whole band', () => {
    expect(evaluate({ zone: { lte: 8 } }, { zone: '8a' }, { area })).toBe(true)
    expect(evaluate({ zone: { lte: 8 } }, { zone: '8b' }, { area })).toBe(true)
    expect(evaluate({ zone: { lte: 8 } }, { zone: '9a' }, { area })).toBe(false)
  })

  it('honours an explicit band in a threshold', () => {
    expect(evaluate({ zone: { lte: '8a' } }, { zone: '8b' }, { area })).toBe(false)
    expect(evaluate({ zone: { lte: '8a' } }, { zone: '8a' }, { area })).toBe(true)
  })

  it('excludes the whole band for a bare integer gt', () => {
    expect(evaluate({ zone: { gt: 9 } }, { zone: '9b' }, { area })).toBe(false)
    expect(evaluate({ zone: { gt: 9 } }, { zone: '10a' }, { area })).toBe(true)
  })

  it('is false when the context lacks the key', () => {
    expect(evaluate({ zone: { gte: 9 } }, {}, { area })).toBe(false)
  })

  it('supports exists', () => {
    expect(evaluate({ zone: { exists: true } }, { zone: '9b' }, { area })).toBe(true)
    expect(evaluate({ zone: { exists: false } }, {}, { area })).toBe(true)
  })

  it('supports in', () => {
    expect(evaluate({ zone: { in: ['9a', '9b'] } }, { zone: '9b' }, { area })).toBe(true)
    expect(evaluate({ zone: { in: ['9a'] } }, { zone: '9b' }, { area })).toBe(false)
  })

  it('warns and returns false for a context key the area does not declare', () => {
    const onWarn = vi.fn()
    expect(evaluate({ soilPh: 6 }, { soilPh: 6 }, { area, onWarn })).toBe(false)
    expect(onWarn).toHaveBeenCalledOnce()
  })

  it('skips the unknown-key check when no area is supplied', () => {
    expect(evaluate({ soilPh: 6 }, { soilPh: 6 })).toBe(true)
  })
})
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npx vitest run src/resolve/conditions.test.ts`
Expected: FAIL, cannot resolve `./conditions`.

- [ ] **Step 6: Write `src/resolve/conditions.ts`**

```ts
import type { Area, Comparator, Condition, Context, ContextValue } from '../types'

const ZONE_PATTERN = /^(\d{1,2})([ab])?$/i
const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte'])

export interface EvaluateOptions {
  area?: Area
  onWarn?: (message: string) => void
}

export function zoneToNumber(zone: string | number): number | undefined {
  if (typeof zone === 'number') return zone
  const match = ZONE_PATTERN.exec(String(zone).trim())
  if (!match) return undefined
  return Number(match[1]) + (match[2]?.toLowerCase() === 'b' ? 0.5 : 0)
}

// A band is the closed interval [N.0, N.5]. A bare integer threshold should
// cover the whole band, so gte and lt anchor at N.0 while lte and gt anchor
// at N.5. An explicit band like '8a' is used exactly as written.
function zoneThreshold(op: string, operand: ContextValue): number | undefined {
  const isBareInteger = typeof operand === 'number' && Number.isInteger(operand)
  const base = zoneToNumber(operand as string | number)
  if (base === undefined) return undefined
  if (isBareInteger && (op === 'lte' || op === 'gt')) return base + 0.5
  return base
}

function normalize(value: ContextValue | undefined, fieldType?: string): ContextValue | undefined {
  if (value === undefined) return undefined
  if (fieldType === 'usda-zone') return zoneToNumber(value as string | number)
  return value
}

function isComparator(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function evaluate(condition: Condition, context: Context, options: EvaluateOptions = {}): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    if (expected === undefined) continue

    if (key === 'any') {
      const branches = expected as Condition[]
      if (!branches.some((branch) => evaluate(branch, context, options))) return false
      continue
    }

    const fieldType = options.area?.context[key]?.type
    if (options.area && fieldType === undefined) {
      options.onWarn?.(`Unknown context key "${key}"; condition treated as false`)
      return false
    }

    const actual = normalize(context[key], fieldType)

    if (isComparator(expected)) {
      if (!compare(actual, expected as Comparator, fieldType)) return false
    } else {
      if (actual === undefined) return false
      if (actual !== normalize(expected as ContextValue, fieldType)) return false
    }
  }
  return true
}

function compare(actual: ContextValue | undefined, comparator: Comparator, fieldType?: string): boolean {
  const entries = Object.entries(comparator).filter(([, operand]) => operand !== undefined)
  if (entries.length === 0) return true
  return entries.every(([op, operand]) => compareOne(actual, op, operand as ContextValue, fieldType))
}

function compareOne(
  actual: ContextValue | undefined,
  op: string,
  operand: ContextValue,
  fieldType?: string
): boolean {
  if (op === 'exists') return (actual !== undefined) === Boolean(operand)
  if (actual === undefined) return false

  if (NUMERIC_OPS.has(op)) {
    const threshold = fieldType === 'usda-zone' ? zoneThreshold(op, operand) : Number(operand)
    if (threshold === undefined || Number.isNaN(threshold)) return false
    const value = Number(actual)
    if (Number.isNaN(value)) return false
    if (op === 'gt') return value > threshold
    if (op === 'gte') return value >= threshold
    if (op === 'lt') return value < threshold
    return value <= threshold
  }

  if (op === 'eq') return actual === normalize(operand, fieldType)
  if (op === 'neq') return actual !== normalize(operand, fieldType)
  if (op === 'in') {
    const list = operand as unknown as ContextValue[]
    return list.map((entry) => normalize(entry, fieldType)).includes(actual)
  }
  return false
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npx vitest run src/resolve/conditions.test.ts && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts tsup.config.ts .gitignore src/types.ts src/resolve/conditions.ts src/resolve/conditions.test.ts
git commit -m "add core types and condition evaluator"
```

---

### Task 2: Field interpolation

**Files:**
- Create: `src/resolve/interpolate.ts`
- Test: `src/resolve/interpolate.test.ts`

**Interfaces:**
- Consumes: `ContextValue` from `src/types.ts`.
- Produces: `interpolate(body: string, fields: Record<string, ContextValue>, options?: { onWarn?: (message: string) => void }): string`. Also exports `PLACEHOLDER_PATTERN: RegExp` and `placeholderNames(text: string): string[]`, both used by the validator in Task 6.

- [ ] **Step 1: Write the failing test `src/resolve/interpolate.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { interpolate, placeholderNames } from './interpolate'

describe('interpolate', () => {
  it('substitutes a field', () => {
    expect(interpolate('Wait {{ callus_days }} days.', { callus_days: 3 })).toBe('Wait 3 days.')
  })

  it('tolerates missing inner spaces', () => {
    expect(interpolate('Wait {{callus_days}} days.', { callus_days: 3 })).toBe('Wait 3 days.')
  })

  it('substitutes every occurrence', () => {
    expect(interpolate('{{ n }} and {{ n }}', { n: 2 })).toBe('2 and 2')
  })

  it('drops a missing field and repairs the spacing', () => {
    expect(interpolate('Wait {{ missing }} days.', {})).toBe('Wait days.')
  })

  it('removes the space before punctuation when a field is missing', () => {
    expect(interpolate('Wait {{ missing }}.', {})).toBe('Wait.')
  })

  it('warns once per missing field occurrence', () => {
    const onWarn = vi.fn()
    interpolate('{{ a }} {{ b }}', {}, { onWarn })
    expect(onWarn).toHaveBeenCalledTimes(2)
  })

  it('leaves markdown hard breaks alone when nothing is missing', () => {
    const body = 'line one  \nline two'
    expect(interpolate(body, {})).toBe(body)
  })

  it('renders false and zero rather than dropping them', () => {
    expect(interpolate('{{ a }}/{{ b }}', { a: 0, b: false })).toBe('0/false')
  })
})

describe('placeholderNames', () => {
  it('lists every referenced field once', () => {
    expect(placeholderNames('{{ a }} {{ b }} {{ a }}')).toEqual(['a', 'b'])
  })

  it('returns an empty list when there are none', () => {
    expect(placeholderNames('plain text')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/resolve/interpolate.test.ts`
Expected: FAIL, cannot resolve `./interpolate`.

- [ ] **Step 3: Write `src/resolve/interpolate.ts`**

```ts
import type { ContextValue } from '../types'

export const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export interface InterpolateOptions {
  onWarn?: (message: string) => void
}

export function placeholderNames(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) names.add(match[1])
  }
  return [...names]
}

export function interpolate(
  body: string,
  fields: Record<string, ContextValue>,
  options: InterpolateOptions = {}
): string {
  let droppedAny = false

  const substituted = body.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      return String(fields[name])
    }
    droppedAny = true
    options.onWarn?.(`Missing subject field "${name}"; rendered as empty`)
    return ''
  })

  // Only repair whitespace when a placeholder was dropped. Doing it
  // unconditionally would eat markdown hard breaks in authored text.
  return droppedAny ? repairSpacing(substituted) : substituted
}

function repairSpacing(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1')
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/resolve/interpolate.test.ts && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/resolve/interpolate.ts src/resolve/interpolate.test.ts
git commit -m "add subject field interpolation"
```

---

### Task 3: The resolver

**Files:**
- Create: `src/resolve/index.ts`
- Test: `src/resolve/index.test.ts`

**Interfaces:**
- Consumes: `evaluate` from `src/resolve/conditions.ts`, `interpolate` from `src/resolve/interpolate.ts`, types from `src/types.ts`.
- Produces:
  - `resolve(path: Path, subject: Subject | null, context: Context, options?: ResolveOptions): ResolvedPath`
  - `withDefaults(area: Area, context: Context): Context`
  - `defaultContext(area: Area): Context`
  - `ResolveOptions = { area?: Area; onWarn?: (message: string) => void }`

`defaultContext()` is what the consuming site passes when statically generating the base, indexable version of a page (spec section 10). Plan 2 depends on it.

- [ ] **Step 1: Write the failing test `src/resolve/index.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { defaultContext, resolve, withDefaults } from './index'
import type { Area, Path, Subject } from '../types'

const area: Area = {
  id: 'plants',
  title: 'Plants',
  subjectType: 'variety',
  context: {
    zone: { type: 'usda-zone', optional: true },
    indoor: { type: 'boolean', default: true },
    humidity: { type: 'number', optional: true },
  },
}

const subject: Subject = {
  id: 'echeveria-elegans',
  name: 'Echeveria elegans',
  fields: { callus_days: 3 },
}

const path: Path = {
  id: 'leaf-propagation',
  title: 'Propagating from a leaf',
  summary: 'Grow a new plant from one leaf.',
  subjectType: 'variety',
  steps: [
    {
      id: 'select-leaf',
      title: 'Select a leaf',
      body: 'Choose a plump, undamaged leaf.',
      evidence: 'consensus',
      sources: [{ title: 'Shared source', url: 'https://example.org/a' }],
    },
    {
      id: 'callus',
      title: 'Let it callus',
      body: 'Dry it for {{ callus_days }} days.',
      evidence: 'consensus',
      why: 'A dry wound resists rot.',
      sources: [{ title: 'Shared source', url: 'https://example.org/a' }],
      variants: [
        { when: { humidity: { gte: 70 } }, action: 'append', body: 'In humid air, allow longer.' },
        { when: { indoor: false, zone: { lte: 8 } }, action: 'hide' },
      ],
    },
    {
      id: 'plant',
      title: 'Plant it',
      body: 'Set it on dry mix.',
      variants: [{ when: { indoor: false }, action: 'replace', body: 'Set it in a shaded outdoor tray.' }],
    },
  ],
}

describe('resolve', () => {
  it('returns the base version when no variant matches', () => {
    const result = resolve(path, subject, { indoor: true }, { area })
    expect(result.steps.map((s) => s.id)).toEqual(['select-leaf', 'callus', 'plant'])
    expect(result.steps[1]?.body).toBe('Dry it for 3 days.')
  })

  it('appends a matching variant body', () => {
    const result = resolve(path, subject, { indoor: true, humidity: 80 }, { area })
    expect(result.steps[1]?.body).toBe('Dry it for 3 days.\n\nIn humid air, allow longer.')
  })

  it('replaces the body for a replace variant', () => {
    const result = resolve(path, subject, { indoor: false }, { area })
    expect(result.steps.at(-1)?.body).toBe('Set it in a shaded outdoor tray.')
  })

  it('drops a hidden step', () => {
    const result = resolve(path, subject, { indoor: false, zone: '7b' }, { area })
    expect(result.steps.map((s) => s.id)).toEqual(['select-leaf', 'plant'])
  })

  it('carries evidence, why and cadence through', () => {
    const result = resolve(path, subject, { indoor: true }, { area })
    expect(result.steps[1]?.evidence).toBe('consensus')
    expect(result.steps[1]?.why).toBe('A dry wound resists rot.')
    expect(result.steps[0]?.cadence).toBeNull()
  })

  it('collects path level sources and dedupes them', () => {
    const result = resolve(path, subject, { indoor: true }, { area })
    expect(result.sources).toEqual([{ title: 'Shared source', url: 'https://example.org/a' }])
  })

  it('omits sources belonging to hidden steps', () => {
    const hidden: Path = {
      ...path,
      steps: [
        {
          id: 'only',
          title: 'Only',
          body: 'x',
          sources: [{ title: 'Gone', url: 'https://example.org/gone' }],
          variants: [{ when: { indoor: true }, action: 'hide' }],
        },
      ],
    }
    expect(resolve(hidden, subject, { indoor: true }, { area }).sources).toEqual([])
  })

  it('renders without a subject rather than throwing', () => {
    const result = resolve(path, null, { indoor: true }, { area })
    expect(result.steps[1]?.body).toBe('Dry it for days.')
  })
})

describe('withDefaults', () => {
  it('fills declared defaults without overwriting supplied values', () => {
    expect(withDefaults(area, {})).toEqual({ indoor: true })
    expect(withDefaults(area, { indoor: false })).toEqual({ indoor: false })
  })
})

describe('defaultContext', () => {
  it('is the base context used for static generation', () => {
    expect(defaultContext(area)).toEqual({ indoor: true })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/resolve/index.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Write `src/resolve/index.ts`**

```ts
import type { Area, Context, Path, ResolvedPath, ResolvedStep, Source, Step, Subject } from '../types'
import { evaluate } from './conditions'
import { interpolate } from './interpolate'

export { evaluate, zoneToNumber } from './conditions'
export { interpolate, placeholderNames, PLACEHOLDER_PATTERN } from './interpolate'

export interface ResolveOptions {
  area?: Area
  onWarn?: (message: string) => void
}

export function withDefaults(area: Area, context: Context): Context {
  const merged: Context = { ...context }
  for (const [key, schema] of Object.entries(area.context)) {
    if (merged[key] === undefined && schema.default !== undefined) {
      merged[key] = schema.default
    }
  }
  return merged
}

export function defaultContext(area: Area): Context {
  return withDefaults(area, {})
}

export function resolve(
  path: Path,
  subject: Subject | null,
  context: Context,
  options: ResolveOptions = {}
): ResolvedPath {
  const fields = subject?.fields ?? {}
  const steps: ResolvedStep[] = []

  for (const step of path.steps) {
    const body = applyVariants(step, context, options)
    if (body === null) continue
    steps.push({
      id: step.id,
      title: interpolate(step.title, fields, options),
      body: interpolate(body, fields, options),
      cadence: step.cadence ?? null,
      evidence: step.evidence,
      why: step.why === undefined ? undefined : interpolate(step.why, fields, options),
      sources: step.sources ?? [],
    })
  }

  return {
    id: path.id,
    title: path.title,
    summary: path.summary,
    steps,
    sources: dedupeSources(steps.flatMap((step) => step.sources)),
  }
}

// Returns the step body after variants, or null when the step is hidden.
function applyVariants(step: Step, context: Context, options: ResolveOptions): string | null {
  let body = step.body
  for (const variant of step.variants ?? []) {
    if (!evaluate(variant.when, context, options)) continue
    if (variant.action === 'hide') return null
    if (variant.action === 'replace') body = variant.body ?? ''
    if (variant.action === 'append') body = `${body}\n\n${variant.body ?? ''}`.trim()
  }
  return body
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>()
  const unique: Source[] = []
  for (const source of sources) {
    const key = source.url ?? source.reference ?? source.title
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(source)
  }
  return unique
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS across all three files, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/resolve/index.ts src/resolve/index.test.ts
git commit -m "add path resolver with variants and source collection"
```

---

### Task 4: Content schemas and parsing

**Files:**
- Create: `src/content/schema.ts`
- Create: `src/content/parse.ts`
- Test: `src/content/parse.test.ts`

**Interfaces:**
- Consumes: types from `src/types.ts`.
- Produces:
  - `ContentError` (class, with `file: string` and `issues: string[]`)
  - `parseArea(file: string, raw: string): Area`
  - `parsePathManifest(file: string, raw: string): { id: string; title: string; summary?: string; subjectType?: string; steps: string[] }`
  - `parseStep(file: string, raw: string): Step`
  - `parseSubject(file: string, raw: string): Subject`
  - `parseMyth(file: string, raw: string): Myth`
  - `CADENCE_PATTERN: RegExp`

Note the split: `path.yml` holds a list of step **ids**, so its parsed form is a manifest, not a `Path`. `FileContentSource` in Task 5 assembles the manifest plus the step files into a `Path`.

- [ ] **Step 1: Write the failing test `src/content/parse.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { ContentError, parseArea, parseMyth, parsePathManifest, parseStep, parseSubject } from './parse'

describe('parseArea', () => {
  it('parses a valid area', () => {
    const area = parseArea('area.yml', [
      'id: plants',
      'title: Plant care',
      'subjectType: variety',
      'context:',
      '  zone:',
      '    type: usda-zone',
      '    optional: true',
      '  indoor:',
      '    type: boolean',
      '    default: true',
    ].join('\n'))
    expect(area.id).toBe('plants')
    expect(area.context.zone?.type).toBe('usda-zone')
    expect(area.context.indoor?.default).toBe(true)
  })

  it('rejects an unknown context field type', () => {
    const raw = 'id: plants\ntitle: Plants\ncontext:\n  zone:\n    type: vibes\n'
    expect(() => parseArea('area.yml', raw)).toThrow(ContentError)
  })
})

describe('parsePathManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parsePathManifest('path.yml', [
      'id: leaf-propagation',
      'title: Propagating from a leaf',
      'subjectType: variety',
      'steps: [select-leaf, callus]',
    ].join('\n'))
    expect(manifest.steps).toEqual(['select-leaf', 'callus'])
  })

  it('rejects an empty step list', () => {
    const raw = 'id: p\ntitle: T\nsteps: []\n'
    expect(() => parsePathManifest('path.yml', raw)).toThrow(ContentError)
  })
})

describe('parseStep', () => {
  const valid = [
    '---',
    'id: callus',
    'title: Let it callus',
    'evidence: consensus',
    'cadence: 7d',
    'sources:',
    '  - title: A source',
    '    url: https://example.org/a',
    'variants:',
    '  - when: { humidity: { gte: 70 } }',
    '    action: append',
    '    body: Allow longer in humid air.',
    '---',
    'Dry it for {{ callus_days }} days.',
  ].join('\n')

  it('parses frontmatter and body', () => {
    const step = parseStep('02-callus.mdx', valid)
    expect(step.id).toBe('callus')
    expect(step.body.trim()).toBe('Dry it for {{ callus_days }} days.')
    expect(step.variants?.[0]?.action).toBe('append')
  })

  it('rejects an empty body', () => {
    const raw = '---\nid: a\ntitle: A\n---\n\n'
    expect(() => parseStep('a.mdx', raw)).toThrow(ContentError)
  })

  it('rejects an unknown frontmatter key', () => {
    const raw = '---\nid: a\ntitle: A\nauthr: me\n---\nBody.'
    expect(() => parseStep('a.mdx', raw)).toThrow(ContentError)
  })

  it('rejects a malformed cadence', () => {
    const raw = '---\nid: a\ntitle: A\ncadence: sometimes\n---\nBody.'
    expect(() => parseStep('a.mdx', raw)).toThrow(ContentError)
  })

  it('accepts an interpolated cadence', () => {
    const raw = '---\nid: a\ntitle: A\ncadence: "{{ water_interval_days }}d"\n---\nBody.'
    expect(parseStep('a.mdx', raw).cadence).toBe('{{ water_interval_days }}d')
  })

  it('accepts a season cadence', () => {
    const raw = '---\nid: a\ntitle: A\ncadence: spring\n---\nBody.'
    expect(parseStep('a.mdx', raw).cadence).toBe('spring')
  })

  it('rejects an append variant with no body', () => {
    const raw = '---\nid: a\ntitle: A\nvariants:\n  - when: { indoor: true }\n    action: append\n---\nBody.'
    expect(() => parseStep('a.mdx', raw)).toThrow(ContentError)
  })

  it('accepts a hide variant with no body', () => {
    const raw = '---\nid: a\ntitle: A\nvariants:\n  - when: { indoor: true }\n    action: hide\n---\nBody.'
    expect(parseStep('a.mdx', raw).variants?.[0]?.action).toBe('hide')
  })

  it('rejects a source with neither url nor reference', () => {
    const raw = '---\nid: a\ntitle: A\nsources:\n  - title: Nowhere\n---\nBody.'
    expect(() => parseStep('a.mdx', raw)).toThrow(ContentError)
  })

  it('names the file and the field path in the error', () => {
    const raw = '---\nid: a\ntitle: A\nevidence: vibes\n---\nBody.'
    try {
      parseStep('steps/a.mdx', raw)
      expect.unreachable('should have thrown')
    } catch (error) {
      const contentError = error as ContentError
      expect(contentError.file).toBe('steps/a.mdx')
      expect(contentError.issues.join(' ')).toContain('evidence')
    }
  })
})

describe('parseSubject', () => {
  it('maps common_names to commonNames', () => {
    const raw = 'id: e\nname: Echeveria\ncommon_names: [Mexican snowball]\nfields:\n  callus_days: 3\n'
    const subject = parseSubject('e.yml', raw)
    expect(subject.commonNames).toEqual(['Mexican snowball'])
    expect(subject.fields.callus_days).toBe(3)
  })

  it('defaults fields to an empty object', () => {
    expect(parseSubject('e.yml', 'id: e\nname: E\n').fields).toEqual({})
  })
})

describe('parseMyth', () => {
  it('parses a valid myth', () => {
    const raw = [
      '---',
      'id: misting',
      'title: Misting keeps succulents healthy',
      'verdict: misleading',
      'evidence: established',
      'sources:',
      '  - title: A source',
      '    url: https://example.org/a',
      '---',
      'Misting does not water roots.',
    ].join('\n')
    expect(parseMyth('misting.mdx', raw).verdict).toBe('misleading')
  })

  it('rejects an unknown verdict', () => {
    const raw = '---\nid: m\ntitle: T\nverdict: wrong-ish\n---\nBody.'
    expect(() => parseMyth('m.mdx', raw)).toThrow(ContentError)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/content/parse.test.ts`
Expected: FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `src/content/schema.ts`**

```ts
import { z } from 'zod'

export const CADENCE_PATTERN =
  /^(\d+(d|w|mo|y)|spring|summer|fall|winter|\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}(d|w|mo|y))$/

const contextValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const evidenceSchema = z.enum(['established', 'consensus', 'contested', 'anecdotal'])

export const sourceSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().url().optional(),
    reference: z.string().min(1).optional(),
    finding: z.string().optional(),
  })
  .strict()
  .refine((source) => source.url !== undefined || source.reference !== undefined, {
    message: 'a source needs either a url or a reference',
  })

export const comparatorSchema = z
  .object({
    eq: contextValueSchema.optional(),
    neq: contextValueSchema.optional(),
    gt: z.union([z.number(), z.string()]).optional(),
    gte: z.union([z.number(), z.string()]).optional(),
    lt: z.union([z.number(), z.string()]).optional(),
    lte: z.union([z.number(), z.string()]).optional(),
    in: z.array(contextValueSchema).optional(),
    exists: z.boolean().optional(),
  })
  .strict()

export const conditionSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(z.string(), z.union([contextValueSchema, comparatorSchema, z.array(conditionSchema)]))
)

export const variantSchema = z
  .object({
    when: conditionSchema,
    action: z.enum(['append', 'replace', 'hide']),
    body: z.string().optional(),
  })
  .strict()
  .refine((variant) => variant.action === 'hide' || (variant.body ?? '').trim().length > 0, {
    message: 'variants with action "append" or "replace" need a body',
  })

export const cadenceSchema = z
  .string()
  .regex(CADENCE_PATTERN, 'cadence must be an interval like 7d, 2w, 1mo, 1y, a season, or {{ field }}d')
  .nullable()

export const stepFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    cadence: cadenceSchema.optional(),
    evidence: evidenceSchema.optional(),
    why: z.string().optional(),
    sources: z.array(sourceSchema).optional(),
    variants: z.array(variantSchema).optional(),
  })
  .strict()

export const areaSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    subjectType: z.string().min(1).optional(),
    context: z.record(
      z.string(),
      z
        .object({
          type: z.enum(['boolean', 'number', 'enum', 'usda-zone']),
          values: z.array(z.string()).optional(),
          unit: z.string().optional(),
          optional: z.boolean().optional(),
          default: contextValueSchema.optional(),
        })
        .strict()
    ),
  })
  .strict()

export const pathManifestSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().optional(),
    subjectType: z.string().min(1).optional(),
    steps: z.array(z.string().min(1)).min(1, 'a path needs at least one step'),
  })
  .strict()

export const subjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    common_names: z.array(z.string()).optional(),
    fields: z.record(z.string(), contextValueSchema).default({}),
  })
  .strict()

export const mythFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    verdict: z.enum(['false', 'misleading', 'oversimplified']),
    evidence: evidenceSchema.optional(),
    sources: z.array(sourceSchema).optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict()

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${where}: ${issue.message}`
  })
}
```

- [ ] **Step 4: Write `src/content/parse.ts`**

```ts
import matter from 'gray-matter'
import { parse as parseYamlText } from 'yaml'
import type { z } from 'zod'
import type { Area, Myth, Step, Subject } from '../types'
import {
  areaSchema,
  formatIssues,
  mythFrontmatterSchema,
  pathManifestSchema,
  stepFrontmatterSchema,
  subjectSchema,
} from './schema'

export { CADENCE_PATTERN } from './schema'

export class ContentError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[]
  ) {
    super(`${file}\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ContentError'
  }
}

export interface PathManifest {
  id: string
  title: string
  summary?: string
  subjectType?: string
  steps: string[]
}

function check<T>(file: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ContentError(file, formatIssues(result.error))
  return result.data
}

function readYaml(file: string, raw: string): unknown {
  try {
    return parseYamlText(raw)
  } catch (error) {
    throw new ContentError(file, [`invalid YAML: ${(error as Error).message}`])
  }
}

function readFrontmatter(file: string, raw: string): { data: unknown; body: string } {
  try {
    const parsed = matter(raw)
    return { data: parsed.data, body: parsed.content }
  } catch (error) {
    throw new ContentError(file, [`invalid frontmatter: ${(error as Error).message}`])
  }
}

export function parseArea(file: string, raw: string): Area {
  return check(file, areaSchema, readYaml(file, raw)) as Area
}

export function parsePathManifest(file: string, raw: string): PathManifest {
  return check(file, pathManifestSchema, readYaml(file, raw))
}

export function parseSubject(file: string, raw: string): Subject {
  const parsed = check(file, subjectSchema, readYaml(file, raw))
  return {
    id: parsed.id,
    name: parsed.name,
    commonNames: parsed.common_names,
    fields: parsed.fields,
  }
}

export function parseStep(file: string, raw: string): Step {
  const { data, body } = readFrontmatter(file, raw)
  const frontmatter = check(file, stepFrontmatterSchema, data)
  if (body.trim().length === 0) {
    throw new ContentError(file, ['(body): a step needs a body'])
  }
  return { ...frontmatter, body: body.trim() } as Step
}

export function parseMyth(file: string, raw: string): Myth {
  const { data, body } = readFrontmatter(file, raw)
  const frontmatter = check(file, mythFrontmatterSchema, data)
  if (body.trim().length === 0) {
    throw new ContentError(file, ['(body): a myth needs a body'])
  }
  return { ...frontmatter, body: body.trim() } as Myth
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/content/parse.test.ts && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/content/schema.ts src/content/parse.ts src/content/parse.test.ts
git commit -m "add content schemas and file parsers"
```

---

### Task 5: FileContentSource

**Files:**
- Create: `test/helpers/tree.ts`
- Create: `src/content/file-source.ts`
- Test: `test/file-source.test.ts`

**Interfaces:**
- Consumes: parsers and `ContentError` from `src/content/parse.ts`, types from `src/types.ts`.
- Produces:
  - `class FileContentSource implements ContentSource` with `constructor(root: string)`
  - Methods: `getArea`, `listPaths`, `getPath`, `getSubject`, `listSubjects`, `listMyths`, plus `listAreas(): Promise<string[]>` which is filesystem-specific and not on the `ContentSource` interface.
- Produces (test helper): `writeTree(files: Record<string, string>): Promise<string>` creates a temp directory and returns its path. `validTree(): Record<string, string>` returns a known-good plants tree that other tests spread and override.

- [ ] **Step 1: Write the test helper `test/helpers/tree.ts`**

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export async function writeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pathkit-'))
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(root, relative)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, contents, 'utf8')
  }
  return root
}

export function validTree(): Record<string, string> {
  return {
    'plants/area.yml': [
      'id: plants',
      'title: Plant care',
      'subjectType: variety',
      'context:',
      '  zone:',
      '    type: usda-zone',
      '    optional: true',
      '  indoor:',
      '    type: boolean',
      '    default: true',
      '  humidity:',
      '    type: number',
      '    unit: percent',
      '    optional: true',
      '',
    ].join('\n'),

    'plants/paths/leaf-propagation/path.yml': [
      'id: leaf-propagation',
      'title: Propagating from a leaf',
      'summary: Grow a new plant from one leaf.',
      'subjectType: variety',
      'steps: [select-leaf, callus]',
      '',
    ].join('\n'),

    'plants/paths/leaf-propagation/01-select-leaf.mdx': [
      '---',
      'id: select-leaf',
      'title: Select a leaf',
      'evidence: anecdotal',
      '---',
      'Choose a plump, undamaged leaf.',
      '',
    ].join('\n'),

    'plants/paths/leaf-propagation/02-callus.mdx': [
      '---',
      'id: callus',
      'title: Let it callus',
      'evidence: consensus',
      'why: A dry wound resists rot.',
      'sources:',
      '  - title: A propagation guide',
      '    url: https://example.org/a',
      'variants:',
      '  - when: { humidity: { gte: 70 } }',
      '    action: append',
      '    body: Allow longer in humid air.',
      '---',
      'Dry it for {{ callus_days }} days.',
      '',
    ].join('\n'),

    'plants/subjects/echeveria-elegans.yml': [
      'id: echeveria-elegans',
      'name: Echeveria elegans',
      'common_names: [Mexican snowball]',
      'fields:',
      '  callus_days: 3',
      '',
    ].join('\n'),

    'plants/myths/misting.mdx': [
      '---',
      'id: misting',
      'title: Misting keeps succulents healthy',
      'verdict: misleading',
      'evidence: consensus',
      'sources:',
      '  - title: A care reference',
      '    url: https://example.org/b',
      '---',
      'Misting raises leaf humidity without watering roots.',
      '',
    ].join('\n'),
  }
}
```

- [ ] **Step 2: Write the failing test `test/file-source.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { FileContentSource } from '../src/content/file-source'
import { ContentError } from '../src/content/parse'
import { validTree, writeTree } from './helpers/tree'

async function sourceFor(overrides: Record<string, string> = {}): Promise<FileContentSource> {
  return new FileContentSource(await writeTree({ ...validTree(), ...overrides }))
}

describe('FileContentSource', () => {
  it('reads the area', async () => {
    const area = await (await sourceFor()).getArea('plants')
    expect(area.id).toBe('plants')
    expect(area.context.indoor?.default).toBe(true)
  })

  it('lists paths', async () => {
    const paths = await (await sourceFor()).listPaths('plants')
    expect(paths).toEqual([
      { id: 'leaf-propagation', title: 'Propagating from a leaf', summary: 'Grow a new plant from one leaf.' },
    ])
  })

  it('assembles a path in the manifest order, not filename order', async () => {
    const path = await (await sourceFor()).getPath('plants', 'leaf-propagation')
    expect(path.steps.map((step) => step.id)).toEqual(['select-leaf', 'callus'])
    expect(path.steps[1]?.body).toBe('Dry it for {{ callus_days }} days.')
  })

  it('keys steps by frontmatter id rather than filename', async () => {
    const source = await sourceFor({
      'plants/paths/leaf-propagation/99-whatever.mdx': '---\nid: select-leaf\ntitle: Renamed\n---\nBody.',
      'plants/paths/leaf-propagation/01-select-leaf.mdx': '---\nid: extra\ntitle: Extra\n---\nBody.',
      'plants/paths/leaf-propagation/path.yml':
        'id: leaf-propagation\ntitle: T\nsteps: [select-leaf]\n',
    })
    const path = await source.getPath('plants', 'leaf-propagation')
    expect(path.steps[0]?.title).toBe('Renamed')
  })

  it('throws when the manifest names a step with no file', async () => {
    const source = await sourceFor({
      'plants/paths/leaf-propagation/path.yml':
        'id: leaf-propagation\ntitle: T\nsteps: [select-leaf, callus, ghost]\n',
    })
    await expect(source.getPath('plants', 'leaf-propagation')).rejects.toThrow(ContentError)
  })

  it('throws when two step files share an id', async () => {
    const source = await sourceFor({
      'plants/paths/leaf-propagation/03-dupe.mdx': '---\nid: callus\ntitle: Dupe\n---\nBody.',
    })
    await expect(source.getPath('plants', 'leaf-propagation')).rejects.toThrow(ContentError)
  })

  it('reads a subject and lists all subjects', async () => {
    const source = await sourceFor()
    expect((await source.getSubject('plants', 'echeveria-elegans')).fields.callus_days).toBe(3)
    expect((await source.listSubjects('plants')).map((subject) => subject.id)).toEqual(['echeveria-elegans'])
  })

  it('lists myths', async () => {
    expect((await (await sourceFor()).listMyths('plants')).map((myth) => myth.id)).toEqual(['misting'])
  })

  it('returns an empty list when an area has no myths directory', async () => {
    const source = new FileContentSource(await writeTree({
      'plants/area.yml': 'id: plants\ntitle: Plants\ncontext: {}\n',
    }))
    expect(await source.listMyths('plants')).toEqual([])
  })

  it('lists the areas under the root', async () => {
    expect(await (await sourceFor()).listAreas()).toEqual(['plants'])
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run test/file-source.test.ts`
Expected: FAIL, cannot resolve `../src/content/file-source`.

- [ ] **Step 4: Write `src/content/file-source.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Area, ContentSource, Myth, Path, PathSummary, Step, Subject } from '../types'
import { ContentError, parseArea, parseMyth, parsePathManifest, parseStep, parseSubject } from './parse'

export class FileContentSource implements ContentSource {
  // Public because the validator needs to re-read a path directory to find
  // step files that no manifest lists.
  constructor(public readonly root: string) {}

  async listAreas(): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  }

  async getArea(area: string): Promise<Area> {
    const file = join(this.root, area, 'area.yml')
    return parseArea(file, await readFile(file, 'utf8'))
  }

  async listPaths(area: string): Promise<PathSummary[]> {
    const dir = join(this.root, area, 'paths')
    const entries = await readdirOrEmpty(dir)
    const summaries: PathSummary[] = []
    for (const name of entries) {
      // Path directories never contain a dot; this skips stray files.
      if (name.includes('.')) continue
      const file = join(dir, name, 'path.yml')
      const manifest = parsePathManifest(file, await readFile(file, 'utf8'))
      summaries.push({ id: manifest.id, title: manifest.title, summary: manifest.summary })
    }
    return summaries.sort((a, b) => a.id.localeCompare(b.id))
  }

  async getPath(area: string, id: string): Promise<Path> {
    const dir = join(this.root, area, 'paths', id)
    const manifestFile = join(dir, 'path.yml')
    const manifest = parsePathManifest(manifestFile, await readFile(manifestFile, 'utf8'))
    const byId = await this.readSteps(dir)

    const steps: Step[] = []
    for (const stepId of manifest.steps) {
      const step = byId.get(stepId)
      if (!step) throw new ContentError(manifestFile, [`steps: no file defines step "${stepId}"`])
      steps.push(step)
    }

    return {
      id: manifest.id,
      title: manifest.title,
      summary: manifest.summary,
      subjectType: manifest.subjectType,
      steps,
    }
  }

  // Steps are keyed by their frontmatter id, not their filename. The numeric
  // filename prefix exists so the directory reads in order for a human;
  // the authoritative order is the steps list in path.yml.
  async readSteps(dir: string): Promise<Map<string, Step>> {
    const byId = new Map<string, Step>()
    for (const name of await readdirOrEmpty(dir, '.mdx')) {
      const file = join(dir, name)
      const step = parseStep(file, await readFile(file, 'utf8'))
      if (byId.has(step.id)) throw new ContentError(file, [`id: duplicate step id "${step.id}"`])
      byId.set(step.id, step)
    }
    return byId
  }

  async getSubject(area: string, id: string): Promise<Subject> {
    const file = join(this.root, area, 'subjects', `${id}.yml`)
    return parseSubject(file, await readFile(file, 'utf8'))
  }

  async listSubjects(area: string): Promise<Subject[]> {
    const dir = join(this.root, area, 'subjects')
    const subjects: Subject[] = []
    for (const name of await readdirOrEmpty(dir, '.yml')) {
      const file = join(dir, name)
      subjects.push(parseSubject(file, await readFile(file, 'utf8')))
    }
    return subjects.sort((a, b) => a.id.localeCompare(b.id))
  }

  async listMyths(area: string): Promise<Myth[]> {
    const dir = join(this.root, area, 'myths')
    const myths: Myth[] = []
    for (const name of await readdirOrEmpty(dir, '.mdx')) {
      const file = join(dir, name)
      myths.push(parseMyth(file, await readFile(file, 'utf8')))
    }
    return myths.sort((a, b) => a.id.localeCompare(b.id))
  }
}

// A missing optional directory is not an error. A malformed one still is,
// because readdir only throws ENOENT for absence.
async function readdirOrEmpty(dir: string, extension?: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const filtered = extension ? entries.filter((name) => name.endsWith(extension)) : entries
  return filtered.sort()
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/content/file-source.ts test/helpers/tree.ts test/file-source.test.ts
git commit -m "add filesystem content source"
```

---

### Task 6: The validator

**Files:**
- Create: `src/content/validate.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Consumes: `FileContentSource`, parsers, `ContentError`, `placeholderNames` from `src/resolve/interpolate.ts`.
- Produces:
  - `interface ValidationProblem { file: string; message: string }`
  - `validateArea(source: FileContentSource, areaId: string): Promise<ValidationProblem[]>`
  - `validateAll(source: FileContentSource): Promise<ValidationProblem[]>`

Rules enforced, all from spec section 11 and 12:
1. Every file parses (parse errors become problems rather than exceptions, so one run reports everything).
2. Every condition key is declared in `area.context`.
3. `established` or `consensus` requires at least one source. `contested` requires at least two.
4. Every step file's id appears in its `path.yml` (no orphan content).
5. Every `{{ field }}` referenced by a path resolves on **every** subject in the area.
6. Cadence format (already enforced by the schema in Task 4, reported here as a parse problem).

- [ ] **Step 1: Write the failing test `test/validate.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { FileContentSource } from '../src/content/file-source'
import { validateAll, validateArea } from '../src/content/validate'
import { validTree, writeTree } from './helpers/tree'

async function problemsFor(overrides: Record<string, string> = {}): Promise<string[]> {
  const root = await writeTree({ ...validTree(), ...overrides })
  const problems = await validateArea(new FileContentSource(root), 'plants')
  return problems.map((problem) => problem.message)
}

describe('validateArea', () => {
  it('reports nothing for a valid tree', async () => {
    expect(await problemsFor()).toEqual([])
  })

  it('rejects consensus with no sources', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\nevidence: consensus\n---\nChoose a leaf.',
    })
    expect(messages.join(' ')).toContain('consensus')
  })

  it('rejects established with no sources', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\nevidence: established\n---\nChoose a leaf.',
    })
    expect(messages.join(' ')).toContain('established')
  })

  it('rejects contested with only one source', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx': [
        '---',
        'id: select-leaf',
        'title: Select a leaf',
        'evidence: contested',
        'sources:',
        '  - title: One side',
        '    url: https://example.org/one',
        '---',
        'Choose a leaf.',
      ].join('\n'),
    })
    expect(messages.join(' ')).toContain('at least two sources')
  })

  it('accepts anecdotal with no sources', async () => {
    expect(await problemsFor()).toEqual([])
  })

  it('rejects a condition on a context key the area does not declare', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/02-callus.mdx': [
        '---',
        'id: callus',
        'title: Let it callus',
        'variants:',
        '  - when: { soil_ph: { lte: 6 } }',
        '    action: append',
        '    body: Extra.',
        '---',
        'Dry it.',
      ].join('\n'),
    })
    expect(messages.join(' ')).toContain('soil_ph')
  })

  it('rejects an orphan step file not listed in the manifest', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/03-orphan.mdx': '---\nid: orphan\ntitle: Orphan\n---\nBody.',
    })
    expect(messages.join(' ')).toContain('orphan')
  })

  it('rejects an interpolation no subject provides', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\n---\nWait {{ mystery_field }} days.',
    })
    expect(messages.join(' ')).toContain('mystery_field')
  })

  it('rejects an interpolation only some subjects provide', async () => {
    const messages = await problemsFor({
      'plants/subjects/sedum-morganianum.yml': 'id: sedum-morganianum\nname: Sedum morganianum\nfields: {}\n',
    })
    expect(messages.join(' ')).toContain('callus_days')
  })

  it('reports a malformed cadence as a parse problem', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\ncadence: sometimes\n---\nChoose a leaf.',
    })
    expect(messages.join(' ')).toContain('cadence')
  })

  it('reports a myth with a bad verdict', async () => {
    const messages = await problemsFor({
      'plants/myths/misting.mdx': '---\nid: misting\ntitle: T\nverdict: nope\n---\nBody.',
    })
    expect(messages.join(' ')).toContain('verdict')
  })

  it('keeps going after the first problem', async () => {
    const messages = await problemsFor({
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\nevidence: consensus\n---\nWait {{ mystery }} days.',
    })
    expect(messages.length).toBeGreaterThan(1)
  })
})

describe('validateAll', () => {
  it('validates every area under the root', async () => {
    const root = await writeTree(validTree())
    expect(await validateAll(new FileContentSource(root))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/validate.test.ts`
Expected: FAIL, cannot resolve `../src/content/validate`.

- [ ] **Step 3: Write `src/content/validate.ts`**

```ts
import { placeholderNames } from '../resolve/interpolate'
import type { Area, Condition, EvidenceLevel, Path, Source, Step } from '../types'
import type { FileContentSource } from './file-source'
import { ContentError } from './parse'

export interface ValidationProblem {
  file: string
  message: string
}

const MINIMUM_SOURCES: Partial<Record<EvidenceLevel, number>> = {
  established: 1,
  consensus: 1,
  contested: 2,
}

export async function validateAll(source: FileContentSource): Promise<ValidationProblem[]> {
  const problems: ValidationProblem[] = []
  for (const areaId of await source.listAreas()) {
    problems.push(...(await validateArea(source, areaId)))
  }
  return problems
}

export async function validateArea(
  source: FileContentSource,
  areaId: string
): Promise<ValidationProblem[]> {
  const problems: ValidationProblem[] = []

  let area: Area
  try {
    area = await source.getArea(areaId)
  } catch (error) {
    return [...problems, ...toProblems(error, `${areaId}/area.yml`)]
  }

  const declaredKeys = new Set(Object.keys(area.context))

  const subjects = await collect(() => source.listSubjects(areaId), problems, `${areaId}/subjects`)
  const summaries = await collect(() => source.listPaths(areaId), problems, `${areaId}/paths`)

  for (const summary of summaries) {
    let path: Path
    try {
      path = await source.getPath(areaId, summary.id)
    } catch (error) {
      problems.push(...toProblems(error, `${areaId}/paths/${summary.id}`))
      continue
    }

    const listedIds = new Set(path.steps.map((step) => step.id))
    for (const orphan of await orphanStepIds(source, areaId, summary.id, listedIds)) {
      problems.push({
        file: `${areaId}/paths/${summary.id}`,
        message: `step "${orphan}" is defined but not listed in path.yml`,
      })
    }

    for (const step of path.steps) {
      const where = `${areaId}/paths/${summary.id}/${step.id}`
      problems.push(...evidenceProblems(where, step.evidence, step.sources))
      problems.push(...conditionProblems(where, step, declaredKeys))
      problems.push(...interpolationProblems(where, step, subjects))
    }
  }

  const myths = await collect(() => source.listMyths(areaId), problems, `${areaId}/myths`)
  for (const myth of myths) {
    problems.push(...evidenceProblems(`${areaId}/myths/${myth.id}`, myth.evidence, myth.sources))
  }

  return problems
}

async function collect<T>(
  read: () => Promise<T[]>,
  problems: ValidationProblem[],
  file: string
): Promise<T[]> {
  try {
    return await read()
  } catch (error) {
    problems.push(...toProblems(error, file))
    return []
  }
}

function toProblems(error: unknown, fallbackFile: string): ValidationProblem[] {
  if (error instanceof ContentError) {
    return error.issues.map((issue) => ({ file: error.file, message: issue }))
  }
  return [{ file: fallbackFile, message: (error as Error).message }]
}

function evidenceProblems(
  file: string,
  evidence: EvidenceLevel | undefined,
  sources: Source[] | undefined
): ValidationProblem[] {
  if (evidence === undefined) return []
  const required = MINIMUM_SOURCES[evidence]
  if (required === undefined) return []
  const count = sources?.length ?? 0
  if (count >= required) return []
  const need = required === 1 ? 'at least one source' : 'at least two sources'
  return [{ file, message: `evidence "${evidence}" requires ${need}, found ${count}` }]
}

function conditionProblems(file: string, step: Step, declaredKeys: Set<string>): ValidationProblem[] {
  const problems: ValidationProblem[] = []
  for (const variant of step.variants ?? []) {
    for (const key of conditionKeys(variant.when)) {
      if (declaredKeys.has(key)) continue
      problems.push({ file, message: `condition uses "${key}", which the area does not declare` })
    }
  }
  return problems
}

function conditionKeys(condition: Condition): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(condition)) {
    if (key === 'any') {
      for (const branch of (value ?? []) as Condition[]) keys.push(...conditionKeys(branch))
      continue
    }
    keys.push(key)
  }
  return keys
}

function interpolationProblems(
  file: string,
  step: Step,
  subjects: { id: string; fields: Record<string, unknown> }[]
): ValidationProblem[] {
  if (subjects.length === 0) return []

  const texts = [
    step.title,
    step.body,
    step.why ?? '',
    step.cadence ?? '',
    ...(step.variants ?? []).map((variant) => variant.body ?? ''),
  ]
  const referenced = new Set(texts.flatMap((text) => placeholderNames(text)))

  const problems: ValidationProblem[] = []
  for (const name of referenced) {
    const missing = subjects
      .filter((subject) => !Object.prototype.hasOwnProperty.call(subject.fields, name))
      .map((subject) => subject.id)
    if (missing.length === 0) continue
    problems.push({
      file,
      message: `interpolation "${name}" is missing on subject(s): ${missing.join(', ')}`,
    })
  }
  return problems
}

async function orphanStepIds(
  source: FileContentSource,
  areaId: string,
  pathId: string,
  listed: Set<string>
): Promise<string[]> {
  const dir = `${source.root}/${areaId}/paths/${pathId}`
  try {
    const byId = await source.readSteps(dir)
    return [...byId.keys()].filter((id) => !listed.has(id))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/validate.ts test/validate.test.ts
git commit -m "add content validator with evidence rules"
```

---

### Task 7: CLI, public exports, and README

**Files:**
- Create: `src/cli/validate.ts`
- Create: `src/index.ts`
- Create: `README.md`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the `pathkit validate <dir>` command, exiting 0 on success and 1 when problems are found. `src/index.ts` is the package's public surface, which Plan 2 imports from.

- [ ] **Step 1: Write `src/index.ts`**

```ts
export type {
  Area,
  Condition,
  Comparator,
  ContentSource,
  Context,
  ContextFieldSchema,
  ContextFieldType,
  ContextValue,
  EvidenceLevel,
  Myth,
  MythVerdict,
  Path,
  PathSummary,
  ResolvedPath,
  ResolvedStep,
  Source,
  Step,
  Subject,
  Variant,
  VariantAction,
} from './types'

export {
  defaultContext,
  evaluate,
  interpolate,
  placeholderNames,
  resolve,
  withDefaults,
  zoneToNumber,
  PLACEHOLDER_PATTERN,
} from './resolve/index'
export type { ResolveOptions } from './resolve/index'

export { FileContentSource } from './content/file-source'
export {
  ContentError,
  parseArea,
  parseMyth,
  parsePathManifest,
  parseStep,
  parseSubject,
  CADENCE_PATTERN,
} from './content/parse'
export type { PathManifest } from './content/parse'
export { validateAll, validateArea } from './content/validate'
export type { ValidationProblem } from './content/validate'
```

- [ ] **Step 2: Write `src/cli/validate.ts`**

```ts
#!/usr/bin/env node
import { FileContentSource } from '../content/file-source'
import { validateAll, validateArea } from '../content/validate'

async function main(): Promise<number> {
  const [command, dir, ...areas] = process.argv.slice(2)

  if (command !== 'validate' || dir === undefined) {
    process.stderr.write('usage: pathkit validate <content-dir> [area ...]\n')
    return 2
  }

  const source = new FileContentSource(dir)
  const problems =
    areas.length > 0
      ? (await Promise.all(areas.map((area) => validateArea(source, area)))).flat()
      : await validateAll(source)

  if (problems.length === 0) {
    process.stdout.write('pathkit: content OK\n')
    return 0
  }

  for (const problem of problems) {
    process.stderr.write(`${problem.file}: ${problem.message}\n`)
  }
  const noun = problems.length === 1 ? 'problem' : 'problems'
  process.stderr.write(`\npathkit: ${problems.length} ${noun}\n`)
  return 1
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`pathkit: ${(error as Error).message}\n`)
    process.exit(1)
  }
)
```

- [ ] **Step 3: Write the failing test `test/cli.test.ts`**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { validTree, writeTree } from './helpers/tree'

const run = promisify(execFile)

async function cli(root: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('node', ['dist/cli/validate.cjs', 'validate', root])
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string }
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr }
  }
}

describe('pathkit validate', () => {
  it('exits 0 and says OK for valid content', async () => {
    const result = await cli(await writeTree(validTree()))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('content OK')
  })

  it('exits 1 and prints each problem for invalid content', async () => {
    const root = await writeTree({
      ...validTree(),
      'plants/paths/leaf-propagation/01-select-leaf.mdx':
        '---\nid: select-leaf\ntitle: Select a leaf\nevidence: established\n---\nChoose a leaf.',
    })
    const result = await cli(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('established')
    expect(result.stderr).toContain('1 problem')
  })
})
```

- [ ] **Step 4: Build, then run the test and confirm it passes**

Run: `npm run build && npx vitest run && npx tsc --noEmit`
Expected: build succeeds, all tests PASS, no type errors. The CLI test runs against `dist/`, so the build must come first.

- [ ] **Step 5: Write `README.md`**

````markdown
# pathkit

A content engine for structured, evidence-backed, context-specialized guides.

It knows how to define, specialize, and validate guided paths. It ships no
content: content lives in the repo of the site that consumes it.

## Install

```bash
npm install github:jordodrummer/pathkit
```

## Content layout

```
content/plants/
  area.yml                     declares the reader context this area accepts
  paths/<path-id>/
    path.yml                   title plus the ordered list of step ids
    01-<step>.mdx              one step, frontmatter plus markdown body
  subjects/<subject-id>.yml    per-variety data interpolated into steps
  myths/<myth-id>.mdx          standalone refutations of common claims
```

Steps are keyed by their frontmatter `id`, not their filename. The numeric
prefix is only so the directory reads in order.

## Resolving a path

```ts
import { FileContentSource, defaultContext, resolve } from 'pathkit'

const source = new FileContentSource('./content')
const area = await source.getArea('plants')
const path = await source.getPath('plants', 'leaf-propagation')
const subject = await source.getSubject('plants', 'echeveria-elegans')

// Static generation: the base, indexable version.
const base = resolve(path, subject, defaultContext(area), { area })

// Personalized on the client once the reader sets their context.
const personal = resolve(path, subject, { zone: '9b', indoor: false }, { area })
```

## Evidence rules

Every step and myth may declare `evidence`:

| Level | Meaning | Sources required |
|---|---|---|
| `established` | Supported by research | 1 |
| `consensus` | Practitioners broadly agree, not formally studied | 1 |
| `contested` | Credible people disagree | 2 |
| `anecdotal` | One person's experience | 0 |

Routine procedural steps may omit `evidence` entirely and need no sources.
The gate applies to claims asserting a mechanism, a benefit, or a contested
position.

## Validating in CI

```bash
npx pathkit validate ./content
```

Exits non-zero and prints every problem it found. Run it in each consuming
site's CI so a broken guide can never reach a reader.
````

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/cli/validate.ts test/cli.test.ts README.md
git commit -m "add validate CLI, public exports and README"
```

- [ ] **Step 7: Push the repo**

```bash
gh repo create jordodrummer/pathkit --private --source=. --remote=origin --push
```

Use `--private` for now. It can be made public later; a git dependency works either way as long as the machine installing it can authenticate.

---

## What Plan 2 picks up

Plan 2 covers the React layer and the first real consumer:

- `<ContextForm>`, `<PathView>`, `<StepList>`, `<MythCard>`, and evidence badges
- `ProgressStore` with the localStorage implementation and in-memory fallback
- plant-app integration: routes, static generation via `defaultContext()`, client-side re-resolution
- The first real plant guides, with real citations
- `pathkit validate` wired into plant-app's CI
