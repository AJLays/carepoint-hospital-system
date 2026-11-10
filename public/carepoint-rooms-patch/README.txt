CAREPOINT ROOMS & BEDS UI PATCH

This patch adds a Rooms & Beds page that uses the existing backend endpoints:
GET/POST /api/rooms
GET/POST /api/beds
PATCH /api/beds/:id/status

Files:
- public/rooms.html (new)
- public/rooms.js (new)
- public/index.html (updated sidebar navigation)

Apply by copying these files into your existing project's public folder.
Do not replace server.js or database files for this UI patch.
