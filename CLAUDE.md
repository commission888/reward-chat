# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RewardChat: a multi-tenant loyalty + AI chatbot platform for shops (coffee shops, salons, etc.). Each shop runs its own digital loyalty program (QR loyalty cards, point accumulation/deduction, automatic payment-slip verification) and its own LINE chatbot that answers customer questions grounded in documents the shop uploads, and can auto-credit points when a customer sends a payment slip photo in chat.

npm workspaces monorepo:
- `merchant-app/` — React+Vite admin dashboard for `super_admin` (platform), `admin` (shop owner), `staff` (points scanner)
- `customer-liff/` — React+Vite LINE LIFF app for customers (loyalty card + QR)
- `packages/shared/` — generated DB types, cross-app constants, Tailwind theme tokens, `getFunctionErrorMessage` helper. No business logic lives here by design.
- `supabase/` — Postgres migrations, Edge Functions (Deno), seed data, pgTAP tests

## Commands

Local dev requires Docker Desktop running (Supabase local stack) and needs **3 processes running in parallel** in separate terminals:

```bash
npx supabase start                                          # Postgres + Auth + Storage + Studio
npx supabase functions serve --env-file supabase/.env.local  # Edge Functions (needed for login, scanning, registration — almost everything)
npm run dev:merchant   # or dev:liff
```

Other commands:
```bash
npm install                              # from repo root — installs all workspaces
npm run build --workspace=merchant-app   # or customer-liff; runs `tsc -b && vite build`
npm run lint --workspace=merchant-app    # eslint
npx supabase db reset                    # reapplies all migrations + seed.sql from scratch
npx supabase gen types typescript --local > packages/shared/src/database.types.ts
                                          # ALWAYS redirect only stdout (not 2>&1) — the CLI's stderr banner
                                          # text gets written into the file otherwise and breaks the build
npx supabase test db                     # runs supabase/tests/*.sql via pgTAP
```

Seeded local accounts (password `password123` for all): `superadmin@demo.local`, `admin@demo.local`, `staff@demo.local` — all belong to "Demo Coffee Shop" (`11111111-1111-1111-1111-111111111111`).

There is no JS/TS test runner configured in either app — correctness is verified through the pgTAP suite plus manual/Playwright-driven browser checks; there's no `npm test`.

## Multi-tenancy & RLS — the pattern every table follows

Tenant isolation is `shop_id`-scoped Postgres RLS. Three security-definer helper functions in `0002_profiles_shops.sql` are the *only* sanctioned way a policy may look up the caller's role/shop:

```
current_profile() -> (role, shop_id)
is_super_admin() -> boolean
my_shop_id() -> uuid
```

**Every RLS policy must call these, never a direct subquery on `profiles`.** A policy *on* `profiles` that subqueries `profiles` directly self-references and Postgres throws `42P17 infinite recursion detected in policy` — this is the single most common way to break this schema.

RLS only restricts *which rows* a query can touch. Table-level `GRANT`s (in `0007_grants.sql`) are what restrict *which columns/operations* are allowed at all — Supabase does not grant SELECT/INSERT/UPDATE/DELETE by default for CLI-created tables. The recurring security pattern in this codebase: sensitive columns get a **column-scoped GRANT**, not a blanket one — e.g. `customers.points_balance` and `profiles.role`/`shop_id` are excluded from the client-facing UPDATE grant entirely, because their only legitimate writer is a security-definer RPC (`apply_points`, `apply_points_system`) that keeps an audit ledger. When adding a new sensitive column, follow this pattern rather than granting blanket UPDATE.

## Points ledger — never write `points_balance` directly

`customers.points_balance` is a denormalized cache; `points_transactions` is the source of truth. There are two RPCs that are the *only* legitimate writers, and they exist for different trust boundaries:
- `apply_points(customer_id, delta, reason)` — staff/admin-initiated (via `/scan` in merchant-app, called through the `apply-points` Edge Function). Requires a real staff/admin JWT; locks the row and validates shop ownership.
- `apply_points_system(customer_id, delta, reason)` — system-initiated (currently only the Slip2Go auto-credit flow in `line-webhook`). No caller-role check by design (the caller is service_role with no `auth.uid()`), so `EXECUTE` is granted to `service_role` only, never `authenticated`.

Never add a code path that updates `customers.points_balance` outside these two functions.

## Customers are not Supabase Auth users

