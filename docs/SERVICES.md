# Services setup

Oct 29, 2026 · companion to `IMPLEMENTATION.md`

Every external account Made Of touches, with the fields you'll need to copy
into env vars, and the phase that first needs each one. Set up a service only
when its phase arrives — nothing on this list is needed before Phase 1
finishes except Railway and Cloudflare.

## At a glance

| Service | First used in | Paid? | Env vars |
| --- | --- | --- | --- |
| Railway (Postgres, bucket, web service, PR previews) | Phase 1 | Paid once past free credit | `DATABASE_URL`, `BUCKET_*` (phase 2) |
| Cloudflare (CDN, bot protection, origin lock) | Phase 1 | Free | `ORIGIN_LOCK_SECRET`, `CF_API_TOKEN` (phase 2) |
| GitHub (repo, Actions CI, Remotion renders) | Phase 1 | Free | — |
| Resend (magic-link email, newsletter) | Phase 4 | Free tier fine to start | `RESEND_API_KEY`, `RESEND_FROM` |
| Google OAuth (sign-in) | Phase 4 | Free | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Apple Sign-In | Phase 4 | $99/yr Apple Developer | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |
| Stripe (payments, portal) | Phase 4 | Fees per charge | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FAMILY_MONTHLY`, `STRIPE_PRICE_FAMILY_YEARLY` |
| PostHog (analytics, replays, flags) | Phase 4 | Free tier generous | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY` (server flags) |
| Anthropic Claude API (content drafting) | Phase 5 | Pay as you go | `ANTHROPIC_API_KEY` |
| Text-to-speech (ElevenLabs or similar) | Phase 6 | Pay as you go | `TTS_API_KEY`, `TTS_VOICE_ID` |
| Buffer (schedule to TikTok, Reels, YouTube) | Phase 6 | Paid plan | `BUFFER_ACCESS_TOKEN` |

Confirm before signing up for any paid service (CLAUDE.md working rule).

## Phase 1 and 2 — the minimum to ship

### Railway

You already have an account. Create one project called `made-of` and inside it:

1. **Postgres plugin.** Add it from the project dashboard. Copy
   `DATABASE_URL` from the plugin's Variables tab into the web service's
   variables.
2. **Web service.** Create a service, point it at this GitHub repo, and set
   the builder to Dockerfile (Railway autodetects the one in the repo root).
   Add `DATABASE_URL` and `ORIGIN_LOCK_SECRET` as variables. Expose port 3000.
3. **Health check.** Set the service's health-check path to `/api/health`.
4. **PR environments.** Enable "Preview environments" on the service so each
   pull request builds against an ephemeral Postgres. Open a PR to prove it.
5. **No volume.** Do not attach a volume to the web service. All state must
   live in Postgres or the bucket, so deploys have no downtime and replicas
   stay possible (Railway docs: volumes block replicas).
6. **Storage bucket.** Add a bucket plugin and keep it private. You won't need
   it until phase 6 (Remotion uploads), so you can skip until then if you'd
   rather minimise the bill, but creating it now costs nothing. Copy the
   S3-compatible credentials into the web service as
   `BUCKET_ENDPOINT`, `BUCKET_REGION`, `BUCKET_NAME`, `BUCKET_ACCESS_KEY_ID`,
   `BUCKET_SECRET_ACCESS_KEY`.

### Cloudflare

Needed for caching, bot protection, and the origin lock that stops bots
hitting the Railway `*.up.railway.app` URL directly.

1. **Create a free account** at cloudflare.com if you don't have one.
2. **Add your domain.** Change the nameservers at your registrar to the two
   Cloudflare gives you. DNS propagation can take an hour.
3. **CNAME to Railway.** Add a proxied (orange cloud) CNAME from your apex
   (e.g. `madeof.app`) to the Railway domain. Add Railway's custom domain
   under the web service's Settings → Networking so it issues a cert.
4. **Transform Rule (origin lock).** Rules → Transform Rules → Modify Request
   Header. On all requests to your zone, add header
   `x-origin-lock: <secret>` where `<secret>` matches `ORIGIN_LOCK_SECRET` in
   Railway. Phase 1 middleware rejects anything missing this header except in
   development.
5. **Bot Fight Mode.** Security → Bots → turn on "Bot Fight Mode" (free tier).
6. **Firewall rules (phase 2).** Create a WAF rule that blocks known scraper
   user agents and data-centre ASNs on `/api/*` paths only, not on item
   pages (so search crawlers still work). The implementation guide's
   anti-scraping section has the policy.
7. **Cache rules (phase 3).** Cache `/`, item pages, `/sitemap.xml`,
   `/llms.txt` and `GET /api/daily` for a few minutes. Keep everything under
   `/api/*` otherwise bypassed. Add a Cache Rule rather than Page Rules — the
   new API has 10 free slots and is more flexible.
8. **API token (phase 2+, for publish-time purges).** My Profile → API Tokens
   → Create Token. Permissions: `Zone.Cache Purge: Edit` on your zone only.
   Copy to `CF_API_TOKEN` and record the `CF_ZONE_ID` from the zone overview.

### GitHub

1. Push this repo to GitHub.
2. The CI workflow added in phase 1 runs lint, typecheck and tests on every
   PR using GitHub's free runners.
3. Phase 6 adds a Remotion render job that runs in GitHub Actions on manual
   dispatch and uploads MP4s to the Railway bucket.

## Phase 3 — nothing new

The frontend port uses only Railway and Cloudflare. The Open Graph image per
item page is rendered on-demand by Next's `ImageResponse`, no external
service.

