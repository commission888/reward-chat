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

## Deployment

Both frontends deploy through **Vercel's Git integration** — two Vercel projects from the one repo (`commission888/reward-chat`), each with a different Root Directory (`merchant-app` / `customer-liff`). A push to `origin/main` auto-triggers build + deploy; there is no manual deploy step.
- customer-liff → https://rewardchat-liff.vercel.app
- merchant-app → https://reward-chat-merchant-app-seven.vercel.app

So **a frontend-only change ships by just committing and pushing** — no separate command, and nothing to touch on the Supabase side. Env vars live in each Vercel project's dashboard (the `.env.production` files are gitignored), not in git.

Backend (migrations + edge functions) does **not** ride along on a git push — it's deployed to the remote Supabase project (ref `kjfsmkcpzocerzazntvv`) via the Supabase MCP tools (`apply_migration`, `deploy_edge_function`). Only reach for those when a change actually involves a migration or an edge function; pure React/Vite edits never need them. Redeploying `line-webhook` must always pass `verify_jwt=false` explicitly (see Edge Functions below).

## Multi-tenancy & RLS — the pattern every table follows

Tenant isolation is `shop_id`-scoped Postgres RLS. Three security-definer helper functions in `0002_profiles_shops.sql` are the *only* sanctioned way a policy may look up the caller's role/shop:

```
current_profile() -> (role, shop_id)
is_super_admin() -> boolean
my_shop_id() -> uuid
```

**Every RLS policy must call these, never a direct subquery on `profiles`.** A policy *on* `profiles` that subqueries `profiles` directly self-references and Postgres throws `42P17 infinite recursion detected in policy` — this is the single most common way to break this schema.

### Migration traps this schema keeps setting

Three that have each cost real time here — the first two bit twice in one session:

- **`create or replace function` cannot change a return type** (`42P13`), and `returns table (...)` counts: adding one column to the returned row trips it. You must `drop function` first.
- **`drop function` silently discards the function's grants.** So any migration that drops-and-recreates has to restate them, and for SECURITY DEFINER functions that isn't housekeeping — Postgres' default is `GRANT EXECUTE TO PUBLIC`, so forgetting the `revoke` hands an anon key the ability to spend points or mint them. `0009`/`0010` exist because that exact default made `apply_points_system` and `match_document_chunks` anon-callable. **`create or replace` also resets the ACL**, so restate revokes/grants there too.
- **A migration applying cleanly proves nothing about a plpgsql body.** `0015`'s `create_redemption` installed fine and then failed on every call with `42702 column reference "id" is ambiguous`: `returns table (id, code, status, ...)` puts those names in scope as variables, so a bare `where id = ...` is ambiguous, and Postgres only resolves it at *call* time. Alias every table and qualify every column in these functions — and exercise the RPC against the database after applying, not just check that the migration succeeded.

RLS only restricts *which rows* a query can touch. Table-level `GRANT`s (in `0007_grants.sql`) are what restrict *which columns/operations* are allowed at all — Supabase does not grant SELECT/INSERT/UPDATE/DELETE by default for CLI-created tables. The recurring security pattern in this codebase: sensitive columns get a **column-scoped GRANT**, not a blanket one — e.g. `customers.points_balance` and `profiles.role`/`shop_id` are excluded from the client-facing UPDATE grant entirely, because their only legitimate writer is a security-definer RPC (`apply_points`, `apply_points_system`) that keeps an audit ledger. When adding a new sensitive column, follow this pattern rather than granting blanket UPDATE.

## Points ledger — never write `points_balance` directly

`customers.points_balance` is a denormalized cache; `points_transactions` is the source of truth. Four RPCs are the *only* legitimate writers, each for a different trust boundary:
- `apply_points(customer_id, delta, reason)` — staff/admin-initiated, called directly from `CustomerDetailPage`'s manual adjustment. Requires a real staff/admin JWT; locks the row and validates shop ownership.
- `apply_points_system(customer_id, delta, reason)` — system-initiated (currently only the Slip2Go auto-credit flow in `line-webhook`). No caller-role check by design (the caller is service_role with no `auth.uid()`), so `EXECUTE` is granted to `service_role` only, never `authenticated`.
- `complete_redemption(redemption_id)` — staff approving a reward redemption (see Rewards below).
- `claim_point_grant(token, customer_id)` — a customer scanning a points QR (see Points QR below).