There's no Supabase Auth provider for LINE. Customer identity is established one of two ways, both edge-function-mediated (never trust a client-supplied LINE user ID directly):
1. **LIFF registration** (`register-customer`): verifies a LINE `id_token` against LINE's `/oauth2/v2.1/verify` endpoint before trusting the `sub` claim as `line_user_id`.
2. **LINE webhook** (`line-webhook`): the webhook's own HMAC signature check on the raw request body *is* the trust boundary — a signature-verified event's `source.userId` is trusted directly, and `handleSlipImage` will auto-create a `customers` row from it if one doesn't exist yet.

Everything from `customer-liff` goes through Edge Functions with the anon key, never direct authenticated table writes — there is no Postgres JWT for "this LINE user."

## customer-liff runtime entry contract — it only works opened from LINE

`customer-liff/src/lib/liffIdentity.ts`'s `resolveLineIdentity()` reads **both `shop_id` and `liff_id` from the URL query string** (`?shop_id=...&liff_id=...`) and throws if either is missing — there is no production fallback (the `VITE_DEV_*` env defaults are dev-only, and prod builds ship with `VITE_LIFF_MOCK=false`). So opening the deployed URL directly shows "Missing shop_id" *by design*; the app is only reachable through a shop's LIFF link. **The LIFF app's Endpoint URL configured in the LINE console must therefore carry both params**, e.g. `https://<liff-host>/?shop_id=<shop uuid>&liff_id=<that app's LIFF id>` — the shop_id scopes the app to a tenant, and liff_id is what `liff.init()` needs. A shop's LINE credentials (`line_channel_id`/`secret`/`access_token`) and `liff_id` are written via `update-shop-line-settings`, which is `requireAdmin`-gated: **only that shop's own `admin` can set them — a super_admin cannot** (they aren't scoped to a shop, so `requireAdmin` rejects them). The `merchant-app` LINE-settings UI (`routes/LineSettingsPage.tsx`) also surfaces the ready-made webhook URL to paste into the LINE channel.

## Loyalty QR cards

`loyalty_cards.qr_token` is a signed HS256 JWT (hand-rolled on Web Crypto in `_shared/jwt-qr.ts`, not a library — payload is just `{cid, sid, iat}`, no expiry by design so the card stays stable across app opens). Because there's no expiry, **`apply-points` must check the token against the customer's current card row** (`revoked_at is null` and the presented token string matches the stored `qr_token`) before crediting — a valid signature alone only proves the token was issued by us *at some point*, not that it's still current.

## Rewards & redemptions (`0011_rewards_redemptions.sql`)

Customers redeem points for rewards; the deduction is a staff-approved, ledger-backed operation — never a client-side balance write. Two tables: `rewards` (per-shop catalog: `name`, `description`, `points_cost`, `active`) and `redemptions` (a coupon: **snapshots** `reward_name`/`points_cost` at creation so later edits/deletes of the reward don't change history, plus a short human-readable `code`, `status` in `pending`/`completed`/`cancelled`, and `staff_user_id`).

The trust model mirrors the points ledger: because customers have no Supabase JWT, the point deduction happens **only when staff approve**, through a SECURITY DEFINER RPC, never at redemption-request time.
- `complete_redemption(p_redemption_id)` — staff/admin-approve. Locks the redemption `FOR UPDATE`, requires `status='pending'` (this guard is the double-redeem defense — a second approval finds it non-pending and aborts), then deducts the **snapshotted** `points_cost` through the points ledger (writes a `points_transactions` row, reason `redeem:<name>`, attributes `staff_user_id`) and sets `status='completed'`. This is a third legitimate writer of `points_balance` alongside `apply_points`/`apply_points_system` — and like them, it goes through the ledger, never a bare UPDATE.
- `cancel_redemption(p_redemption_id)` — staff-reject; same `pending` guard, sets `status='cancelled'`, deducts nothing.

Both are granted to `authenticated` only (anon-unreachable). Rewards are admin-managed directly via RLS-gated table writes (no edge function needed); redemptions are client-**read-only** (the only writers are the two RPCs + `create-redemption`). Merchant UI: `RewardsPage` (admin CRUD) + `RedemptionsPage` (admin/staff pending-approval list → Approve/Reject); customer UI: the rewards catalog + coupon view live in `customer-liff`'s `CardPage` via `customer/useRewards.ts`.

## Edge Functions (`supabase/functions/`)

All use `_shared/supabaseClients.ts`'s two client constructors: `createCallerClient(authHeader)` (respects the caller's RLS — use this whenever the caller's own identity/role should gate the operation) vs `createServiceClient()` (bypasses RLS — only after the function has done its own authorization check). Admin-only functions share `_shared/requireAdmin.ts`'s two authorization gates, both throwing `AuthzError` (catch it in the outer try/catch to translate to the right HTTP status) — extend these rather than re-implementing the role check inline:
- `requireAdmin(caller)` — "is this caller a shop admin" (returns the caller's own `shop_id`); used by single-shop admin writes.
- `requireSuperAdmin(caller)` — "is this caller the platform super_admin"; used by cross-tenant functions. A super_admin isn't scoped to a shop, so the target `shop_id`/`user_id` is supplied in the body and **the function must validate it** (e.g. the shop exists; the target profile's `role` really is `'admin'`) — never take a role or a privileged target on trust from the body.

- `register-customer` — LIFF registration/re-registration; issues/returns the QR card. Has a `REGISTER_CUSTOMER_DEV_BYPASS_TOKEN` local-dev escape hatch (never set that secret on a deployed project — it disables LINE identity verification entirely).
- `apply-points` — staff scans a QR, verifies+matches the card, calls `apply_points`.
- `get-rewards`, `create-redemption` — `verify_jwt=true` but invoked with the anon key; the caller is a customer with no JWT, so **identity is proven by the signed loyalty `qr_token` in the body** (verified + matched against the current card row, same contract as `apply-points`), not by auth. `get-rewards` returns the shop's active rewards + the caller's own redemptions; `create-redemption` validates the reward (active, same shop), does a *soft* balance check (the real check is at staff approval), and inserts a `pending` redemption with a generated coupon `code`. Neither deducts points — see the Rewards section above.
- `create-staff-user`, `update-shop-line-settings`, `update-shop-payment-settings` — `requireAdmin`-gated writes that RLS itself won't allow directly (`profiles`/`shops` columns are locked down), so these are the sanctioned write path; each forces the target `shop_id` to the caller's own shop server-side.
- `create-shop-admin`, `update-shop-admin`, `delete-shop-admin`, `delete-shop` — `requireSuperAdmin`-gated, cross-tenant. They manage shops and shop-owner (`role='admin'`) accounts through the Auth admin API (`service.auth.admin.createUser/updateUserById/deleteUser`), since `admin`/`super_admin` roles and login credentials live in `auth.users` and can't be minted via a table write. Two invariants: **role is hardcoded server-side** (`create-shop-admin` always writes `'admin'`, never a body-supplied role, or a caller could mint a super_admin), and **mutations target only `role='admin'` rows** (`update-`/`delete-shop-admin` re-read the target and reject anything else, so the endpoint can't be turned against the super_admin itself or a staff row). `update-shop-admin` writes the email/password to `auth.users` **and** mirrors email/`full_name` into `profiles` (the columns the merchant UI reads aren't synced from `auth.users` automatically). Deleting an auth user cascades its `profiles` row via `profiles.id -> auth.users on delete cascade`. The super_admin "Manage admins" UI lives in `merchant-app/src/components/ShopAdminsDialog.tsx` (opened from `ShopsPage`), which lists a shop's admins by querying `profiles` directly (super_admin has RLS full access + SELECT grant).
- `ingest-file` — receives already-extracted plain text (see RAG note below) from an upload, chunks it, embeds via OpenAI, writes `document_chunks`.
- `line-webhook` — one deployment, routes by `shop_id` in the URL path (`/line-webhook/{shop_id}`, since each shop has its own LINE OA channel using this shared function). Must stay `verify_jwt = false` in `supabase/config.toml` (LINE's POST carries no Supabase JWT) — but that's the *only* function that should be. Handles two message types: `text` → RAG chat reply (`handleMessage`), `image` → Slip2Go payment-slip verification (`handleSlipImage`, only runs if the shop has `slip2go_api_secret` configured). Returns `200` to LINE immediately and does the slow work (OpenAI calls / Slip2Go round-trip) via `EdgeRuntime.waitUntil()`, since LINE's reply token expires quickly; falls back to the push API if the reply token has expired by the time work finishes.

## RAG knowledge base — parsing happens client-side, not in the edge function

`.docx`/`.xlsx` files are parsed to plain text **in the browser** (`merchant-app/src/lib/extractText.ts`, using `mammoth` and `exceljs`) before being uploaded — `ingest-file` receives already-extracted text, not the raw file. This is deliberate: those libraries' zip/inflate internals are unverified in Supabase's constrained Deno edge runtime. Chat replies are strictly grounded — `line-webhook` refuses to answer (canned reply) rather than fall back to the model's general knowledge when no document chunk clears the cosine-distance threshold, to avoid hallucinated shop-specific answers.

## Payment-slip verification (Slip2Go)

Optional per-shop feature (`shops.slip2go_api_secret`). If a shop hasn't set a receiver bank account (`slip_receiver_account_*` columns), Slip2Go only confirms a slip is *genuine*, not that it was paid *to that shop* — any real slip (even one paid to someone else) will be accepted. The merchant-app Payment Settings page surfaces this as an explicit warning; don't remove it if touching that page. Idempotency (a slip can't be credited twice) is enforced at the DB level via a unique constraint on `slip_verifications(shop_id, trans_ref)`, not just Slip2Go's own `checkDuplicate` flag (which is scoped to Slip2Go's account, not ours).

## Frontend conventions

- shadcn/ui components are copy-in (`src/components/ui/*`), not an npm dependency — re-run `npx shadcn@latest add <component>` from within the specific app directory to add more.
- Theme: Primary Blue `#007AFF` / White / Off-white background `#F8FAFC`, defined as CSS variables in each app's `src/index.css` (`@theme inline` block). Single theme only, no dark mode.
- Font: **Kanit**, self-hosted via the `@fontsource/kanit` npm package — never a Google Fonts CDN `<link>` (the LIFF webview shouldn't depend on an external host, and it keeps local dev offline-capable). Kanit is a *static* family, so each weight is a separate `@import` at the top of `src/index.css`: 400/500/600/700, matching the `font-medium`/`font-semibold`/`font-bold` utilities actually in use — importing only the bare package pulls weight 400 alone and the rest silently render as faux-bold. Its `thai` subset is why it's the choice here (default language is Thai); `--font-sans` in `@theme inline` is the single lever, and `--font-heading` already aliases it.
- Edge Function errors: always use `getFunctionErrorMessage(error)` from `@rewardchat/shared` before showing an error to the user — `supabase-js`'s `FunctionsHttpError.message` is hardcoded to a generic "non-2xx status code" string; the real error body is on `error.context` (a `Response`), which that helper parses.
- Both apps' `vite.config.ts` and `tsconfig*.json` define the `@/*` → `./src/*` path alias.
- Base type size is bumped at the root (`html { font-size }` in each app's `index.css`, responsive via a media query) so everything sized in rem scales together — prefer adjusting that lever over hardcoding larger font sizes per component. The merchant `AppShell` is responsive: a fixed sidebar on `lg+`, collapsing to a top bar + slide-in drawer (single `useState` boolean, closes on navigate) below it; shadcn `Table` already wraps itself in `overflow-x-auto`, so wide tables scroll rather than break the layout.

## i18n — every user-facing string goes through `t()`

Both apps have their own lightweight i18n (no library): `src/i18n/translations.ts` (a `Record<Lang, Record<string, string>>` keyed by dot-namespaced keys like `nav.dashboard`), `src/i18n/LanguageProvider.tsx` (context + `useI18n()` returning `{ lang, setLang, t }`), and a `LanguageToggle` component. `t(key, params?)` looks up the current language, does `{param}` interpolation, and falls back **English → the key itself** so a missing translation degrades visibly, never blank. Language is persisted to `localStorage["rc_lang"]` (shared key name, but the two apps are separate origins so they don't collide), default **Thai**.

The invariant: **the only files containing literal UI prose are the two `translations.ts` dictionaries.** When adding or changing any visible string (including `toast`/`throw new Error` messages that reach the user, `placeholder`/`aria-label`, and empty-state text), add a key to *both* `en` and `th` and render it via `t()` — don't hardcode. Module-level constants can't call `useI18n()`, so store a key string there and resolve it with `t()` inside render (see `AppShell`'s `NAV_BY_ROLE`, whose items carry `labelKey`). Deliberately **not** translated: values that come from the DB (customer/shop/reward names, `role`, and short status enums shown in the KB/payment tables) — those are data, not chrome — and server-provided error messages surfaced via `getFunctionErrorMessage` (only the *fallback* string passed to it is translated). A quick completeness check after touching strings: grep each app's `src` for Thai characters (and obvious English JSX prose) outside `translations.ts`; every hit is a missed string.
