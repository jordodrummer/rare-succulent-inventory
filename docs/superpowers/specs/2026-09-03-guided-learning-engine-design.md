# Guided Learning Engine (pathkit) - Design

**Date:** 2026-09-03
**Status:** Awaiting review
**Scope:** New shared package plus its first consumer (plant care guides in plant-app)

## 1. Purpose

Build a reusable engine for **structured, evidence-backed, context-specialized guidance**, and use it first to deliver plant care and propagation guides.

Three products will consume it:

1. **Plant care** (plant-app, first consumer): location-specific and variety-specific care and propagation advice, broken into simple steps.
2. **Resume and job application app** (new project, later): guidance at each stage of the job search process.
3. **DJ guide** (greenzofreaks.com, later): technique and gear guidance by genre and skill level.

All three are the same shape: guidance, broken into steps, filtered by the reader's context, and held to a stated evidence standard. The engine exists so that adding a fourth area requires writing content, not writing an app.

## 2. Goals

- One content model and one rendering engine, reused across unrelated sites.
- Content specialized by reader context without combinatorial authoring explosion.
- Every claim carries an explicit evidence level, enforced mechanically rather than by discipline.
- Guides render as static, indexable pages so they work as a search traffic channel.
- Adding a new subject area touches content only, never engine code.

## 3. Non-goals and deferred work

Captured deliberately so they are not lost and not built now.

| Deferred | Why | Exit already designed |
|---|---|---|
| Generic stage-based record tracking | The job application tracker gets built concretely first. A general abstraction with one hypothetical use case is a guess. | Extract after the job app ships, with a real second use case in hand. |
| Calendar and schedule generation, iCal export | Care schedules and gig booking are different systems that merely look alike. | `cadence` lands in the content model now so guides are authored once. |
| Shared identity across all three sites | The products do not share an audience. | `ProgressStore` interface. |
| Database-backed content and browser authoring | Single author who writes in an editor. | `ContentSource` interface. |
| Gig booking calendar on greenzofreaks | Separate project with its own existing spec (`2026-08-26-booking-page-design.md`), which deliberately chose email-based requests over availability management. | Out of scope here. |

## 4. Decisions and rationale

Recording these so future work does not relitigate them.

1. **Shared engine, not three similar apps.** Chosen for scaling to further areas.
2. **Content engine only, not content plus record tracking.** Two of three products need only the content half.
3. **Base path plus conditional variants, plus interpolated subject data.** Rejected query-assembled content because paths become unpredictable and hard to proofread with a single editor.
4. **Files now, loader abstracted.** Single author writing in an editor. A conditional-variant editing UI is the expensive part of a CMS and buys nothing yet.
5. **Git-dependency package, code only, content lives with the consuming site.** Preserves static generation. Adding an area never touches the engine. Rejected a monorepo (disruptive migration of live projects) and a hosted API (kills static rendering, adds infrastructure).
6. **Anonymous progress in localStorage by default.** Most plant traffic arrives from search with no account.
7. **Evidence level is schema-enforced.** Credibility that depends on remembering to be rigorous decays.

## 5. Concepts

- **Area**: a subject domain (`plants`, `jobs`, `dj`). Declares its own context schema.
- **Path**: a guided sequence on one topic, with ordered steps.
- **Step**: one action in plain language, with evidence metadata and optional variants.
- **Context**: what is known about the reader, shaped per area (`{ zone: '9b', indoor: true }`).
- **Variant**: an override on a step, fired by a condition. Appends, replaces, or hides.
- **Subject**: the per-thing data record (a plant variety, a role type) whose fields interpolate into step bodies.
- **Myth**: a standalone refutation of a widespread claim, browsable on its own and attachable to a path.

## 6. Content layout

Content lives in the consuming site's repo. One directory per path, one file per step, so every step is independently diffable and reviewable.

```
content/plants/
  area.yml
  paths/
    leaf-propagation/
      path.yml
      01-select-leaf.mdx
      02-callus.mdx
      03-plant.mdx
  subjects/
    echeveria-elegans.yml
  myths/
    misting-succulents.mdx
```

### area.yml

Declares the context schema. The validator uses this to reject conditions referencing fields the area does not define.

```yaml
id: plants
title: Plant care and propagation
subjectType: variety
context:
  zone:
    type: enum
    values: [1a, 1b, 2a, 2b, 3a, 3b, 4a, 4b, 5a, 5b, 6a, 6b, 7a, 7b, 8a, 8b, 9a, 9b, 10a, 10b, 11a, 11b, 12a, 12b, 13a, 13b]
    optional: true
  indoor:
    type: boolean
    default: true
  humidity:
    type: number
    unit: percent
    optional: true
```

