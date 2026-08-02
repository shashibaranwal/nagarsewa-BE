# Nagar Sewa — Backend

REST API for the Nagar Sewa municipal problem-reporting platform. Citizens post a
problem with one photo and a location; officials move it through a status
workflow; the wider public votes, comments and reposts on the feed.

Node.js · Express · MongoDB (Mongoose) · JWT · Multer · Socket.IO

## Setup

```bash
cd nagarSewa-BE
npm install
cp .env.example .env      # then edit JWT_SECRET and MONGO_URI
npm run seed              # optional: demo users + reports
npm run dev
```

The API is served at `http://localhost:5000/api`, health check at `/health`.

## Image storage (ImageKit)

Report images are uploaded to [ImageKit](https://imagekit.io) and the report stores
the CDN URL it returns. Put your keys in `.env`:

```
IMAGEKIT_PRIVATE_KEY=private_xxx     # from Dashboard → Developer → API keys
IMAGEKIT_FOLDER=/nagar-sewa/reports  # where uploads land
```

Only the private key is used server-side; `IMAGEKIT_PUBLIC_KEY` and
`IMAGEKIT_URL_ENDPOINT` are there for the frontend.

`IMAGEKIT_PRIVATE_KEY` is required — the server refuses to boot without it, since
report images have nowhere else to go. Nothing is written to the server's disk and
the API serves no images itself, so instances stay stateless.

The flow lives in [`src/services/storageService.js`](src/services/storageService.js):
multer buffers the file in memory ([`middleware/upload.js`](src/middleware/upload.js)),
`saveImage()` pushes it to ImageKit under a randomised name and returns the `image`
subdocument, and `deleteImage()` removes the asset again if the report fails to save.

## API docs (Swagger)

Interactive docs: <http://localhost:5000/api/docs> — raw OpenAPI 3.0 document at
`/api/docs.json`. Log in through `/api/auth/login`, then click **Authorize** and paste
the token to try the protected endpoints straight from the browser.

The spec lives in [`src/docs/`](src/docs): `components.js` holds the shared schemas,
parameters and error responses; `paths/*.js` describe the operations per resource.
Add an endpoint → add it to the matching file under `src/docs/paths/`.

## Roles

| Role | Can |
| --- | --- |
| `citizen` | register, report problems, vote, comment, repost |
| `official` | everything a citizen can, plus change report status and assign reports |
| `admin` | everything, plus create official accounts and manage users |

Public registration always creates a `citizen`. Officials are created by an admin
via `POST /api/users/officials`.

## Report status flow

`untouched` → `read` → `working` → `completed`

Every new report starts at `untouched`. Only officials/admins can change status,
and each change is appended to `statusHistory` with who changed it and an
optional note. Reaching `completed` stamps `resolvedAt`. A citizen can still edit
their report's text while it is `untouched`, but not after an official has opened
it.

## Response shape

All responses use a consistent envelope.

```json
{ "success": true, "message": "Success", "data": { }, "meta": { } }
```

`meta` is present on paginated list endpoints and carries
`page, limit, total, totalPages, hasNextPage`. Errors return
`{ "success": false, "message": "...", "errors": [{ "field", "message" }] }`.

Send the token as `Authorization: Bearer <token>`.

## Endpoints

### Auth — `/api/auth`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/register` | — | `name, email, password, phone?, ward?, city?` → user + token |
| POST | `/login` | — | `email, password` → user + token |
| GET | `/me` | any | current user |
| PATCH | `/me` | any | `name?, phone?, avatarUrl?, ward?, city?` |
| POST | `/change-password` | any | `currentPassword, newPassword` |

### Reports — `/api/reports`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/` | optional | the feed — see query params below |
| GET | `/stats` | — | counts by status/category; `?ward=&city=` to scope |
| GET | `/mine` | any | the caller's own reports |
| POST | `/` | any | **multipart/form-data** — see below |
| GET | `/:id` | optional | single report with full `statusHistory` |
| PATCH | `/:id` | owner / official | `title?, description?, category?, address?, ward?, city?` |
| DELETE | `/:id` | owner / admin | soft delete |
| PATCH | `/:id/status` | official / admin | `status`, `note?`, `assignedTo?` |

Creating a report is `multipart/form-data` with exactly one file field named
`image` (JPEG/PNG/WEBP/HEIC, max 5 MB) plus fields:
`title, description, category, address, ward?, city?, latitude?, longitude?`.

Feed query params: `page, limit` (max 50), `status`, `category`, `ward`, `city`,
`reportedBy`, `search` (full-text over title/description/address),
`sort` = `recent | oldest | top | discussed`, and `lat` + `lng` + `radius`
(metres, default 2000) for a nearby search.

When a token is sent, every report in the response is annotated with `myVote`
(`1`, `-1` or `0`) and `hasReposted` so the client can render the action bar
directly.

### Social

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/reports/:id/comments` | optional | top-level comments, best-scored first |
| POST | `/api/reports/:id/comments` | any | `body`, `parent?` (one level of replies) |
| GET | `/api/comments/:commentId/replies` | optional | replies, oldest first |
| PATCH | `/api/comments/:commentId` | author | `body` |
| DELETE | `/api/comments/:commentId` | author / official | soft delete |
| POST | `/api/reports/:id/vote` | any | `value: 1 \| -1` |
| POST | `/api/comments/:commentId/vote` | any | `value: 1 \| -1` |
| POST | `/api/reports/:id/repost` | any | `caption?` |
| DELETE | `/api/reports/:id/repost` | any | undo repost |
| GET | `/api/reports/:id/reposts` | optional | who reposted |
| GET | `/api/users/:userId/reposts` | optional | a user's reposts, with the full report |

Voting the same way twice removes the vote (arrow toggles off); voting the
opposite way flips it. The response returns the fresh `upvoteCount`,
`downvoteCount`, `score` and the caller's `myVote`.

### Notifications — `/api/notifications` (all require auth)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | `?unreadOnly=true`; `meta.unreadCount` included |
| GET | `/unread-count` | badge count |
| PATCH | `/read-all` | mark everything read |
| PATCH | `/:id/read` | mark one read |
| DELETE | `/:id` | remove one |

Notifications are created for: a new report (to officials of that ward/city, or
all officials if none match), a status change (to the reporter and assignee), a
new comment (to the reporter), a reply (to the parent comment's author), a new
upvote, and a repost. You are never notified about your own action.

### Users — `/api/users`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/:id` | — | public profile + activity counts |
| GET | `/` | admin | `?role=&search=&page=&limit=` |
| POST | `/officials` | admin | create an `official` or `admin` |
| PATCH | `/:id/role` | admin | `role`, `department?`, `ward?`, `city?` |
| PATCH | `/:id/toggle-active` | admin | deactivate / reactivate |

### Meta

`GET /api/meta` returns the status, category and role enums so the frontend
doesn't hardcode them.

## Realtime

Socket.IO is mounted on the same HTTP server. Connect with the JWT:

```js
io('http://localhost:5000', { auth: { token } })
```

Every client joins a private `user:<id>` room and receives `notification:new`.
Officials and admins also join `officials` and receive `report:new` the moment a
report is filed. If `socket.io` is absent the API still works — realtime just
becomes a no-op.

## Project layout

```
src/
  app.js              express app: security, cors, docs, routes
  server.js           http server + mongo connection + realtime + shutdown
  config/             env, db connection, enums
  models/             User, Report, Comment, Vote, Repost, Notification
  middleware/          auth, validate (zod), upload (multer), rateLimit, error
  controllers/        request/response handling per resource
  services/           report queries, vote toggling, notifications, image storage
  routes/             route tables
  docs/               openapi spec + swagger ui mounting
  realtime/io.js      socket.io wiring (optional dependency)
  scripts/seed.js     demo data
```

## Notes on data design

- Vote/comment/repost counters are denormalised onto `Report` so the feed sorts
  and renders without aggregation. The vote and comment services keep them in
  sync.
- `Vote` has a unique index on `(user, targetType, targetId)`, so a user cannot
  double-vote; `Repost` has a unique index on `(user, report)`.
- Reports and comments are soft-deleted (`isDeleted`) to keep threads coherent.
- `location.coordinates` is a GeoJSON point with a `2dsphere` index, optional
  because a user may only type an address.
- `image` stores what the CDN gave back (`url`, `thumbnailUrl`, `fileId`,
  `filePath`) rather than a path this server owns, so instances stay stateless.

## Not included

Password reset emails and refresh-token rotation are out of scope here.