Never add a code path that updates `customers.points_balance` outside these four functions.

## Customers are not Supabase Auth users

There's no Supabase Auth provider for LINE. Customer identity is established one of two ways, both edge-function-mediated (never trust a client-supplied LINE user ID directly):
1. **LIFF registration** (`register-customer`): verifies a LINE `id_token` against LINE's `/oauth2/v2.1/verify` endpoint before trusting the `sub` claim as `line_user_id`.
2. **LINE webhook** (`line-webhook`): the webhook's own HMAC signature check on the raw request body *is* the trust boundary — a signature-verified event's `source.userId` is trusted directly, and `handleSlipImage` will auto-create a `customers` row from it if one doesn't exist yet.

Everything from `customer-liff` goes through Edge Functions with the anon key, never direct authenticated table writes — there is no Postgres JWT for "this LINE user."

## customer-liff runtime entry contract — it only works opened from LINE

`customer-liff/src/lib/liffIdentity.ts`'s `resolveLineIdentity()` reads **both `shop_id` and `liff_id` from the URL query string** (`?shop_id=...&liff_id=...`) and throws if either is missing — there is no production fallback (the `VITE_DEV_*` env defaults are dev-only, and prod builds ship with `VITE_LIFF_MOCK=false`). So opening the deployed URL directly shows "Missing shop_id" *by design*; the app is only reachable through a shop's LIFF link. **The LIFF app's Endpoint URL configured in the LINE console must therefore carry both params**, e.g. `https://<liff-host>/?shop_id=<shop uuid>&liff_id=<that app's LIFF id>` — the shop_id scopes the app to a tenant, and liff_id is what `liff.init()` needs. A shop's LINE credentials (`line_channel_id`/`secret`/`access_token`) and `liff_id` are written via `update-shop-line-settings`, which is `requireAdmin`-gated: **only that shop's own `admin` can set them — a super_admin cannot** (they aren't scoped to a shop, so `requireAdmin` rejects them). The `merchant-app` LINE-settings UI (`routes/LineSettingsPage.tsx`) also surfaces the ready-made webhook URL to paste into the LINE channel.

## Loyalty QR cards

`loyalty_cards.qr_token` is a signed HS256 JWT (hand-rolled on Web Crypto in `_shared/jwt-qr.ts`, not a library — payload is just `{cid, sid, iat}`, no expiry by design so the card stays stable across app opens). It is **the customer's identity token**, not a points instrument: since a LINE customer has no Supabase JWT, every customer-facing edge function (`get-rewards`, `create-redemption`, `update-customer-phone`, `claim-point-grant`) proves who is calling by verifying it. Because there's no expiry, **every one of those functions must also check the token against the customer's current card row** (`revoked_at is null` and the presented token string matches the stored `qr_token`) — a valid signature alone only proves the token was issued by us *at some point*, not that it's still current.

## Points QR — the shop issues, the customer scans (`0012_point_grants.sql`)

Points flow the opposite way from what you might assume: staff do **not** scan the customer's card. Staff pick 1–10 points on `/scan` ("Give points"), which mints a `point_grants` row and renders a QR the customer scans with LINE *or* a plain camera app.

That inversion moves the secret from the customer's phone onto a screen at the counter, where anyone nearby can photograph it — so **the grant token is the entire security boundary**. Hence: it's a 122-bit `crypto.randomUUID()` (never a short human-readable code like `redemptions.code`, which is staff-matched rather than secret), it expires in 5 minutes, and it is single-use. `claim_point_grant(token, customer_id)` enforces all of it under a `FOR UPDATE` lock — the `claimed_at is null` guard is the single-use defense, exactly as `complete_redemption`'s `pending` guard is its double-redeem defense. `EXECUTE` is `service_role`-only **with explicit `revoke ... from public/anon/authenticated`**, since Postgres' default `GRANT EXECUTE TO PUBLIC` would otherwise leave it anon-callable. The guards are pinned in `supabase/tests/point_grants.sql`; run `npx supabase test db` after touching any of this.

One deliberate asymmetry: the same customer re-claiming their own grant returns the original result instead of raising, because the customer app auto-claims on load and a refresh must not look like a failure. A *different* customer hitting a claimed grant is a hard error.

The QR encodes `https://liff.line.me/{liff_id}?grant={token}`, which hands off to the LINE app from any scanner. **LINE does not forward that query param directly** — it wraps it in `liff.state` and the SDK re-redirects to the endpoint URL with the params merged, so `grant` is only readable *after* `liff.init()` resolves. Combined with `liff.login()` dropping custom params on the OAuth return, `grant` can be missing on any given load, so `liffIdentity.ts` stashes it in `localStorage` (like `shop_id`/`liff_id`) and clears it after any claim attempt — a token that outlives its claim would re-fire on the next ordinary card open and show a bogus "expired" error.