### path.yml

```yaml
id: leaf-propagation
title: Propagating Echeveria from a leaf
summary: Grow a new plant from a single leaf, start to rooted cutting.
subjectType: variety
steps: [select-leaf, callus, plant]
```

### A step

```mdx
---
id: callus
title: Let the cut end callus over
cadence: null
evidence: consensus
why: |
  The exposed tissue is an open wound. A dry, sealed surface is far less
  hospitable to the soil bacteria and fungi that cause rot once the leaf
  is in contact with a moist medium.
sources:
  - title: Cactus and Succulent Society propagation guidance
    url: https://example.org/propagation
    finding: Recommends 2 to 7 days of drying before planting.
variants:
  - when: { humidity: { gte: 70 } }
    action: append
    body: |
      In humid air this takes longer. Give it up to twice as long, and
      wait for a visibly dry, slightly shrunken cut surface rather than
      counting days.
  - when: { indoor: false, zone: { lte: 8 } }
    action: hide
---

Set the leaf somewhere dry and out of direct sun for
{{ callus_days }} days, until the cut end is dry to the touch.
```

All source URLs in the examples in this section point at `example.org` and
are illustrative. Real content requires real citations, and the validator enforces
that only for the evidence levels that claim support (see section 11).

### A subject

```yaml
id: echeveria-elegans
name: Echeveria elegans
common_names: [Mexican snowball]
fields:
  callus_days: 3
  water_interval_days: 10
```

### A myth

`verdict` is one of `false`, `misleading`, or `oversimplified`. A myth is not
always flatly wrong. Often it is advice that is true in a narrow case and
wrongly generalized, and saying so is more useful than saying "false".

```mdx
---
id: misting-succulents
title: "Misting succulents keeps them healthy"
verdict: false
evidence: established
sources:
  - title: Illustrative only. Real citations required at authoring time.
    url: https://example.org/
    finding: What this source actually showed.
---

Misting raises humidity around the leaves without delivering water to the
roots, where these plants actually take it up. On plants adapted to arid
conditions it mainly leaves standing moisture in the leaf rosette, which
is where rot starts.
```

## 7. Conditions

