# Engage X Operating System — self-hosted (Vercel + Supabase)

This is a self-hostable version of the Engage X business operating system. It no
longer depends on claude.ai — it runs as a normal website, with its data stored in
your own [Supabase](https://supabase.com) project (free to start) and hosted on
[Vercel](https://vercel.com) (free to start).

**How the pieces fit together:**

- **Vercel** hosts the webpage (`index.html`) and one small serverless function
  (`api/ai.js`) that proxies AI requests. Vercel does **not** store your data.
- **Supabase** is where your actual data lives — employees, clients, tasks,
  invoices, everything. It's a real Postgres database, plus file storage for
  uploads (QR codes, payment proof images), plus realtime sync so changes show up
  live for everyone with the page open.
- **Anthropic API** (optional) powers the AI Advisor, AI lead scoring, and AI
  proposal drafting. If you skip this, those three features turn themselves off
  gracefully — everything else works normally.

Nothing here is pre-filled with your credentials — you create your own free
Supabase project and plug its URL/key into `config.js` yourself in step 2 below.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project** (the free tier is
   enough to start).
2. Once it's created, open **SQL Editor** → **New query**, paste in the entire
   contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.
   This creates every table the app needs, turns on realtime sync, creates a
   public `assets` storage bucket for uploads, and locks every table down so
   only a **signed-in** user can read or write anything (see "How sign-in
   works" below).
3. Go to **Project Settings → API** (also called **API Keys** on newer Supabase
   projects). You'll need two values from this page:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon / public key** (a.k.a. "publishable key" — a long string starting
     with `eyJ...` or `sb_publishable_...`)

   These are safe to use in a browser-side config file — the anon key is meant to
   be public and, by itself, grants **no** access to your data; real protection
   comes from (a) the Row Level Security policies `schema.sql` set up, which
   require a signed-in session, and (b) each employee's own password. (Do
   **not** use the "service role" key here — see step 4 below for where that one
   goes instead.)
4. Go to **Authentication → Providers → Email** and turn **off** "Confirm
   email". This is optional, but without it, the very first Super Admin
   signup (step 3 of deploying, below) will need to click a confirmation link
   emailed to them before they can sign in — fine, but one extra step you can
   skip for an internal tool like this. (Teammate logins created later from the
   Employees page are always pre-confirmed automatically, regardless of this
   setting.)
5. Go to **Project Settings → API** and copy the **service_role** key too
   (separate from the anon key above). You'll add this as a Vercel environment
   variable in step 4 of "Deploy to Vercel" below — it's what lets an admin
   create logins for teammates without it ever reaching the browser.

## 2. Point the app at your Supabase project

Open [`config.js`](./config.js) and fill in the two values from step 1:

```js
window.EX_CONFIG = {
  SUPABASE_URL: "https://abcdxyz.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
  STORAGE_BUCKET: "assets",
  AI_ENABLED: true,
};
```

## 3. Deploy to Vercel

**Easiest path (no command line):**
1. Push this folder to a GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new), import that repository, and
   click **Deploy**. Vercel will auto-detect `index.html` as a static site and
   `api/ai.js` as a serverless function — no build configuration needed.

**Or with the Vercel CLI**, from inside this folder:
```bash
npm i -g vercel
vercel        # first deploy, follow the prompts
vercel --prod # promote to your production URL
```

### Enable AI features (optional)

In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com)) |

Redeploy after adding it. Without this variable, the AI Advisor and AI scoring
features show a friendly "AI features are unavailable" message instead of
working — nothing else in the app is affected either way.

### Enable teammate logins (do this one — it's how sign-in works now)

In the same **Settings → Environment Variables** page, also add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the same Project URL from step 1.3 above |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key from step 1.5 above — **never** put this in `config.js` |

Redeploy after adding these. This powers the "Set up login" button on each
employee's profile page (see "How sign-in works" below) — without it, the
Super Admin can still sign themselves in (bootstrap uses a different path),
but can't create logins for anyone else yet.

