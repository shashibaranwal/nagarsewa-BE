# Nagarsewa Backend

Backend API for Nagarsewa, a municipal civic-issue reporting and operations
platform. Citizens submit location-based reports with images, while municipal
staff review, consolidate, assign, prioritize, track, and resolve the resulting
issues.

The service is an Express 5 application backed by MongoDB. It exposes a JSON
REST API, multipart image upload endpoints, Swagger UI, JWT authentication,
ward-scoped staff operations, analytics, and background issue scoring and
automation.

## Contents

- [Features](#features)
- [Technology](#technology)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Run and test](#run-and-test)
- [HTTP API](#http-api)
- [Authentication and authorization](#authentication-and-authorization)
- [Domain model](#domain-model)
- [Report and issue workflow](#report-and-issue-workflow)
- [Matching and scoring](#matching-and-scoring)
- [Background jobs](#background-jobs)
- [Uploads and Cloudinary](#uploads-and-cloudinary)
- [Response and error conventions](#response-and-error-conventions)
- [Operations and maintenance](#operations-and-maintenance)
- [Project structure](#project-structure)
- [Production checklist](#production-checklist)
- [Troubleshooting](#troubleshooting)

## Features

- Citizen registration with KYC document upload and login by email or phone.
- JWT bearer authentication with password hashing using `bcryptjs`.
- Citizen profile updates, password changes, and soft account deactivation.
- Municipal ward and department administration.
- Civic reports with title, description, category, GeoJSON location, and
  Cloudinary-hosted images.
- Automatic report-to-issue matching using geographic proximity and text
  similarity, with optional Gemini-assisted same-problem checks.
- Issue lifecycle management, assignment, deadlines, priorities, escalation,
  event history, duplicate merging, and review queues.
- Ward-scoped access for `ward_admin` users.
- Operational dashboards and aggregate analytics.
- Request rate limiting on expensive issue, analytics, ranking, and event
  endpoints.
- Swagger UI at `/api-docs`.

## Technology

| Area | Implementation |
| --- | --- |
| Runtime | Node.js, ES modules |
| HTTP | Express 5 |
| Database | MongoDB through Mongoose |
| Authentication | JSON Web Tokens (`jsonwebtoken`) |
| Passwords | `bcryptjs` |
| Uploads | `multer` memory storage and Cloudinary |
| Documentation | `swagger-jsdoc`, `swagger-ui-express` |
| Tests | Vitest and Supertest |
| Development | Nodemon |

## Architecture

`server.js` loads environment variables, connects to MongoDB, starts the
schedulers, and listens on the configured port. `src/app.js` creates the
Express application and mounts the route modules.

The request flow is:

1. CORS and JSON/form parsing run in the application middleware.
2. Route-level middleware authenticates the JWT where required.
3. Controllers validate the request and enforce ownership or ward scope.
4. Services perform issue matching, lifecycle changes, transactions, uploads,
   analytics, and other domain operations.
5. Mongoose models persist data in MongoDB.
6. Responses use a `success` boolean and a `data` or `message` property.

There is no separate database migration framework. Data backfills and event
migrations are explicit scripts in `scripts/`; review each script before
running it against production data.

## Requirements

- Node.js 18 or newer (Node.js 20 LTS is recommended).
- npm.
- MongoDB 6+ or a compatible MongoDB service. A replica set is recommended
  because report withdrawal, matching, merging, and event operations may use
  transactions.
- A Cloudinary account for KYC and report images.
- A strong JWT secret.
- A Gemini API key only if Gemini-assisted matching is enabled.

## Quick start

From the repository root:

```bash
npm install
copy .env.example .env
```

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

Edit `.env` and set at least:

```dotenv
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/nagarsewa
JWT_TOKEN=replace-with-a-long-random-secret
JWT_EXPIRES_IN=7d
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Start the development server:

```bash
npm run dev
```

Start it without file watching:

```bash
npm start
```

The API is available at `http://localhost:3000` by default:

- Health check: `GET /`
- Swagger UI: `GET /api-docs`

On first successful database connection, the application ensures that a
default super-admin account exists if no super-admin is already present. The
default seed credentials are defined in `src/utils/seedSuperAdmin.js`; change
the account password immediately in any non-development environment and do not
reuse those credentials.

## Environment variables

Copy `.env.example` to `.env`. Do not commit `.env`; it is ignored by Git.

### Application and database

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | HTTP listening port. |
| `NODE_ENV` | No | — | Runtime environment label. |
| `MONGODB_URI` | Yes | — | MongoDB connection string. Startup exits if connection fails. |
| `JWT_TOKEN` | Yes | — | JWT signing secret. Keep it private and rotate deliberately. |
| `JWT_EXPIRES_IN` | No | `7d` | JWT expiry accepted by `jsonwebtoken`, for example `1d` or `12h`. |

### Cloudinary and uploads

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `CLOUDINARY_CLOUD_NAME` | Yes for uploads | — | Cloudinary cloud name. |
| `CLOUDINARY_API_KEY` | Yes for uploads | — | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Yes for uploads | — | Cloudinary API secret. |
| `REPORT_MAX_IMAGES` | No | `5` | Maximum images per report request. |
| `REPORT_MAX_IMAGE_SIZE_MB` | No | `5` | Maximum size of each report image. |
| `REPORT_DEFAULT_PAGE_SIZE` | No | `10` | Default report-list page size. |
| `REPORT_MAX_PAGE_SIZE` | No | `50` | Maximum report-list page size. |

KYC images are limited to 5 MB each. Report and KYC uploads accept JPG/JPEG,
PNG, and WebP. Files are held in memory and sent to Cloudinary; the API does
not persist uploaded files to the local filesystem.

### Tunneling and matching

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_NGROK` | `false` | Start an ngrok forwarder when `true`. |
| `NGROK_DOMAIN` | — | Optional reserved ngrok domain. |
| `ISSUE_MATCH_RADIUS_METERS` | `100` | Legacy matching candidate radius. |
| `ISSUE_AUTO_MATCH_THRESHOLD` | `0.80` | Score at or above which a candidate can be auto-linked. |
| `ISSUE_REVIEW_THRESHOLD` | `0.45` | Score at or above which a candidate can enter review. |
| `ISSUE_MATCH_TEXT_WEIGHT` | `0.7` | Text-similarity weight; distance receives the remainder. |
| `ISSUE_MATCH_AMBIGUITY_MARGIN` | `0.05` | Minimum margin used to avoid ambiguous automatic matches. |
| `ISSUE_MATCH_MAX_CANDIDATES` | `10` | Maximum legacy matching candidates. |
| `ISSUE_NEARBY_MAX_RADIUS_METERS` | `5000` | Maximum nearby-issue search radius. |
| `GEMINI_API_KEY` | — | Key sent to Gemini for optional same-problem checks. Never log it. |
| `GEMINI_MODELS` | built-in list | Comma-separated Gemini model fallback order. |
| `GEO_SAME_SPOT_M` | `30` | Same-location threshold for geo-first matching. |
| `GEO_CANDIDATE_M` | `100` | Geo-first candidate threshold. |
| `MATCHING_MODE` | — | Set to `legacy` to use the legacy text/review matching path. |

### Automation

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_AUTOMATION` | `false` | Enables deadline/escalation automation. |
| `AUTOMATION_INTERVAL_MINUTES` | `15` | Automation cycle interval. |
| `AUTOMATION_ESCALATION_GRACE_HOURS` | `48` | Grace period before level-2 escalation. |
| `AUTOMATION_BATCH_SIZE` | `200` | Maximum items processed per cycle. |
| `AUTOMATION_LOCK_LEASE_MS` | `600000` | Cross-instance automation lock lease. |
| `SCORE_JOB_ENABLED` | enabled unless `false` | Set to `false` to disable daily score refresh. |

Other matching and locking variables are available in `.env.example` and are
read by `src/config/matching.js` and `src/config/geoMatching.js`.

## Run and test

```bash
# Run the test suite once
npm test

# Run Vitest in watch mode
npm run test:watch

# Development server with automatic restart
npm run dev
```

Vitest is configured by `vitest.config.js`. Tests should not use production
credentials or production databases. Set a test-specific `MONGODB_URI` when
integration tests require a database.

## HTTP API

The canonical interactive specification is available at `/api-docs` while the
server is running. All paths below are relative to the API origin.

### Common conventions

- JSON endpoints use `Content-Type: application/json`.
- Registration and report creation/update use `multipart/form-data`.
- Protected endpoints require:

  ```http
  Authorization: Bearer <jwt>
  ```

- MongoDB IDs are 24-character ObjectId values.
- GeoJSON coordinates always use `[longitude, latitude]`, not
  `[latitude, longitude]`.
- Paginated responses generally contain:

  ```json
  {
    "success": true,
    "data": {
      "items": [],
      "pagination": {
        "total": 0,
        "page": 1,
        "limit": 20,
        "pages": 0
      }
    }
  }
  ```

### Health and documentation

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | Public | Health/welcome response. |
| GET | `/api-docs` | Public | Swagger UI. |

### Authentication

| Method | Path | Auth | Body or form fields |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Multipart fields: `fullName`, `email`, `phone`, `currentAddress`, `permanentAddress`, `password`, `confirmPassword`, `kycType` (`citizenship` or `pan`), optional `citizenshipNumber`; files `kycFrontImage` and, for citizenship, `kycBackImage`. |
| POST | `/api/auth/login` | Public | JSON: `{ "identifier": "email-or-phone", "password": "..." }`. |
| PUT | `/api/auth/update-profile` | JWT | JSON subset of `fullName`, `phone`, `currentAddress`, `permanentAddress`. |

Registration requires an 8-character minimum password. KYC front image is
always required; citizenship registration also requires the back image and
citizenship number. Registration returns a safe user object, not a password.

### Current user

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| GET | `/api/users/me` | JWT | — |
| PATCH | `/api/users/me/password` | JWT | `{ "currentPassword", "newPassword", "confirmNewPassword" }` |
| DELETE | `/api/users/me` | JWT | `{ "password": "current-password" }`; soft-deactivates the account. |

### Wards

| Method | Path | Auth | Body/query |
| --- | --- | --- | --- |
| GET | `/api/wards` | Public/optional JWT | Query: `page`, `limit` (max 100), `municipality`, `search`, and super-admin-only `includeInactive=true`. |
| GET | `/api/wards/:id` | Public/optional JWT | Ward detail; inactive wards are hidden except from authorized staff. |
| POST | `/api/wards` | `admin`/`super_admin` | `{ name, wardNumber, wardCode, municipality?, district?, province?, description? }` |
| PATCH | `/api/wards/:id` | `admin`/`super_admin` | Any of the ward fields, including `isActive`. |
| GET | `/api/wards/:id/issues` | Staff | Ward issue listing. |
| GET | `/api/wards/:id/dashboard` | Staff | Ward dashboard aggregates. |

`wardNumber` is a positive integer. Ward codes are stored uppercase, and ward
numbers are unique within a municipality. `ward_admin` access is restricted to
the administrator's assigned ward.

### Departments

| Method | Path | Auth | Body/query |
| --- | --- | --- | --- |
| GET | `/api/departments` | Public/optional JWT | Query: `page`, `limit`, `municipality`, `category`, `search`, and super-admin-only `includeInactive=true`. |
| GET | `/api/departments/:id` | Public/optional JWT | Department detail. |
| POST | `/api/departments` | `admin`/`super_admin` | `{ name, code, description?, municipality?, categories? }` |
| PATCH | `/api/departments/:id` | `admin`/`super_admin` | Any department field, including `isActive`. |
| DELETE | `/api/departments/:id` | `admin`/`super_admin` | Safe deactivation; does not physically delete the department. |

Allowed categories are:

`road`, `pothole`, `sanitation`, `waste_management`, `water_supply`,
`drainage`, `sewerage`, `street_lighting`, `public_infrastructure`,
`electricity`, `environment`, `traffic`, and `other`.

### Citizen reports

All report routes require a JWT. Creating a report also requires
`isVerified=true`.

| Method | Path | Auth | Body/query |
| --- | --- | --- | --- |
| POST | `/api/reports` | Verified user | Multipart fields: `title`, `description`, `category`, `location` (GeoJSON object or JSON string); repeated `images` files are optional up to `REPORT_MAX_IMAGES`. |
| GET | `/api/reports/my` | JWT | Query: `page`, `limit`, `sort=newest\|oldest`, `status`, `category`. |
| GET | `/api/reports` | Staff | Same filters plus staff ward scope; returns operational report queue data. |
| GET | `/api/reports/:id` | Owner/staff in scope | Returns a report and its status history. |
| PATCH | `/api/reports/:id` | Owner | Only reports still in `submitted` status; multipart editable fields and optional additional `images`. |
| DELETE | `/api/reports/:id` | Owner | Only submitted reports can be withdrawn. |

Report validation rules:

- `title`: 5–150 characters.
- `description`: 10–5,000 characters.
- `category`: one of the allowed categories above.
- `location`: `{ "type": "Point", "coordinates": [longitude, latitude] }`.
- Clients cannot set `reporter`, `status`, `issue`, timestamps, or status history.

### Issues

All issue routes require a JWT. Citizens receive a safe public issue view;
staff receive additional assignment, priority, deadline, escalation, and
matching metadata. `ward_admin` users only see issues in their assigned ward.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/issues` | JWT | List issues. Supports pagination, `category`, `status`, `ward`, search, sorting, and staff-only merged issue visibility. |
| GET | `/api/issues/nearby` | JWT | Find eligible issues near a point. Supply `lng`/`longitude`, `lat`/`latitude`, optional `radius`, `category`, and `limit`. |
| GET | `/api/issues/ranking` | JWT | Rank open issues near a point by score. Supply coordinates and optional `radius`, `category`, and `limit`. |
| GET | `/api/issues/reviews` | Staff | List open matching reviews. |
| POST | `/api/issues/reviews/:reviewId/resolve` | Staff | Resolve a matching review. |
| POST | `/api/issues/reconcile` | Staff/admin | Reconcile issue/report counts or matching state. |
| GET | `/api/issues/:id` | JWT | Issue detail. |
| PATCH | `/api/issues/:id` | Owner-authorized staff | Apply a permitted lifecycle update. |
| GET | `/api/issues/:id/reports` | JWT | List reports linked to an issue. |
| GET | `/api/issues/:id/events` | JWT | Read audience-filtered issue event history. |
| POST | `/api/issues/:id/events` | Staff | Add a manual event. Supports idempotency keys where accepted by the event validator. |
| GET | `/api/issues/:id/similar` | JWT | Find similar issues. |
| POST | `/api/issues/:id/merge` | Admin/staff as permitted | Merge a source issue into a target issue. |

Issue statuses are `open`, `under_review`, `assigned`, `in_progress`,
`resolved`, `closed`, `merged`, and `cancelled`. Priorities are `low`,
`medium`, `high`, and `critical`.

### Staff operations

All `/api/admin` operations require a JWT. Operations endpoints accept
`ward_admin`, `admin`, and `super_admin` as appropriate; global user-management
endpoints are restricted to the platform-admin roles (`admin` and
`super_admin`, treated as aliases by authorization middleware).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/admin/dashboard` | Operations staff | Operational dashboard. |
| GET | `/api/admin/issues` | Operations staff | Issue queue with status, category, search, priority, assignment, overdue, escalation, and ward filters. |
| GET | `/api/admin/reports` | Operations staff | Report queue; defaults to submitted reports. |
| PATCH | `/api/admin/reports/:id/review` | Operations staff | Review a report; body includes the review decision and optional reason. |
| PATCH | `/api/admin/issues/:id/status` | Operations staff | Change issue status using lifecycle rules. |
| PATCH | `/api/admin/issues/:id/assign` | Operations staff | Assign/clear department or staff assignment. |
| PATCH | `/api/admin/issues/:id/priority` | Operations staff | Set a priority and optional reason. |
| PATCH | `/api/admin/issues/:id/deadline` | Operations staff | Set or clear a deadline. |
| GET | `/api/admin/users` | Operations staff | List users. Ward admins see only citizens in their ward and no KYC data. |
| GET | `/api/admin/users/:id` | Platform admin | Read a user, including administrative fields. |
| PATCH | `/api/admin/users/:id/role` | Platform admin | Body `{ role, wardId? }`; `wardId` is required for `ward_admin`. |
| PATCH | `/api/admin/users/:id/verify` | Platform admin | Body `{ isVerified: true\|false }`. |
| PATCH | `/api/admin/users/:id/status` | Platform admin | Change active/suspended status. |

### Analytics

Analytics routes require operations staff and are rate limited. They return
aggregate data only and do not expose reporter contact details.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/analytics/overview` | Overall operational totals. |
| GET | `/api/analytics/issues` | Issue breakdown by supported grouping. |
| GET | `/api/analytics/resolution-time` | Resolution-time aggregates; use a date range. |
| GET | `/api/analytics/department-performance` | Department performance aggregates. |
| GET | `/api/analytics/trends` | Time-bucketed trends; use a date range. |

Analytics filters include date/range, category, ward, department where
allowed, and grouping options defined by `src/services/analyticsService.js`.
Times are normalized to `Asia/Kathmandu` (`UTC+05:45`).

### Area ranking

| Method | Path | Auth | Query |
| --- | --- | --- | --- |
| GET | `/api/areas/ranking` | JWT | Optional `limit`, capped at 50; returns ranked area aggregates. |

## Authentication and authorization

The login response contains a signed JWT:

```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": {
      "_id": "...",
      "fullName": "Example Citizen",
      "email": "citizen@example.com",
      "phone": "9800000000",
      "role": "user",
      "isVerified": true
    }
  }
}
```

`protect` verifies the token, reloads the user, excludes the password, and
rejects suspended accounts. `restrictTo` checks roles. A user with
`ward_admin` role must have a `wardId`; staff routes automatically enforce that
ward scope.

Roles:

- `user`: default citizen account.
- `citizen`: citizen-compatible role used by administrative filters.
- `ward_admin`: staff restricted to one ward.
- `admin`: platform administrator and legacy alias of `super_admin`.
- `super_admin`: unrestricted platform administration.

KYC verification is separate from role. Report creation requires a verified
account, while users can access their own profile and account-management
operations before verification.

## Domain model

| Model | Purpose | Important relationships |
| --- | --- | --- |
| `User` | Identity, credentials, KYC, role, status, ward scope. | Optional `wardId` to `Ward`. |
| `Ward` | Municipal ward metadata and active/deactivated state. | Created/updated by `User`. |
| `Department` | Responsible municipal unit and supported categories. | Created/updated by `User`. |
| `Report` | Citizen-submitted observation and uploaded evidence. | References reporter, ward, and optional `Issue`. |
| `Issue` | Canonical municipal problem assembled from reports. | References ward, department, assignee, and merge target. |
| `IssueEvent` | Auditable issue timeline and operational events. | References issue, actor, and optional related issue. |
| `MatchReview` | Human review queue for ambiguous report/issue matches. | References report and candidate issue. |
| `MatchingLock` | Cross-instance lock for matching/automation work. | Prevents duplicate concurrent processing. |
| `AdminAuditLog` | Administrative user-management audit trail. | References actor and target user. |

Reports and issues use GeoJSON `Point` fields with `2dsphere` indexes. A
report's ward is captured at submission time from the reporter's ward; this is
not a live municipal boundary lookup.

## Report and issue workflow

1. A verified citizen submits a report.
2. Image files are validated and uploaded to Cloudinary.
3. The matching service searches eligible open issues.
4. The report is either auto-linked, creates a new issue, or enters a review
   queue.
5. Staff can review, assign, prioritize, set a deadline, add events, and
   transition the issue.
6. Automation can escalate overdue issues when enabled.
7. Reports and issue events retain status history for citizen and staff views.
8. A citizen can edit or withdraw only their own report while it is still
   `submitted`.

Resolved issue statuses are `resolved` and `closed`. Merged issues are
duplicates and are excluded from normal public totals. Withdrawn and rejected
reports are excluded from active report counts.

## Matching and scoring

The geo-first matching implementation uses these provisional defaults:

- Reports within 30 metres of the same non-`other` category can be merged
  without AI.
- Candidates within 100 metres can be evaluated by the Gemini same-problem
  check when configured.
- The legacy matcher combines text similarity and distance, with a default
  text weight of 0.7.
- Ambiguous or lower-confidence candidates enter the staff review queue.

Issue ranking scores combine category weight, severity, report volume, unique
reporters, and age. Score levels map to `low`, `medium`, `high`, or `critical`.
Automatic priority never exceeds `high`; `critical` requires a human decision.
These values are starting points and should be calibrated against municipal
data before production use.

## Background jobs

`server.js` starts both schedulers after MongoDB connects:

- **Automation scheduler**: disabled unless `ENABLE_AUTOMATION=true`; runs an
  initial cycle after 30 seconds and then at the configured interval. It uses
  a database lease so multiple application instances do not process the same
  cycle concurrently.
- **Score scheduler**: enabled by default; performs an initial refresh after
  60 seconds and then recomputes issue scores daily. Set
  `SCORE_JOB_ENABLED=false` to disable it.

Schedulers use `unref()` timers, so they do not prevent process shutdown.

## Uploads and Cloudinary

Upload folders:

- KYC: `nagarsewa/kyc-documents`
- Report images: `nagarsewa/report-images`

Only image MIME types/extensions supported by `src/utils/uploadConfig.js` are
accepted. The report route returns `413` for file size/count limits and `415`
for unsupported image uploads. If a later operation fails after an upload,
the service attempts to clean up the newly uploaded Cloudinary assets.

Do not log Cloudinary secrets, KYC URLs in public logs, or Gemini API keys.
KYC fields are intentionally omitted from ward-admin user listings.

## Response and error conventions

Successful responses use:

```json
{
  "success": true,
  "message": "Operation completed",
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "message": "Human-readable error",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "field": "title", "message": "title must be between 5 and 150 characters" }
    ]
  }
}
```

Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid body, query, ID, or upload request. |
| `401` | Missing, invalid, or expired JWT; invalid credentials. |
| `403` | Authenticated but not allowed, unverified, suspended, or outside ward scope. |
| `404` | Resource not found or intentionally hidden from the caller. |
| `409` | Duplicate resource or state conflict, such as editing a non-submitted report. |
| `413` | Upload size/count exceeded. |
| `415` | Unsupported image type/content. |
| `500` | Unexpected server-side failure. |

## Operations and maintenance

The following scripts are declared in `package.json`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start with Nodemon. |
| `npm start` | Start the production-style server. |
| `npm test` | Run Vitest once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run backfill:issues` | Run `scripts/backfillIssues.js`. |
| `npm run backfill:issue-descriptions` | Run `scripts/backfillIssueDescriptions.js`. |
| `npm run backfill:issue-scores` | Run `scripts/backfillIssueScores.js`. |
| `npm run migrate:events` | Run `scripts/migrateIssueEvents.js`. |
| `npm run seed:mock` | Run `scripts/seedMockReports.js`. |

The current checkout declares these maintenance commands but does not include a
`scripts/` directory. They will therefore fail with a missing-module error
until the corresponding script files are restored or added.

The repository also supports running the super-admin seed utility directly:

```bash
node src/utils/seedSuperAdmin.js
```

When these scripts are available, run them with a backup, a test database
first, and a documented rollback plan. They may update existing documents and
should not be treated as idempotent without checking their implementation.

## Project structure

```text
.
├── server.js                 # Process entrypoint and scheduler startup
├── package.json              # Scripts and dependencies
├── .env.example              # Configuration template
├── vitest.config.js          # Test configuration
├── scripts/                  # Backfills, migrations, and development seeds
└── src/
    ├── app.js                # Express app, middleware, routes, errors
    ├── config/               # Database, matching, automation, Swagger
    ├── controllers/          # HTTP request handlers
    ├── jobs/                 # Background schedulers
    ├── middlewares/          # Authentication and rate limiting
    ├── models/               # Mongoose schemas and indexes
    ├── routes/               # API route declarations
    ├── serializers/           # Audience-safe response shaping
    ├── services/              # Domain workflows and transactions
    ├── utils/                 # Uploads, sanitization, errors, seed helpers
    └── validators/            # Request and query validation
```

## Production checklist

- Set a unique, high-entropy `JWT_TOKEN`.
- Replace or disable the seeded default super-admin credentials.
- Use a managed MongoDB deployment and verify transaction support.
- Configure Cloudinary credentials through a secret manager.
- Set `NODE_ENV=production`.
- Restrict CORS to known frontend origins instead of the permissive default if
  the deployment requires browser-origin controls.
- Keep `ENABLE_AUTOMATION=false` until SLA and priority rules have been
  validated against real operational data.
- Configure process supervision, health monitoring, log collection, and
  graceful shutdown.
- Back up MongoDB before running any migration/backfill.
- Do not expose `/api-docs` publicly unless that is an intentional deployment
  decision.
- Rotate credentials if `.env` or any secret-bearing deployment artifact is
  exposed.

## Troubleshooting

### The server exits while starting

Check `MONGODB_URI`, network access, credentials, and MongoDB availability.
`connectDB()` exits the process when the initial connection fails.

### Uploads fail

Confirm all three Cloudinary variables are set. Check the image type, image
content, per-file size, and report image count. KYC and report uploads use
different form field names: `kycFrontImage`/`kycBackImage` for registration and
`images` for reports.

### A protected endpoint returns `401`

Send the token as `Authorization: Bearer <token>`. Confirm the token was
created with the same `JWT_TOKEN` currently configured and has not expired.

### A staff endpoint returns `403`

Check the user's role, `isVerified` where relevant, and `wardId` for
`ward_admin`. Ward administrators cannot access data outside their assigned
ward.

### Matching or nearby queries fail

Verify that report and issue locations contain valid
`[longitude, latitude]` coordinates and that MongoDB has built the required
`2dsphere` indexes. Review the matching radius and timeout configuration.

### Automated jobs appear inactive

Automation is intentionally disabled unless `ENABLE_AUTOMATION=true`. Score
refresh is disabled only when `SCORE_JOB_ENABLED=false`. Check startup logs and
the scheduler configuration values.