## Phase 4 — accounts, payments, analytics

### Resend

Transactional email (magic links) and the weekly newsletter.

1. Sign up at resend.com (free tier covers early use).
2. Verify your sending domain. Add the DKIM and MX records Resend shows into
   Cloudflare DNS; propagation is usually minutes.
3. API Keys → Create API Key with sending permission. Copy to
   `RESEND_API_KEY`.
4. Pick a from address like `no-reply@madeof.app`. Set `RESEND_FROM`.

### Google OAuth

1. Google Cloud Console → create a project `made-of`.
2. APIs & Services → OAuth consent screen. User type **External**. Add
   `email`, `profile`, `openid` scopes. Add yourself as a test user until you
   publish.
3. Credentials → Create credentials → OAuth client ID → Web application.
   Authorised redirect URIs: `https://madeof.app/api/auth/callback/google` and
   `http://localhost:3000/api/auth/callback/google`.
4. Copy to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Apple Sign-In

Requires an Apple Developer account ($99/year).

1. developer.apple.com → Certificates, Identifiers & Profiles.
2. Identifiers → Services ID. Create one like `app.madeof.auth`. Enable
   Sign In with Apple. Add return URL
   `https://madeof.app/api/auth/callback/apple`.
3. Keys → Create a new key. Enable Sign In with Apple. Download the `.p8`
   file (you only get one chance). Note the Key ID.
4. Record your Team ID (top right of the developer portal).
5. Env vars: `APPLE_CLIENT_ID` is the Services ID; `APPLE_TEAM_ID`,
   `APPLE_KEY_ID`; `APPLE_PRIVATE_KEY` is the contents of the `.p8` file.

### Stripe

1. Sign up at stripe.com. Switch to **Test mode** while developing; keep live
   mode secrets elsewhere.
2. Products → create a product `Made Of Family` with two prices: monthly and
   yearly. Note the price IDs (`price_...`). These go into
   `STRIPE_PRICE_FAMILY_MONTHLY` and `STRIPE_PRICE_FAMILY_YEARLY`.
3. Developers → API keys. Copy the test publishable key to
   `STRIPE_PUBLISHABLE_KEY` and the test secret to `STRIPE_SECRET_KEY`.
4. Developers → Webhooks → Add endpoint. URL
   `https://madeof.app/api/stripe/webhook`. Events: `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.paid`,
   `invoice.payment_failed`. Copy the signing secret to
   `STRIPE_WEBHOOK_SECRET`.
5. For local webhook testing, install the Stripe CLI and run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
6. Enable the Customer Portal in Settings → Billing → Customer portal.
   Allow plan changes, payment-method updates and cancellation.

### PostHog

1. Sign up at posthog.com (EU cloud if you want data in the EU).
2. Project settings → Project API key → copy to `NEXT_PUBLIC_POSTHOG_KEY`.
   Set `NEXT_PUBLIC_POSTHOG_HOST` to `https://eu.posthog.com` (or
   `https://us.posthog.com`).
3. Create a personal API key for the server (feature flags, server events):
   `POSTHOG_PERSONAL_API_KEY`.
4. Replays: enable in Project settings, with masking turned on. Phase 4 code
   restricts replays to signed-in adults with inputs masked.
5. Dashboards: the launch plan lists the four you want on day one (Daily
   funnel, new-visitor activation, weekly retention, paywall funnel).

## Phase 5 — content pipeline

### Anthropic Claude API

For drafting items, recipes and daily puzzle candidates. The admin review
queue is the only path from draft to live.

1. console.anthropic.com → sign up, add a payment method.
2. API keys → create one for `made-of`. Copy to `ANTHROPIC_API_KEY`.
3. Set per-key spending limits so a bug can't run away. $20/month is plenty
   while drafting a few items a day.

## Phase 6 — video catalogue

### Text-to-speech

Pick one; swap later if you want. The pipeline only needs
`POST /synthesize(text) → mp3`.

Recommended: ElevenLabs. Sign up, pick a voice, note the voice ID, create an
API key. Env: `TTS_API_KEY`, `TTS_VOICE_ID`.

Alternatives: PlayHT, OpenAI TTS, Azure Speech. Keep the integration behind a
small adapter so this stays swappable.

### Buffer

Buffer posts to TikTok, Instagram Reels and YouTube Shorts from one API call.

1. publish.buffer.com → upgrade to a paid plan that includes the social
   channels you want. The free plan does not include scheduling by API.
2. Connect each channel in Buffer and confirm Buffer can post to it manually
   first.
3. developers.buffer.com → create an app → copy the access token to
   `BUFFER_ACCESS_TOKEN`.
4. The scheduler calls Buffer's GraphQL API with a video URL (presigned from
   the bucket) and a caption.

### Remotion

No account needed — Remotion runs locally and in GitHub Actions. Phase 6 adds
a `videos/` package that renders 9:16 MP4s from a chain. You only need
`ffmpeg` on the render machine; GitHub Actions runners have it already.

## Local development checklist

Run through this once:

- [ ] `.env` filled from `.env.example`, with a local Postgres running
- [ ] `npm install && npm run db:migrate && npm run db:seed`
- [ ] `npm run dev` boots on http://localhost:3000
- [ ] `/api/health` returns `{"ok":true}`
- [ ] The round-trip test passes: `npm test`

The origin-lock middleware is bypassed when `NODE_ENV !== "production"` so
you don't need to set `ORIGIN_LOCK_SECRET` locally.
