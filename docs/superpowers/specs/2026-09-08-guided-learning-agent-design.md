# Guided Learning Agent - Design

**Date:** 2026-09-08
**Status:** Awaiting review
**Scope:** Adds a conversational context-elicitation agent to pathkit, plus its first use in plant-app
**Extends:** `2026-09-03-guided-learning-engine-design.md` (the engine spec). Amendments to that document are listed in section 15.

## 1. Purpose

The engine specializes guidance by reader context. The engine spec fills that context with `<ContextForm>`, a form generated from the area's declared schema. A form is a poor fit for the actual traffic: someone arriving from search does not know what a USDA zone is, does not know their humidity, and will not fill in six fields to find out how long to let a leaf callus.

This design replaces the form as the primary entry with an agent that asks the reader questions in plain language, extracts typed values from the answers, and hands off to the same guide the engine already renders.

The questions are not written by hand per area and are not chosen by the model. They are derived from the content: the fields that appear in a `when:` condition somewhere in the path are exactly the questions worth asking, because they are exactly the fields that can change what the reader reads. This is what "the specifics built into each framework" resolves to mechanically. Each area declares its own context schema, each area's content declares its own branches, and the agent is the same code in all three products.

## 2. Goals

- Collect reader context through conversation rather than a form, without asking a single question whose answer cannot change the output.
- Keep the engine's evidence guarantees intact. Every claim a reader sees still comes from validated, cited content.
- Add an area without writing agent code or prompts. Writing a new `when:` condition is what teaches the agent a new question.
- Keep the interview logic deterministic and testable without calling a model.
- Degrade to the existing form on any failure, and never block a reader from reading a guide.

## 3. Non-goals and deferred work

| Deferred | Why | Exit already designed |
|---|---|---|
| Split-screen live guide preview (conversation beside a guide that updates as answers arrive) | Doubles layout work and gets cramped on phones, which is where most plant traffic lands. Worth building once the single-column flow is proven. | `resolve()` is pure and synchronous, so a preview pane is UI work, not an engine change. Nothing in this design forecloses it. |
| Agent renders the guide inside the conversation | Turns a cited-content site into a chatbot, and puts uncited model text visually adjacent to cited steps. | Rejected on purpose, not deferred. |
| Server-side conversation storage | The route is stateless by design. No session store, no cleanup job. | State round-trips to the client and is re-validated server-side every turn. |
| Subject selection by model over a large catalog | Fine while variety counts are small. Hundreds of subjects will not fit in a prompt. | A filter step before the model call. Not a redesign. |
| Login-gated agent | Puts a login in front of the front door of a site whose traffic model is anonymous search arrivals. | Rate limit plus spend ceiling instead (section 12). |
| Voice, multi-turn memory across visits | No demand, and the context already persists in localStorage. | `ProgressStore` and the existing context persistence. |

## 4. Decisions and rationale

1. **The agent is an interviewer, not an answerer, by default.** The engine's credibility rests on evidence levels enforced in CI. A model improvising care advice is the exact failure that architecture exists to prevent, and it is uncitable by construction. Freeform answering exists as an opt-in per area (section 11), because the DJ guide has legitimate questions with no literature to cite, and plant care does not.
2. **The content decides which questions get asked, the model does the talking.** Rejected letting the model choose questions from the schema. Deriving the question set from `when:` conditions makes "the right questions" a computable property, gives the interview a real stopping condition, makes it testable, and means the agent gets smarter as content is written rather than as prompts are tuned.
3. **Both entry points, one interview.** Guide pages need the agent regardless, because search traffic lands on them. The front door is the same interview with one extra routing turn at the start.
4. **Handoff to the guide page, not rendering in the conversation.** Reuses `<PathView>` and `<StepList>` unchanged, keeps URLs shareable, and keeps evidence presentation identical whether the reader arrived by search or by conversation.
5. **`<ContextForm>` is kept as the fallback, not removed.** It covers no-JS, API failure, spend ceiling, and readers who prefer a form. Both write the same `Context`.
6. **`LLMClient` is an interface.** Matches `ContentSource` and `ProgressStore`. Keeps the interview testable with a scripted fake, and does not force three unrelated sites onto one provider or one account.
7. **The route is stateless.** No session infrastructure for a feature whose entire state is a handful of typed values.

## 5. How the interview works

### 5.1 Deriving the question set

Given a path and its area, walk every step's `variants[].when` conditions (including inside `any: [...]`) and collect the context keys referenced. Intersect with the keys the area declares. That set is the complete list of questions.

Nothing outside it is ever asked. If `leaf-propagation` branches only on `humidity` and `indoor`, the reader is never asked their zone, because their zone cannot change a single word they read.

