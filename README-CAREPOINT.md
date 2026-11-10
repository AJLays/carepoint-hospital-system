# CarePoint Hospital Management System

## Current update
- Default local database is `defaultdb` (override with `DB_NAME`).
- Patient registration, editing, searching, and activation no longer require `course_id`. The existing `courses` table and `patients.course_id` column are left untouched.
- Existing doctor/department routes are preserved.
- Added API routes for rooms, beds, admissions/discharge, treatments, medications/orders, services, billing/payments, dashboard, and summary reports.
- No schema creation, ALTER TABLE, or destructive database setup runs when the server starts.

## Run locally
1. Select your `defaultdb` database in phpMyAdmin and make sure MySQL is running.
2. In the project folder, run `npm install` once.
3. If your local MySQL is not using the defaults, set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. Local defaults: `localhost`, `3306`, `root`, empty password, `defaultdb`.
4. Run `npm start`.
5. Open `http://localhost:3000` and test `http://localhost:3000/api/health`.

## API routes added
- `GET/POST/PUT /api/rooms`
- `GET/POST /api/beds`, `PATCH /api/beds/:id/status`
- `GET/POST /api/admissions`, `PATCH /api/admissions/:id/discharge`
- `GET/POST /api/treatments`
- `GET/POST /api/medications`, `PATCH /api/medications/:id/stock`
- `GET/POST /api/medication-orders`
- `GET/POST /api/services`
- `GET/POST /api/bills`, `GET/POST /api/bills/:id/items`, `POST /api/bills/:id/payments`
- `GET /api/dashboard`, `GET /api/reports/summary`

## Important status
This update is the backend foundation, not a finished production deployment. The database-specific API queries still need to be tested against your live `defaultdb`. The browser UI for the new modules, authentication/session enforcement, audit logging integration, backup/restore workflow, and final end-to-end testing remain to be completed. Do not expose this system publicly until authentication and authorization are implemented and tested.