## Rewards & redemptions (`0011_rewards_redemptions.sql`)

Customers redeem points for rewards; the deduction is a staff-approved, ledger-backed operation — never a client-side balance write. Two tables: `rewards` (per-shop catalog: `name`, `description`, `points_cost`, `active`) and `redemptions` (a coupon: **snapshots** `reward_name`/`points_cost` at creation so later edits/deletes of the reward don't change history, plus a short human-readable `code`, `status` in `pending`/`completed`/`cancelled`, and `staff_user_id`).

**Redeeming is a purchase and it is final.** Tapping redeem spends the points immediately and hands back a coupon that lives **one month**; the coupon is the receipt. There is no refund and no reject — an unwanted or forgotten coupon just expires, and the points stay spent. (This settled after two reversals: 0011 deducted only at staff approval, `0015` moved the deduction to redeem time and made reject a refund as the honest consequence, then `0017`/`0018` removed reject entirely on the shop's call. The customer never writes the balance in any version — `create_redemption` is SECURITY DEFINER + `service_role`-only, reached via `create-redemption` once the loyalty token proves identity. Only the *when* ever moved.)
- `create_redemption(customer_id, reward_id, code)` — locks the customer row, validates the reward, enforces the shop's `redeem_threshold` **and** the balance, deducts through the ledger (reason `redeem:<name>`, `staff_user_id` null since no staff member did this — it renders as "system" in the history), and inserts the `pending` coupon with `expires_at = now() + 1 month`, all in one transaction. The balance check is authoritative, not advisory: two fast taps can't both pass it.
- `complete_redemption(p_redemption_id)` — staff/admin-approve, meaning only "we handed it over". Moves no points. Guards: `FOR UPDATE`, `status='pending'`, and **not past `expires_at`**.

**Expiry is computed, never stored.** No job sweeps anything: an expired coupon is still `status='pending'` in the table, and `expires_at` is checked at the point of use — `complete_redemption` refuses it, and both apps derive "expired" from the clock (`isExpired()` in `useRewards.ts` / `RedemptionsPage`). Same shape as `point_grants`. Don't add an `'expired'` status or pg_cron; do keep the DB check, since the UI's disabled button is only a courtesy. The `status` constraint still needs `'cancelled'` for rows retired by 0015.

Guards are pinned in `supabase/tests/redemptions.sql` — run `npx supabase test db` after touching any of this.

`complete_redemption` is granted to `authenticated` only (anon-unreachable); `create_redemption` to `service_role` only. Rewards are admin-managed directly via RLS-gated table writes (no edge function needed); redemptions are client-**read-only** (the only writers are those RPCs). Merchant UI: `RewardsPage` (admin CRUD + the redeem threshold) + `RedemptionsPage` (admin/staff pending list → Approve only); customer UI: the rewards catalog + coupon view live in `customer-liff`'s `CardPage` via `customer/useRewards.ts`.

## Edge Functions (`supabase/functions/`)

All use `_shared/supabaseClients.ts`'s two client constructors: `createCallerClient(authHeader)` (respects the caller's RLS — use this whenever the caller's own identity/role should gate the operation) vs `createServiceClient()` (bypasses RLS — only after the function has done its own authorization check). Authorization gates live in `_shared/requireAdmin.ts`, all throwing `AuthzError` (catch it in the outer try/catch to translate to the right HTTP status) — extend these rather than re-implementing the role check inline:
- `requireAdmin(caller)` — "is this caller a shop admin" (returns the caller's own `shop_id`); used by single-shop admin writes.
- `requireShopMember(caller)` — "does this caller work at some shop" (admin *or* staff). For counter-facing functions where staff are the primary users and `requireAdmin` would lock them out.
- `requireSuperAdmin(caller)` — "is this caller the platform super_admin"; used by cross-tenant functions. A super_admin isn't scoped to a shop, so the target `shop_id`/`user_id` is supplied in the body and **the function must validate it** (e.g. the shop exists; the target profile's `role` really is `'admin'`) — never take a role or a privileged target on trust from the body.

- `register-customer` — LIFF registration/re-registration; issues/returns the QR card. Has a `REGISTER_CUSTOMER_DEV_BYPASS_TOKEN` local-dev escape hatch (never set that secret on a deployed project — it disables LINE identity verification entirely).
- `create-point-grant` — staff/admin mints a points QR (`requireShopMember`-gated: staff are this page's main users, so `requireAdmin` would lock them out). Points are range-checked 1–10 server-side and the shop comes from the caller's own profile, never the body.
- `claim-point-grant` — the customer redeems that QR. Two tokens with different jobs: `qr_token` says *who* is claiming, `grant` says *what*. Every real check (single-use, expiry, shop match) lives in the RPC where the row lock makes them atomic — doing any of it in the function would reopen the race the lock closes.
- `get-rewards`, `create-redemption`, `update-customer-phone` — `verify_jwt=true` but invoked with the anon key; the caller is a customer with no JWT, so **identity is proven by the signed loyalty `qr_token` in the body** (verified + matched against the current card row — see Loyalty QR cards above), not by auth. `get-rewards` returns the shop's active rewards, the caller's own redemptions (with `expires_at`) and the shop's `redeem_threshold`. `create-redemption` does the card check and then hands everything else — reward validity, threshold, balance, deduction, coupon row — to the `create_redemption` RPC, which does it all under one row lock; **don't move any of those checks back into the function**, splitting them reopens the double-spend the lock closes. `update-customer-phone` exists because **LINE Login has no phone scope**: `customers.phone` can only ever be filled by the customer typing it into the LIFF card, so there is no "pull it from LINE" option to reach for.
- `create-staff-user`, `update-shop-line-settings`, `update-shop-payment-settings`, `update-shop-points-settings`, `update-shop-ai-settings` — `requireAdmin`-gated writes that RLS itself won't allow directly (`profiles`/`shops` columns are locked down), so these are the sanctioned write path; each forces the target `shop_id` to the caller's own shop server-side. **`update-shop-points-settings` must read-modify-write `points_config`**, never assign a fresh object: it's one shared jsonb bag also holding `points_per_baht`/`points_per_slip`, and overwriting it would silently stop slips earning anything.
- `create-shop-admin`, `update-shop-admin`, `delete-shop-admin`, `delete-shop` — `requireSuperAdmin`-gated, cross-tenant. They manage shops and shop-owner (`role='admin'`) accounts through the Auth admin API (`service.auth.admin.createUser/updateUserById/deleteUser`), since `admin`/`super_admin` roles and login credentials live in `auth.users` and can't be minted via a table write. Two invariants: **role is hardcoded server-side** (`create-shop-admin` always writes `'admin'`, never a body-supplied role, or a caller could mint a super_admin), and **mutations target only `role='admin'` rows** (`update-`/`delete-shop-admin` re-read the target and reject anything else, so the endpoint can't be turned against the super_admin itself or a staff row). `update-shop-admin` writes the email/password to `auth.users` **and** mirrors email/`full_name` into `profiles` (the columns the merchant UI reads aren't synced from `auth.users` automatically). Deleting an auth user cascades its `profiles` row via `profiles.id -> auth.users on delete cascade`. The super_admin "Manage admins" UI lives in `merchant-app/src/components/ShopAdminsDialog.tsx` (opened from `ShopsPage`), which lists a shop's admins by querying `profiles` directly (super_admin has RLS full access + SELECT grant).
- `ingest-file` — receives already-extracted plain text (see RAG note below) from an upload, chunks it, embeds via OpenAI, writes `document_chunks`.
- `line-webhook` — one deployment, routes by `shop_id` in the URL path (`/line-webhook/{shop_id}`, since each shop has its own LINE OA channel using this shared function). Must stay `verify_jwt = false` (LINE's POST carries no Supabase JWT) — the *only* function that should be. **The MCP deploy tool defaults `verify_jwt` to true, so every redeploy of this one must pass `false` explicitly**; getting it wrong 401s all LINE traffic, and it looks identical to a signature rejection from the outside. Tell them apart by the body: `{"error":"Invalid signature"}` means our code ran and the deploy is fine. Handles two message types: `text` → RAG chat reply (`handleMessage`), `image` → Slip2Go payment-slip verification (`handleSlipImage`, only runs if the shop has `slip2go_api_secret` configured). Returns `200` to LINE immediately and does the slow work (OpenAI calls / Slip2Go round-trip) via `EdgeRuntime.waitUntil()`, since LINE's reply token expires quickly; falls back to the push API if the reply token has expired by the time work finishes.

Three things about `line-webhook`'s replies that aren't obvious from the code:
- **`handleMessage`'s catch only logs.** Anything that throws inside it leaves the customer staring at silence — worse than a wrong answer, and invisible unless you're reading `chat_logs`. That's why a shop with no OpenAI key short-circuits to the canned reply instead of letting `createEmbedding` throw.
- **Replies match the customer's language, decided from their own text** (`noMatchReply`'s `THAI_CHARACTER` test — Thai has its own Unicode block, so one character is a reliable tell). LINE sends no locale on a message event, so there is nothing else to go on. Webhook prose never goes through `t()` — that lives in the browser, and the language picked here is the *customer's*, unrelated to the language the merchant reads their dashboard in. The wording itself is a per-shop setting; see Bot reply wording below.
- **A verified slip replies with a Flex card** (`line-webhook/slipCard.ts`): amount, points earned, balance, progress toward `redeem_threshold`, and a button to `https://liff.line.me/{liff_id}` (omitted entirely when the shop has no `liff_id`, rather than linking to `liff.line.me/null`). Points are credited *before* the reply is sent, so a card that fails to render must never mean the customer hears nothing: `replyCard` degrades reply-flex → push-flex → plain text, and the `altText` carries the real news so it works as a message on its own.

## AI is per-shop, provider-choosable — OpenAI or Gemini (`0014`, `0021_shop_ai_provider.sql`)

There is no platform AI secret: **each shop supplies its own key** and now also **picks its provider** (`shops.ai_provider` in `openai`/`gemini`, default `openai`), set by that shop's admin on `/settings/ai` via `update-shop-ai-settings`. Each provider's key is its own column (`openai_api_key`, `gemini_api_key`) so switching doesn't lose the other; Gemini exists because its free tier lets a shop run the chatbot at no cost. Every AI call goes through **`_shared/ai.ts`** (`createEmbedding`/`createEmbeddings`/`createChatReply`/`checkAiKey`, all taking `(…, provider, key)`), which dispatches to `_shared/openai.ts` or `_shared/gemini.ts` — callers (`ingest-file`, `line-webhook`) never import a provider module directly. Keys are stored plaintext, following `slip2go_api_secret`; `shops` is RLS-scoped to its own members and every select against it names columns explicitly, so **keep it that way** — a `select("*")` on `shops` in a customer-facing function would hand both keys out.

Things worth knowing before touching this:
- **A shop with no key for its active provider must degrade, never throw.** In `line-webhook`, `createEmbedding` is the first call in `handleMessage`, whose catch only logs — so throwing there means the customer gets *silence*. It short-circuits to the canned no-answer reply instead. `ingest-file` fails the file with a provider-aware "set your {provider} key first" message rather than a 500. Slip verification never touches AI and keeps working regardless.
- **Both providers must embed at 1536 dims, and the model/provider is not freely swappable per query.** Every vector in `document_chunks` must be comparable *within a shop*, and the column + `match_document_chunks()` are typed `vector(1536)`. OpenAI `text-embedding-3-small` is 1536; Gemini `gemini-embedding-001` is requested at `outputDimensionality: 1536` (and L2-normalized). `match_document_chunks` filters by `shop_id`, so cross-shop/cross-provider comparability never matters — but a shop's **ingest and query embeddings must use the same provider**. Hence **switching provider invalidates that shop's chunks**: `update-shop-ai-settings` deletes `document_chunks` and flags the completed `files` as `failed` ("re-upload") on a provider change, so retrieval never silently returns stale vectors. Changing only the *key* within a provider is still safe (same model → same vectors, no re-ingest).
- **The embedding model within a provider is still fixed** (`text-embedding-3-small` / `gemini-embedding-001`). Changing a provider's model would silently make its existing chunks unfindable, exactly as before.

`update-shop-ai-settings` test-calls the chosen provider (`checkAiKey`) before storing a key, so a typo'd/expired key or an unpaid OpenAI account is rejected at entry rather than surfacing days later as a mysteriously silent bot. The key field is write-only in the UI: leaving it blank on save **keeps** the stored key (letting a shop switch back to an already-configured provider without re-typing), and a provider with no stored key can't be activated.

**The chatbot has an on/off switch independent of the key** (`shops.ai_chat_enabled`, default true, `0022`): a shop that only wants automatic slip-crediting turns it off, and `line-webhook` then `continue`s past the text branch (no reply) while the image/slip branch keeps crediting points — the gate is `shop.ai_chat_enabled === false`, so a null/absent flag still answers. The `/settings/ai` toggle saves through the same `update-shop-ai-settings`, which has a **toggle-only path** (`{ ai_chat_enabled }` with no `ai_provider`) that flips the flag *without* requiring a configured key or running the provider-switch chunk-wipe.

`update-shop-ai-settings` test-calls OpenAI before storing a key, so a typo'd or expired one is rejected at the point of entry rather than surfacing days later as a mysteriously silent bot.

## Bot reply wording is a per-shop setting (`0019_shop_reply_templates.sql`)

The canned sentences the LINE bot sends — "I don't have that information", and every slip-rejection message — are rewritable by each shop's admin on `/settings/ai`. `shops.reply_templates` is a **sparse** jsonb bag of overrides: a key is present only for a sentence the shop actually rewrote, and `resolveReplyTemplate(templates, key)` falls back to the system default in `_shared/replyTemplates.ts`. **The defaults live in code and are never seeded into the column** — seeding would freeze today's wording into every shop's row and make "the shop chose this" indistinguishable from "the shop never touched it".

- **A blank override means reset, never mute.** `resolveReplyTemplate` treats `""`/whitespace as absent, and `update-shop-reply-templates` deletes the key rather than storing `""`. This isn't tidiness: an empty reply throws at the LINE API, and in `handleMessage` that lands in the log-only catch — the customer would hear *nothing*.
- **It is its own edge function, and must stay that way.** `update-shop-ai-settings` writes `openai_api_key` unconditionally from its body, and the key field is write-only (always submitted blank). Folding templates into it would mean every "save my reply text" silently cleared the shop's OpenAI key.
- **`chat.no_answer` is a th/en pair; the slip messages are single strings.** Not an oversight — a text message carries the customer's own words to detect a language from, and a slip is an *image* that carries none. A shop serving English customers rewrites the slip strings in English.
- **Only standalone sentences are configurable, never the slip Flex card** (`slipCard.ts`). Every line of that card labels or interpolates a number, so exposing it would mean handing shops `{points}`-style placeholders to type correctly — one typo ships a literal `{points}` to a customer. Keep that boundary.
- **`_shared/replyTemplates.ts` and `packages/shared/src/replyTemplates.ts` are hand-kept mirrors.** Edge functions run on Deno and can't import the npm workspace, and reaching outside `supabase/functions` breaks the deploy bundle — so change one, change the other. The edge copy is what customers actually read; the shared copy only feeds the merchant form's grey placeholders, so drift shows up as a stale placeholder rather than a wrong reply.

`describeSlip2GoCode` has **no `200000` branch**: its only caller reaches it exclusively on codes *outside* `SLIP_SUCCESS_CODES` (`200000`/`200200`), so the "ตรวจสอบสลิปสำเร็จ" string it used to carry was unreachable — a verified slip gets the Flex receipt instead.

## RAG knowledge base — parsing happens client-side, not in the edge function

`.docx`/`.xlsx` files are parsed to plain text **in the browser** (`merchant-app/src/lib/extractText.ts`, using `mammoth` and `exceljs`) before being uploaded — `ingest-file` receives already-extracted text, not the raw file. This is deliberate: those libraries' zip/inflate internals are unverified in Supabase's constrained Deno edge runtime.

**Grounding comes from the system prompt, not from a distance threshold — do not add one back.** `line-webhook` takes the nearest `MATCH_COUNT` chunks and hands all of them to the model; "use ONLY the context, say you don't have it otherwise" is what stops hallucinated shop-specific answers, and the model is good at it. The canned reply now fires only when a shop has **zero** chunks.

There used to be a `MATCH_DISTANCE_THRESHOLD` and it made the bot useless. Measured against a real shop document and a real question: `"เปิดกี่โมง"` scored **0.787** against the chunk containing `"เวลาทำการ: 09.00 - 17.00 น."` and **0.773** against an article about changing car tyres — the answer ranked *worse than an unrelated document*. Cosine distance on short Thai queries carries almost no signal (~0.007 between relevant and irrelevant), so no cut-off separates them; 0.5 and then 0.65 both rejected everything. Handed those same chunks, the model answered `"เปิดกี่โมง"` and `"มีที่จอดรถไหม"` correctly and declined `"ขายไอโฟนราคาเท่าไหร่"` on its own — all three of which the filter had been throwing away. The embeddings are fine (a natural paraphrase scored 0.543); the *mechanism* couldn't use them.

Two known-but-unfixed issues in `ingest-file`'s `chunkText`, measured as **not** the cause of the above (a focused chunk scored 0.766 vs the blob's 0.787 — no meaningful difference): it does `words.join(" ")`, which flattens every newline out of the stored chunk, and it splits on `/\s+/`, which is meaningless for Thai — 663 characters of Thai count as "51 words", so a whole document becomes one chunk. Harmless at current sizes; a real problem for any large Thai document.

## Payment-slip verification (Slip2Go)

Optional per-shop feature (`shops.slip2go_api_secret`). A shop lists the accounts a slip may be paid to in `shops.slip_receivers` — a jsonb **array** (0020, replacing the single `slip_receiver_account_*` columns), each element `{account_type, account_number, account_name_th?, account_name_en?}`. `account_type` is a Slip2Go code: a bank code (`01004` = KBANK …), **`03000` for a merchant/KShop account** (K+ Shop, แม่มณี, Be Merchant), or `04000` (TrueMoney). These become Slip2Go's `checkReceiver` array, which matches if **any** entry matches, so a shop taking payment to several accounts lists them all and a slip to any one credits. If the array is **empty**, Slip2Go only confirms a slip is *genuine*, not that it was paid *to that shop* — any real slip (even one paid to someone else) will be accepted; the Payment Settings page surfaces this as an explicit warning (don't remove it). **KShop/merchant slips carry no bank account number** — the receiver comes back as bank `000 (อื่นๆ)` and the value to match on is the **Merchant ID** Slip2Go returns as `data.ref1` (e.g. `KB000002209056`), entered as `account_number` under type `03000`; empirically confirmed (see the `slip2go-kshop-receiver-matching` memory). Idempotency (a slip can't be credited twice) is enforced at the DB level via a unique constraint on `slip_verifications(shop_id, trans_ref)`, not just Slip2Go's own `checkDuplicate` flag (which is scoped to Slip2Go's account, not ours).

The merchant UI (`routes/PaymentSettingsPage.tsx`) writes the array through `update-shop-payment-settings` (which drops empty rows and rejects a row missing type-or-number). Each receiver row's account-type dropdown groups **merchant/e-wallet types** (`03000`/`04000`, `lib/thaiBanks.ts` `MERCHANT_ACCOUNT_TYPES`) above the banks (`THAI_BANKS`), and the number field relabels itself to "Merchant ID" for a merchant type. Because a merchant account has no number to hand-copy, there's an **"Upload shop QR"** button (`lib/thaiQr.ts`): it decodes the shop's Thai-QR-Payment merchant standee image **in the browser** with `jsQR` and pulls the Merchant ID + shop name straight out of the EMVCo TLV payload (the merchant account-info templates, tags 30/31). Two shapes are handled, both verified against live CNX Haircutz standees: **KShop** (KBANK) whose Merchant ID is `KB…`+digits — scanned out of any sub-field so a layout shuffle can't break it — and **numeric merchant IDs** (SCB **แม่มณี** = `014000008431058`, Be Merchant, …) read specifically from **sub-tag 02** of a Thai-QR merchant template, since sub-01 (the acquirer/biller ID) is the same length and indistinguishable by shape. KShop is preferred when both are present; personal PromptPay (tag 29) is never read, so its national ID can't be mistaken for a merchant ID. Both map to type `03000` per the code table above — but only KShop's `ref1` match is empirically confirmed; **a แม่มณี slip's Slip2Go `ref1` still needs one live confirmation**. jsQR silently fails on a full-res phone photo, so `decodeQrFromFile` downscales through several capped widths (1000→500) and returns the first that decodes — don't feed jsQR the original.

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