A path with no variants derives zero questions. The agent asks nothing and goes straight to the guide.

### 5.2 Ordering by impact

Questions are ordered by how much of the guide their answer can change:

- A field referenced by more variants ranks higher than one referenced by fewer.
- A field driving `hide` or `replace` ranks above one driving `append`, because it changes more than it adds.
- Ties break on the field's declaration order in `area.yml`, so ordering is deterministic.

Pure function over the path. No model involved.

### 5.3 Extraction targets the whole schema

One answer often fills several fields. "I'm in Phoenix and it lives outside on the patio" answers `zone` and `indoor` at once. So extraction runs against the entire declared schema on every turn, while question selection targets only the highest-impact unanswered field. The interview routinely runs shorter than the question count.

### 5.4 The model's job

Exactly two things per turn: phrase the question the engine selected, and parse the reader's reply into typed values. One request, structured output, both jobs in one response.

It receives the area's context schema, which fields remain unanswered, the field the engine selected, and the transcript. It cannot invent a field, because the extraction schema is generated from `area.yml` and contains only declared keys.

Two call shapes, both with closed output spaces:

```ts
// Routing turn. Front door only, at most once per conversation.
type RouteResult = {
  pathId: string | null      // must be an id from the supplied summaries
  question: string | null    // asked when routing is not yet confident
}

// Every other turn.
type TurnResult = {
  extracted: Record<string, unknown>  // proposed values, declared keys only
  skipped: string[]                   // fields the reader declined to answer
  question: string                    // phrasing of the field the engine selected
  note?: string                       // freeform answer, only when enabled (section 11)
}
```

The engine decides when the interview is over, so the model is never asked to. When `isComplete()` is true no request is made at all: the confirmation summary is templated from `Context` directly.

### 5.5 The validation gate

Every proposed value is checked against the area schema's declared type before it enters `Context`. A zone parses as a USDA zone or it is rejected. A boolean is a boolean. A number carries the declared unit and falls in range. An enum value is in the set.

A rejected value leaves its field unanswered, and the model is told the value failed so it can rephrase. The model proposes; typed code decides. The model never writes into `Context`.

### 5.6 Stopping and skipping

The interview ends when every field in the derived set is answered or explicitly skipped.

"Not sure" is a first-class answer. It marks the field skipped and leaves it unset, and the reader gets the base advice for that dimension rather than advice built on a guess. This requires the engine rule made explicit in section 15: a condition referencing a declared but unset field evaluates false.

### 5.7 The routing turn

The one place the model picks rather than fills. At the front door there is no candidate path, so the first request supplies the area's path summaries (id, title, summary) and the reader's opening message. The model returns a path id from that list or a clarifying question. If it cannot route confidently, the reader gets the path index, which is the existing browse page.

Arriving on a guide page skips this turn entirely, because the path is already known.

### 5.8 Explaining the question

Because the derivation already knows which variants each question controls, the agent can state why it is asking: "I'm asking about humidity because it changes how long step 2 takes."

Free to produce, and on-brand for a project whose stated purpose includes modeling critical thinking rather than issuing recipes.

## 6. Conversation flow and handoff

1. Reader opens the agent, either from the front door or from a guide page.
2. Front door only: routing turn selects the path.
3. Loop, bounded by the turn cap: engine selects the highest-impact unanswered field, model phrases it and parses the reply, values pass the validation gate.
4. Engine reports complete. A templated summary shows what was understood, and the reader can correct any value before continuing.
5. Handoff. `Context` persists to localStorage under the same key `<ContextForm>` uses, and the reader lands on the guide page with variants applied.

The handoff carries `Context` and nothing else. No model-generated text reaches the guide page. This is a property of the data flow, not of a prompt instruction.

Hitting the turn cap resolves with whatever was gathered and hands off anyway. Partial context is valid context, and a reader who answered two of four questions still gets a better guide than the base version.

## 7. area.yml additions

```yaml
id: plants
title: Plant care and propagation
subjectType: variety
assistant:
  enabled: true
  freeform: false        # section 11
  logUnanswered: true
  maxTurns: 8
context:
  zone:
    type: usda-zone
    optional: true
    ask: "Where do you live, or what USDA zone are you in?"
  indoor:
    type: boolean
    default: true
  humidity:
    type: number
    unit: percent
    optional: true
```

`ask` is an optional per-field hint. When present the model uses it as the basis for its phrasing rather than inventing one from the field name. It exists for fields whose names are clear to the author and opaque to a reader.

The whole `assistant` block is optional. Omitted means the agent is off and the area behaves exactly as the engine spec describes.