A condition is an object over context keys. Keys combine with AND. Use `any: [...]` for OR.

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`. A bare value is shorthand for `eq`.

```yaml
when: { indoor: true, zone: { gte: 9 } }
when: { any: [ { zone: { lte: 6 } }, { indoor: false } ] }
```

USDA zones compare by their numeric part, so `9a` and `9b` both satisfy `{ gte: 9 }`. The engine gets a small set of typed comparators (number, boolean, enum, usda-zone) rather than a general expression language, which keeps conditions readable and statically checkable.

## 8. Cadence

`cadence` is optional on a step and describes how often the action repeats. It
is carried now so guides are authored once, and consumed later by the deferred
calendar work. Nothing in v1 reads it beyond validation.

Accepted forms:

- `null` or omitted: a one-time step.
- An interval: `7d`, `2w`, `1mo`, `1y`.
- A season keyword: `spring`, `summer`, `fall`, `winter`.
- An interval that varies by subject: `{{ water_interval_days }}d`, interpolated
  from the subject's fields like any other value.

The validator rejects any other form. It does not attempt to expand a cadence
into dates, because generating a schedule is deferred work with its own design.

## 9. Modules

### ContentSource (interface)

```ts
interface ContentSource {
  listPaths(area: string): Promise<PathSummary[]>
  getPath(area: string, id: string): Promise<Path>
  getSubject(area: string, id: string): Promise<Subject>
  listMyths(area: string): Promise<Myth[]>
}
```

v1 ships `FileContentSource`, reading the layout above. The database-backed implementation is the designed exit if browser authoring is ever needed.

### resolve (pure function)

```ts
function resolve(path: Path, subject: Subject, context: Context): ResolvedPath
```

Evaluates conditions, applies variants in declaration order, interpolates subject fields, drops hidden steps. No I/O, no framework, no globals. This is the heart of the engine and carries the bulk of the test weight precisely because it is pure.

### ProgressStore (interface)

```ts
interface ProgressStore {
  get(pathId: string): Promise<Record<string, boolean>>
  setStepDone(pathId: string, stepId: string, done: boolean): Promise<void>
}
```

v1 ships `LocalStorageProgressStore`, falling back to in-memory when storage is unavailable. plant-app may later supply a Supabase-backed implementation since it already has accounts.

### React components

`<ContextForm>` collects the reader's context from the area schema. `<PathView>` and `<StepList>` render a resolved path with evidence badges, expandable `why`, and a source list. `<MythCard>` renders a myth. Structurally complete, visually minimal, styled by the consuming site so each brand keeps its own look.

### validate (CLI)

`pathkit validate ./content/plants`. Runs in each consuming site's CI.

## 10. Rendering and SEO

Each site statically generates one page per path at build time using a **default context**, meaning the base version with no variants applied. Those pages are crawlable and become a search traffic channel.

When a reader submits `<ContextForm>`, the context persists to localStorage and `resolve()` re-runs on the client, swapping in zone-specific and variety-specific steps.

Accepted tradeoff: the personalized version is not indexed. This is correct, because variants refine the base advice rather than replacing it with different advice.

## 11. Evidence model

Every step and myth carries an `evidence` level:

- `established`: supported by research.
- `consensus`: experienced practitioners broadly agree, not formally studied.
- `contested`: credible people disagree, and the content says so.
- `anecdotal`: one person's experience, labeled as such.

`why` states the mechanism, separately from the instruction, so a reader whose situation differs from the author's can adapt rather than follow a recipe.

**Validator rules, enforced in CI:**

- A step or myth marked `established` or `consensus` with zero `sources` fails the build.
- A step or myth marked `contested` with fewer than two sources fails the build.
- Every source requires a `title` and either a `url` or a full text reference.

**Tiering, so rigor does not stop authoring.** Routine procedural instructions ("twist the leaf off cleanly at the stem") need no citation and may omit `evidence` entirely. The gate applies to claims asserting a mechanism, a benefit, or a contested position. `anecdotal` is a fully legitimate label, so hard-won personal experience can ship as long as it is not disguised as research.

**Reader-facing:** an evidence badge per step, sources listed at the end of the path, `why` expandable inline. Uncertainty is displayed rather than hidden, which both earns trust and models the critical thinking the products are meant to teach.

## 12. Error handling

The rule: **content errors fail the build, runtime errors degrade quietly.**

Build time (validator): malformed frontmatter, unknown condition operators, conditions referencing context fields the area does not declare, interpolations naming a field the subject lacks, unparseable `cadence`, path referencing a missing step file, evidence rules above. All fail with file path and line. A broken guide must never reach a reader.

Runtime: an unknown context key evaluates its condition as false and logs a warning. A missing subject field renders the surrounding sentence without the value rather than printing raw `{{ callus_days }}` to a customer. localStorage unavailable falls back to in-memory progress. Nothing about progress tracking may block someone from reading a guide.

## 13. Testing

Test-first, with `resolve()` carrying the bulk of the weight.

- **`resolve()`**: table-driven tests over (path, subject, context) to expected resolved steps. Covers variant precedence, hide, append, replace, interpolation, and missing fields.
- **Condition evaluator**: unit tests per operator and per comparator type, including zone comparison.
- **FileContentSource and validator**: fixture content directory including deliberately broken files, asserting each validation rule fires with a useful message.
- **Components**: render tests for evidence badges, source lists, and context form round-tripping.
- **ProgressStore**: persistence, and graceful degradation when storage throws.

## 14. Repo layout

New repo `pathkit`:

```
src/
  content/     # types, parser, FileContentSource, validator
  resolve/     # conditions, variants, interpolation
  progress/    # ProgressStore implementations
  react/       # components
  cli/         # validate
```

Consumed as `npm i github:jordodrummer/pathkit`. Content lives in each consuming site under `content/<area>/`.

## 15. Build order

1. **This project:** `pathkit` plus plant care guides in plant-app, built together. An engine with no consumer is a guess about what an engine should do.
2. **Later, own cycle:** resume and job application app.
3. **Later, own cycle:** DJ guide on greenzofreaks.

The job app is the real test of the abstraction. Expect the engine to need adjustment when it lands. That is the abstraction being validated, not failing.

## 16. Open questions for implementation planning

- Initial plant content scope: which paths and how many varieties ship in the first release.
- Whether `<ContextForm>` prompts on first visit or stays behind an explicit "personalize this guide" control.
- Whether myths get their own index route in v1 or only appear attached to paths.