---

## How sign-in works

Every teammate signs in with their own email and password — a real Supabase
Auth account, not a shared link or a "pick your profile" list. Two ways an
account gets created:

- **The very first Super Admin** creates their own login right on the sign-in
  screen the first time the app loads with no employees yet (name, email,
  password → "Create workspace").
- **Everyone else** gets their login set up by a Super Admin, Ops Head or HR
  teammate: open that person's profile on the **Employees** page → **Set up
  login** → pick a temporary password and share it with them privately. This
  goes through the `api/create-user.js` function and the `SUPABASE_SERVICE_ROLE_KEY`
  above, specifically so that creating someone else's login never signs *you*
  out of your own session.

Forgot a password? There's no self-service reset flow yet — a Super Admin can
delete the person's Supabase Auth user from the Supabase dashboard
(**Authentication → Users**) and use **Set up login** again to issue a new one.

## Is my data actually safe once it's live on Vercel?

Yes, in the sense that it persists reliably — Supabase is a real managed
database, not something that resets or disappears. The Row Level Security
policies in `schema.sql` require a valid Supabase Auth session for every
read and write, so the anon key alone (the one visible in your page source)
gives a stranger no access — they'd need an actual employee's email and
password. One thing still worth doing before real client or financial data
goes in:

### Keep Supabase on a plan that won't pause or lose data

The Supabase **free tier** auto-pauses a project after about a week with no
API traffic (it un-pauses when someone visits, but can take a minute) and
doesn't guarantee backups. Once you're relying on this for real day-to-day
work, upgrade to Supabase's **Pro plan** (~$25/mo) for an always-on project and
daily backups.

## Other suggestions for a neat, smooth setup

- **Custom domain:** point something like `ops.engagexbusiness.com` at your
  Vercel deployment (Vercel → Settings → Domains) instead of using the default
  `*.vercel.app` address.
- **Separate staging vs. production:** Vercel automatically gives every git
  branch its own preview URL, so you can try changes on a branch before merging
  to the branch that deploys to your real production URL.
- **Keep an eye on usage:** Supabase's dashboard shows database size, storage
  size, and API request volume — check it occasionally so you're not surprised
  by a plan limit.
- **Back up before big changes:** Supabase Pro's point-in-time recovery, or at
  minimum, export your tables (Supabase → Table Editor → Export) before any
  bulk edit or schema change.

---

## What changed from the claude.ai version

This is the exact same application — same features, same roles and
permissions, same UI — with one layer swapped out: everywhere the app talked to
claude.ai's built-in `db` / `assets` / `sample` (AI) / `downloads` capabilities,
it now talks to Supabase, a small serverless AI proxy, and the browser's native
file-download mechanism instead. No business logic, screens, or permissions
were changed as part of this move.

Sign-in was also upgraded along the way: the original "pick your profile from
a list" screen (fine for a private claude.ai link, not safe on the open
internet) is now real Supabase Auth — individual email + password per
employee, enforced by the database itself via Row Level Security — see "How
sign-in works" above.

## Project files

```
index.html             the whole application (one file, as before)
config.js              your Supabase URL/key + feature flags — edit this
api/ai.js              Vercel serverless function that proxies AI requests
api/create-user.js     Vercel serverless function that creates teammate logins
                        (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars)
supabase/schema.sql    run this once in your Supabase project's SQL Editor
vercel.json            minor Vercel configuration
package.json           marks this as a Node 18+ project for Vercel
test/                  automated checks used to verify this export — safe to
                       delete before deploying; not required for the app to run
```

## Local preview before deploying

You can sanity-check the page locally once `config.js` points at a real
Supabase project:

```bash
npx serve .
# then open the printed http://localhost:... URL
```

Opening `index.html` directly as a `file://` URL will show the sign-in screen
and basic navigation, but the AI proxy (`/api/ai`) won't work until it's served
over real HTTP (locally via `npx serve`/`vercel dev`, or once deployed).
