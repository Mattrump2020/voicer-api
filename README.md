# Voicer AI — Backend API

Audio dataset collection platform. Express + TypeScript + Drizzle ORM + Supabase (Postgres + Storage).

Live deployment: `https://voicer-api-jwer.onrender.com`
Swagger docs: `https://voicer-api-jwer.onrender.com/docs`

---

## Stack

| Layer         | Technology                          |
|---------------|--------------------------------------|
| Runtime       | Node.js + TypeScript                 |
| Framework     | Express.js                           |
| ORM           | Drizzle ORM                          |
| Database      | PostgreSQL (via Supabase)            |
| File storage  | Supabase Storage (private bucket)    |
| Auth          | JWT (jsonwebtoken + bcryptjs)         |
| Email         | Resend                               |
| Validation    | Joi                                  |
| Docs          | Swagger UI / OpenAPI 3.0             |
| Hosting       | Render                               |

---

## Project structure

```
src/
├── index.ts                       Express app entry point
├── config/
│   └── swagger.ts                 OpenAPI spec setup
├── db/
│   ├── index.ts                   Drizzle connection
│   ├── schema.ts                  All tables, enums, relations, inferred types
│   └── seeds/
│       └── languages.seed.ts      Seeds the languages table
├── middleware/
│   ├── auth.middleware.ts         JWT verify + role checks
│   └── validate.middleware.ts     Joi schemas for every route
├── modules/
│   ├── auth/                      register, login, verify, reset, dev tools
│   ├── organizations/             org CRUD, transfer ownership, dashboard
│   ├── projects/                  project CRUD, archive, dashboard
│   ├── members/                   invite, accept, role change, remove
│   ├── languages/                 language list, user proficiency
│   ├── tasks/                     task CRUD, contributor task matching
│   ├── submissions/                2-step audio upload, submission history
│   ├── reviews/                   review queue, approve/reject
│   ├── notifications/             in-app notifications
│   └── exports/                   CSV / JSON / ZIP dataset export
└── utils/
    ├── audit.ts                   Audit log writer
    ├── email.ts                   Resend email templates
    ├── logger.ts                  Winston logger
    ├── response.ts                Standard API response helpers
    └── supabase.ts                Signed URLs, storage upload/delete
```

---

## 1. Setup — Supabase

1. Go to **supabase.com** → New project → set name, password, region
2. **Settings → API** → copy:
   - Project URL → `SUPABASE_URL`
   - anon public key → `SUPABASE_ANON_KEY`
   - service_role secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose)
3. **Settings → Database → Connection string → URI** → copy → `DATABASE_URL`
4. **Storage → New bucket** → name it `voicer-audio` → toggle **Private** → Create

## 2. Setup — Resend (email)

1. **resend.com** → sign up (free, 100 emails/day)
2. **API Keys → Create** → copy → `RESEND_API_KEY`
3. Use `EMAIL_FROM=Voicer AI <onboarding@resend.dev>` until you verify a custom domain

## 3. Setup — JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output into `JWT_SECRET`.

## 4. Install and run locally

```bash
npm install
cp .env.example .env
# fill in .env with values from steps 1–3

npm run db:generate   # generates migration SQL from schema.ts
npm run db:migrate    # applies it to your Supabase database
npm run db:seed       # seeds the languages table

npm run dev           # starts on http://localhost:3000
```

You should see:
```
🚀  Voicer API  → http://localhost:3000
📖  Swagger UI  → http://localhost:3000/docs
💚  Health      → http://localhost:3000/health
🌍  Mode        → development
```

## 5. Deploy to Render

1. Push to GitHub
2. Render → New → Web Service → connect repo
3. Build command: `npm install && npm run build`
4. Start command: `node dist/index.js`
5. Add all `.env` variables under **Environment**, plus set `NODE_ENV=production`
6. Deploy — Render auto-redeploys on every push to `main`

---

## Dev mode vs Production mode

`NODE_ENV` controls a few important behaviors:

| Behavior | Development (`NODE_ENV≠production`) | Production (`NODE_ENV=production`) |
|---|---|---|
| Registration | Auto-verified immediately, no email sent | Real verification email sent via Resend |
| `POST /auth/dev/force-verify` | Works — manually verify any account | Returns 404, hidden entirely |
| Password reset token | Logged to console for convenience | Only sent via email |

This means in dev you never get blocked by email delivery — every account is usable immediately after registering.

---

## Full test procedure — step by step

Test in this exact order. Each step tells you what to save for later steps.

### Step 1 — Register
```
POST /api/v1/auth/register
```
```json
{
  "firstName": "Isaac",
  "lastName": "Sulaimon",
  "email": "isaac@gmail.com",
  "password": "securepass123"
}
```
**Dev mode:** account is immediately verified — skip to Step 2.
**Production:** check your email for the verification link, or call:
```
GET /api/v1/auth/verify-email?token=TOKEN_FROM_EMAIL
```

If an account is stuck unverified in dev, fix it with:
```
POST /api/v1/auth/dev/force-verify
```
```json
{ "email": "isaac@gmail.com" }
```

---