## 8. Modules

New module `src/interview/`, split into a pure core and a thin server edge.

### Pure core

```ts
function deriveQuestions(path: Path, area: Area): Question[]

function applyAnswers(
  state: InterviewState,
  proposed: Record<string, unknown>,
  skipped: string[],
  area: Area,
): { state: InterviewState; rejected: string[] }

function isComplete(state: InterviewState, questions: Question[]): boolean

function nextQuestion(state: InterviewState, questions: Question[]): Question | null
```

```ts
interface InterviewState {
  areaId: string
  pathId: string | null
  subjectId: string | null
  context: Context
  skipped: string[]
  turns: number
  transcript: LLMMessage[]
}
```

No I/O, no model, no framework, no globals. Same character as `resolve()`, and it carries comparable test weight.

### LLMClient (interface)

```ts
interface LLMClient {
  complete<T>(req: {
    system: string
    messages: LLMMessage[]
    schema: JSONSchema   // structured output contract
    maxTokens: number
  }): Promise<T>
}
```

The third interface alongside `ContentSource` and `ProgressStore`, for the same two reasons: a scripted fake makes the interview testable without a network, and no consuming site is forced onto one provider or one account.

`AnthropicLLMClient` ships in a subpath export (`pathkit/anthropic`) with `@anthropic-ai/sdk` as an optional peer dependency, so a site that never enables the agent does not pull it in.

### React

`<GuideAgent>` joins the existing components. `<ContextForm>` is unchanged and stays as the fallback described in section 13. Both write the same `Context` to the same storage key, so a reader can start in the chat and correct a field in the form afterwards.

### Validator

`pathkit validate` gains two checks and one report:

- The `assistant` block validates against its schema.
- Every `ask` string belongs to a declared context field.
- Per path, the derived question count is reported, so interview length is visible in CI and drift shows up in a diff rather than in an abandoned conversation.

## 9. Server edge

```ts
createInterviewHandler({ source, area, llm, limits }): (req: Request) => Promise<Response>
```

Returns a standard Web handler. In plant-app that is `export const POST = createInterviewHandler({...})` in `src/app/api/guide-agent/route.ts` and nothing else. The same one-liner works on greenzofreaks and the job app.

**Stateless.** Conversation state round-trips to the client rather than sitting in a session store. Safe because every proposed value is re-validated server-side against the area schema on every turn, so forged state cannot inject an invalid context.

Being straight about the limit: forged state can reset the turn counter. The turn cap is a cost and UX bound for honest clients. The per-IP limit and the monthly ceiling in section 12 are the actual defenses.

## 10. Model configuration and cost

- Model `claude-opus-5`.
- Structured outputs via `output_config.format` against the generated schema.
- `output_config: { effort: "low" }`. Phrasing one question and pulling typed values from a sentence is a bounded task; the schema does the hard part.
- Non-streaming, modest `max_tokens`. Each response is one short question, so streaming adds machinery and buys nothing.
- Prompt caching is not configured. The minimum cacheable prefix is model-dependent and the stable prefix here (system prompt plus generated schema) is likely below it, so caching would silently do nothing. Worth measuring `usage.cache_read_input_tokens` once before deciding otherwise.

**Cost, as an estimate to be replaced by measurement.** Roughly 1,300 input tokens and a few hundred output tokens per turn, which at Opus 5 rates is on the order of one to two cents per turn and under ten cents for a completed interview. At low traffic this is noise. At high traffic it is what the monthly ceiling exists to bound, which is why the ceiling is an env var from day one rather than something added after a surprising invoice.

## 11. Freeform mode and its fences

Off by default, set per area via `assistant.freeform`.

**With freeform off** (the plant default), a question the content does not cover gets an honest "I don't have a guide on that," plus the closest path or myth if one exists. That is routing over authored content, not generation, so it stays inside the evidence model.

**With freeform on** (the likely DJ setting, where "what cue points work for this genre" has no literature and never will), four structural fences:

1. **Content first.** The agent checks paths and myths before generating and prefers quoting cited content. Freeform is the fallback, not the default behavior.
2. **A distinct block type, not an evidence level.** Evidence badges mean a claim was sourced at authoring time. Labeling a model answer `anecdotal` would be a lie, since `anecdotal` means a real person's real experience. Freeform output renders as a visually distinct block, explicitly labeled unverified, never styled as a step.
3. **Never inside the step list, never on the guide page.** The handoff carries `Context` only, so uncited text structurally cannot reach the reading surface.
4. **Freeform output never touches `Context`** and therefore cannot influence `resolve()` or change which steps a reader sees.

