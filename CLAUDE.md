# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Purpose

Rare Succulent Inventory (package name `plant-app`): a Next.js 16 App Router + React 19 + TypeScript e-commerce site for rare succulents and cacti. Supabase provides PostgreSQL and Auth (service-role client for server-side ops), Stripe handles checkout with inventory reservation plus a webhook, Shippo supplies shipping rates, Vercel Blob stores images, and an admin portal manages products, orders, customers and shipping. Deployed on Vercel at https://raresucculentinventory.com; every push to `master` auto-deploys. GitHub: https://github.com/jordodrummer/rare-succulent-inventory (default branch `master`).

## Commands

```bash
npm install       # Node 18+, npm
npm run dev       # Next.js dev server at http://localhost:3000
npm run build     # production build
npm run start     # serve the production build
npm run lint      # ESLint 9 flat config (eslint-config-next)
npm run seed      # npx tsx src/lib/db/seed.ts (DESTRUCTIVE: drops and recreates tables)
```

There is no test script or test suite in this repo. Verify with `npm run lint` and `npm run build`. Requires `.env.local` (git-ignored) with the Supabase, Stripe, `ADMIN_EMAIL`, `NEXT_PUBLIC_ADMIN_EMAIL` and `CRON_SECRET` variables; see README "Environment Variables".

## Key paths

- `src/app/` pages and route handlers: `api/checkout`, `api/checkout/cleanup` (Vercel cron every 5 min, see `vercel.json`), `api/webhook/stripe`, `api/orders`, `api/order-items`, `api/plants`, `api/variants`, `api/shipping`, `api/upload`, `admin/*`, `auth/*`, `cart`, `checkout`, `products`
- `src/lib/db/*.ts` typed Supabase query functions; `src/lib/supabase/{server,client,middleware}.ts`; `src/lib/stripe/client.ts`; `src/lib/shipping/*`; `src/lib/types.ts`
- `src/components/` UI, shadcn/ui primitives in `components/ui` (alias `@/*` -> `src/*`)
- `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` design specs; `docs/superpowers/plans/YYYY-MM-DD-<name>.md` implementation plans
- `docs/migrations/*.sql` SQL run by hand in the Supabase SQL editor
- `.superpowers/sdd/<plan>/progress.md` git-ignored SDD ledgers for in-flight plans

## Conventions

- Never use em dashes in code, comments, commit messages, or docs. En dashes are fine.
- Commit subjects: short lowercase imperative, no conventional-commit prefix (e.g. `add shipping rates API endpoint`).
- Branches `feature/<kebab-name>` or `fix/<kebab-name>` from `master`; open a PR into `master`; PRs are squash-merged.
- New features start with a spec in `docs/superpowers/specs/`, then a plan in `docs/superpowers/plans/`, then implementation task by task.
- Server components read through Supabase; mutations go through `src/app/api/*`. Admin-only handlers check `user.email === process.env.ADMIN_EMAIL`.
- TypeScript strict. No Prettier, no git hooks, no CI config in the repo.

## In-progress work (as of 2026-09-19)

Branch `feature/guided-learning-engine`, PR #8 (open, base `master`, docs only). After the 2026-09-19 reorganisation it contains only `docs/pathkit.md` (pointer) and this CLAUDE.md refresh; the guided learning engine specs and the two pathkit plans moved to the pathkit repo (their iteration history stays in this branch's commits).

pathkit code, specs, plans and SDD ledgers live in `/Users/jordanumlauf/projects/pathkit` (github.com/jordodrummer/pathkit); resume pathkit work from there, not here. The 2026-09-08 agent spec has no implementation plan yet. Local dev for the shop: `npm install`, ensure `.env.local` exists, `npm run dev`.

`.claude/settings.local.json` is tracked (unusual) and has local, machine-specific edits: never sweep it into a commit; stage by path. Sibling projects are indexed in /Users/jordanumlauf/projects/README.md.