### Step 2 — Login
```
POST /api/v1/auth/login
```
```json
{
  "email": "isaac@gmail.com",
  "password": "securepass123"
}
```
**Save `data.token`.** Every request from here needs:
```
Authorization: Bearer <token>
```

---

### Step 3 — Confirm auth works
```
GET /api/v1/auth/me
```
No body. Confirms the token is valid and returns your profile.

---

### Step 4 — Get language IDs
```
GET /api/v1/languages
```
No auth needed, no body. **Save the UUIDs for Yoruba and English** — used in steps 5, 7, and 10.

---

### Step 5 — Set your language proficiencies
```
POST /api/v1/languages/user
```
```json
{
  "languages": [
    { "languageId": "UUID_FOR_YORUBA",  "proficiency": "NATIVE"   },
    { "languageId": "UUID_FOR_ENGLISH", "proficiency": "ADVANCED" }
  ]
}
```
`proficiency`: `BASIC` | `INTERMEDIATE` | `ADVANCED` | `NATIVE`

---

### Step 6 — Create an organization
```
POST /api/v1/organizations
```
```json
{
  "name": "Nithub Lagos",
  "description": "Innovation hub for African language AI",
  "country": "Nigeria",
  "organizationType": "Research Institution"
}
```
**Save `data.organizationId`.**

---

### Step 7 — Create a project
```
POST /api/v1/projects
```
```json
{
  "organizationId": "ORG_UUID_FROM_STEP_6",
  "name": "Yoruba Speech Dataset",
  "description": "Collecting native Yoruba recordings for ASR training",
  "languages": ["UUID_FOR_YORUBA", "UUID_FOR_ENGLISH"],
  "startDate": "2026-07-01",
  "endDate": "2026-12-31"
}
```
**Save `data.projectId`.**

---

### Step 8 — Invite a contributor
```
POST /api/v1/members/invite
```
```json
{
  "projectId": "PROJECT_UUID_FROM_STEP_7",
  "email": "contributor@gmail.com",
  "role": "CONTRIBUTOR"
}
```
`role`: `PROJECT_ADMIN` | `CONTRIBUTOR` | `REVIEWER`

**How the magic link works:**
1. This generates a random 64-char token, saves it to the `invitations` table with a 72-hour expiry
2. An email is sent to `contributor@gmail.com` with a link: `{CLIENT_URL}/accept-invitation?token=xxx`
3. The invited person must **already have a registered + logged-in account** using that exact email
4. They call `POST /members/accept-invitation` with the token — the API checks their logged-in email matches the invitation email before adding them to the project

---

### Step 9 — Invite a reviewer
```
POST /api/v1/members/invite
```
```json
{
  "projectId": "PROJECT_UUID_FROM_STEP_7",
  "email": "reviewer@gmail.com",
  "role": "REVIEWER"
}
```

---

### Step 10 — Accept invitation (as the invited user, logged in as them)
```
POST /api/v1/members/accept-invitation
```
```json
{ "token": "TOKEN_FROM_INVITATION_EMAIL" }
```
⚠️ The logged-in user's email must exactly match the invitation's email, or this returns 403.

---

### Step 11 — Confirm membership
```
GET /api/v1/members/projects/PROJECT_UUID
```
No body. Shows accepted members and any still-pending invitations.

---

### Step 12 — Create a task
```
POST /api/v1/tasks
```
```json
{
  "projectId": "PROJECT_UUID_FROM_STEP_7",
  "title": "Read the Yoruba Market Scene",
  "description": "A narrative paragraph set in a Lagos market",
  "instructions": "Speak clearly at natural pace. Do not rush.",
  "languageId": "UUID_FOR_YORUBA",
  "taskType": "READ_PROMPT",
  "targetDuration": 30
}
```
`taskType`: `READ_PROMPT` | `SPONTANEOUS_SPEECH` | `GUIDED_CONVERSATION`
**Save `data.id`** as TASK_UUID.

---

### Step 13 — Contributor browses available tasks
```
GET /api/v1/tasks/contributor/available?projectId=PROJECT_UUID
```
No body. Returns only tasks matching the contributor's language proficiencies (must be logged in as the contributor).

---

### Step 14 — Get a signed upload URL
```
POST /api/v1/submissions/upload-url
```
```json
{
  "taskId": "TASK_UUID_FROM_STEP_12",
  "fileName": "recording.webm",
  "mimeType": "audio/webm"
}
```
Response: `{ uploadUrl, storagePath }` — **save both.**

---

### Step 15 — Upload the actual audio file
Use the `uploadUrl` from Step 14 directly — this is a Supabase URL, not your API.

In Postman:
- Method: `PUT`
- URL: paste `uploadUrl` exactly
- Body → Binary → select your audio file
- Header: `Content-Type: audio/webm`

This uploads straight to Supabase Storage. The file never touches your Express server.

---

### Step 16 — Create the submission record
```
POST /api/v1/submissions
```
```json
{
  "taskId": "TASK_UUID_FROM_STEP_12",
  "storagePath": "STORAGE_PATH_FROM_STEP_14",
  "languageId": "UUID_FOR_YORUBA",
  "audioDuration": 28,
  "fileSize": 204800
}
```
**Save `data.submissionId`.**