**One topic class is excluded even with freeform on:** toxicity to pets and children. It will be asked, the stakes are asymmetric, and the correct behavior is to route to content or say plainly that it is not covered.

**`logUnanswered` applies in both modes.** Every question a reader asks that no content covers is stored anonymized, with no free text beyond the question. That list is a content backlog written by the actual audience, and it is the highest-value byproduct of the feature.

## 12. Rate limiting and spend control

- Per-IP rate limit on the route.
- `assistant.maxTurns` caps a conversation, default 8.
- A monthly spend ceiling read from an env var. On reaching it the agent disables itself and every entry point falls back to `<ContextForm>`.

The turn cap is not an arbitrary throttle. Interview length is bounded by the number of context fields the content branches on, which is computed at build time and reported by the validator.

## 13. Error handling and degradation

The engine rule extends by one clause: content errors fail the build, runtime errors degrade quietly, **agent failures degrade to the form**.

| Condition | Behavior |
|---|---|
| API error, timeout, or rate limit | `<ContextForm>` replaces the chat with a one-line note |
| Monthly spend ceiling reached | Agent disabled, form everywhere |
| `stop_reason: "refusal"` | Handled as a decline, falls back to the form |
| Extraction returns nothing usable twice running | Offer the form, ending the rephrase loop |
| Turn cap reached | Resolve with gathered context and hand off |
| Model proposes an invalid value | Field stays unanswered, model told, may rephrase once |
| localStorage unavailable | Context held in memory for the session |

The invariant, matching the one the engine spec states for progress tracking: **nothing about the agent may prevent someone from reading a guide.** Guide pages are statically generated and never depend on the agent.

## 14. Testing

Deterministic, in CI, no API calls and no key required:

- **`deriveQuestions`**: table-driven over (path, area) to expected ordered question list. Covers nested `any:` conditions, impact ordering, tie-breaking, and the zero-variant path that derives no questions.
- **`applyAnswers`**: the validation gate per declared type, every rejection path, skip handling, and multi-field extraction from a single answer.
- **The interview state machine**, driven by a scripted fake `LLMClient`, with whole transcripts as fixtures. The logic that can actually be wrong is tested with no model anywhere near it. This is what the `LLMClient` interface buys.
- **Handler**: turn cap, per-IP limit, spend ceiling, malformed round-tripped state.
- **`<GuideAgent>`**: render tests, and the fallback swap on each failure condition in section 13.

Separate, costs money, not in the push path:

- **An extraction eval** against the real model on a small fixture set. "Phoenix" resolves to `zone: 9b`. "it's on my balcony" resolves to `indoor: false`. "pretty dry in here" declines to invent a humidity number. This is the one thing a fake cannot test. Run manually or nightly. A regression here is a prompt problem, not a build failure.

## 15. Amendments to the engine spec

To be applied when `2026-09-03-guided-learning-engine-design.md` is next revised:

1. **Section 16, open question 2 is answered.** `<ContextForm>` is not the primary entry. The agent is, and the form is the fallback.
2. **Section 6, `area.yml`** gains the optional `assistant` block and the optional per-field `ask` hint (section 7 above).
3. **Section 7, conditions.** Make explicit that a condition referencing a *declared but unset* field evaluates false. The engine spec currently states this only for *undeclared* keys, and skipping is a first-class outcome here.
4. **Section 9, modules.** `LLMClient` is a third interface alongside `ContentSource` and `ProgressStore`.
5. **Section 9, validator.** Reports derived question count per path.
6. **Section 12, error handling.** Add the agent clause: agent failures degrade to the form.
7. **Section 14, repo layout.** Add `src/interview/`.

## 16. Build order

The agent is built after the engine core and the React layer, both of which already have implementation plans. It depends on `resolve()`, the content types, and `<PathView>` existing.

1. Engine core (`2026-09-03-pathkit-core.md`), already planned.
2. React layer (`2026-09-04-pathkit-react-layer.md`), already planned.
3. This agent, plus its first use in plant-app.

The plant area is the first and only consumer at this stage. The DJ guide is where freeform mode gets its first real test, and that happens on its own cycle.

## 17. Open questions for implementation planning

- Which rate-limit mechanism on Vercel. Per-IP in-memory does not survive across serverless instances, so this needs a decision between a hosted KV, a header-based approach, or accepting weaker limits behind the spend ceiling.
- Whether the confirmation summary in step 4 of section 6 is inline-editable or sends the reader back into the conversation to correct a value.
- Where `logUnanswered` writes in plant-app. Supabase is already present, but a table for this is a schema change that needs its own migration.
- Whether the agent's entry point on a guide page is a persistent control or appears only after scroll.
