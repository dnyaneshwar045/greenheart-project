# Golf Charity Subscription Platform

PRD-aligned full-stack training build with public visitor experience, subscriber portal, and admin control center.

## Implemented Features

- Subscription engine: monthly/yearly INR plans, renewal sync, cancel-at-period-end, lapsed/replaced states
- Score experience: Stableford 1-45 with date, latest-5 rolling retention, reverse chronological order, member edit
- Draw engine: random and algorithmic (most/least frequent), simulation mode, publish mode, monthly cadence guard, jackpot rollover
- Charity integration: directory, search/filter, profile view, featured support, contribution percentage (minimum 10%), independent donation
- Winner workflow: winner claims, proof upload, admin approve/reject, payout pending to paid
- Admin dashboard tools: users, subscriptions, scores, draws, winners, charity CRUD, analytics
- Access control: subscriber-gated features and admin-only actions

## Run

1. Backend:
   - `cd backend`
   - `npm start`
2. Frontend:
   - `cd frontend`
   - `npm run dev`

## Key API Endpoints

- Auth: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`
- Public Charities: `/api/charities`, `/api/charities/:id`
- Subscription: `/api/subscriptions`, `/api/subscriptions/me`, `/api/subscriptions/me/cancel`
- Scores: `/api/scores` (POST, GET), `/api/scores/:id` (PATCH)
- Dashboard: `/api/dashboard/me`
- Draws: `/api/draws/latest`
- Winners (member): `/api/winners/me`, `/api/winners/:claimId/proof`
- Donations: `/api/donations/independent`
- Admin overview: `/api/admin/overview`
- Admin users: `/api/admin/users`, `/api/admin/users/:id` (PATCH)
- Admin subscriptions: `/api/admin/subscriptions`, `/api/admin/subscriptions/:id` (PATCH)
- Admin scores: `/api/admin/scores`, `/api/admin/scores/:id` (PATCH)
- Admin draws: `/api/admin/draws`, `/api/admin/draws/simulate`, `/api/admin/draws/publish`, `/api/admin/draws/run`
- Admin winners: `/api/admin/winners`, `/api/admin/winners/:id` (PATCH)
- Admin charities: `/api/admin/charities` (POST), `/api/admin/charities/:id` (PATCH, DELETE)

## Admin Credentials

- Email: `admin@golfcharity.com`
- Password: `admin123`