---

### Step 17 — Fetch the submission (with playable signed URL)
```
GET /api/v1/submissions/SUBMISSION_UUID
```
No body. Returns `audioUrl` — a signed URL valid 1 hour, paste it in a browser to play the audio.

---

### Step 18 — Reviewer checks their queue
```
GET /api/v1/reviews/queue?projectId=PROJECT_UUID
```
No body (must be logged in as the reviewer). Returns pending submissions matching the reviewer's languages.

---

### Step 19 — Approve or reject
```
POST /api/v1/reviews
```
Approve:
```json
{
  "submissionId": "SUBMISSION_UUID_FROM_STEP_16",
  "rating": "GOOD",
  "status": "APPROVED",
  "feedback": "Clear audio, natural pacing. Well done."
}
```
Reject (feedback required):
```json
{
  "submissionId": "SUBMISSION_UUID_FROM_STEP_16",
  "rating": "POOR",
  "status": "REJECTED",
  "feedback": "Too much background noise. Please re-record in a quieter room."
}
```
`rating`: `EXCELLENT` | `GOOD` | `FAIR` | `POOR` — `POOR` always forces rejection.

---

### Step 20 — Check notifications (as the contributor)
```
GET /api/v1/notifications?unreadOnly=true
```
No body. Should show the review result notification.

```
PATCH /api/v1/notifications/read-all
```
No body — marks everything read.

---

### Step 21 — Start a dataset export
```
POST /api/v1/exports
```
```json
{
  "projectId": "PROJECT_UUID_FROM_STEP_7",
  "format": "ZIP",
  "approvedOnly": true,
  "languageId": "UUID_FOR_YORUBA",
  "startDate": "2026-07-01",
  "endDate": "2026-12-31"
}
```
`format`: `CSV` | `JSON` | `ZIP`. Returns `data.exportId` immediately — the export processes in the background.

---

### Step 22 — Poll export status
```
GET /api/v1/exports/EXPORT_UUID
```
No body. Keep calling until `data.status === "READY"`.

---

### Step 23 — Download the export
```
GET /api/v1/exports/EXPORT_UUID/download
```
No body. Returns `data.downloadUrl` — a signed URL valid 10 minutes.

---

### Step 24 — Password reset flow (independent test)
```
POST /api/v1/auth/forgot-password
```
```json
{ "email": "isaac@gmail.com" }
```
In dev mode, the token is printed to your server logs. In production, check your email.

```
POST /api/v1/auth/reset-password
```
```json
{
  "token": "TOKEN_FROM_LOGS_OR_EMAIL",
  "password": "mynewpassword456"
}
```

---

## Testing in Swagger UI

Open `/docs` in your browser.

1. Run `POST /auth/login` from within Swagger UI
2. Copy `data.token` from the response
3. Click the green **Authorize** button (top right)
4. Type: `Bearer <token>` → Authorize → Close
5. All subsequent Swagger requests now include your JWT automatically (`persistAuthorization: true` keeps it across refreshes)

To import into Postman instead: Import → Link → paste `https://your-api-url/docs.json`

---

## RBAC summary

| Action              | Org Owner | Project Admin | Contributor | Reviewer |
|---------------------|:---------:|:--------------:|:------------:|:--------:|
| Create project      | ✅        | ❌              | ❌            | ❌        |
| Delete/archive project | ✅     | ❌              | ❌            | ❌        |
| Invite members      | ✅        | ✅              | ❌            | ❌        |
| Create tasks        | ✅        | ✅              | ❌            | ❌        |
| Submit recordings   | ❌        | ❌              | ✅            | ❌        |
| Review recordings   | ❌        | ❌              | ❌            | ✅        |
| Export dataset       | ✅        | ✅              | ❌            | ❌        |

---

## Is this everything for the whole project?

This covers the full backend as scoped in the PRD:

**✅ Fully implemented**
- Auth (register, login, verify, forgot/reset password, profile)
- Organizations (CRUD, transfer ownership, dashboard)
- Projects (CRUD, archive, dashboard, language linking)
- Members (invite via magic link, accept, role change, remove)
- Languages (list, user proficiency matching)
- Tasks (CRUD, contributor language-matched feed)
- Submissions (2-step signed-URL upload via Supabase, history)
- Reviews (language-filtered queue, approve/reject, mandatory rejection feedback)
- Notifications (in-app, mark read)
- Dataset export (CSV/JSON/ZIP, async processing, signed download)
- Audit logging on every major action
- Swagger/OpenAPI documentation

**⚠️ Known gaps (not in this build — flagged earlier, still open)**
- No pagination on list endpoints (fine at current scale, will matter as data grows)
- Export processing runs inline in the same process rather than a dedicated job queue (Bull/BullMQ) — acceptable for MVP traffic, not for large datasets
- No automated tests
- No unregistered-user invitation flow — the invited person must register and log in themselves before accepting; there's no combined "register + auto-accept" endpoint

Everything else described in the PRD's backend scope is implemented and working end-to-end.
