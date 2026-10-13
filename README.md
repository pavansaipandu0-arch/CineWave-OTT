# CineWave OTT starter

This is a runnable Node.js + Express + SQLite starter for videos you own or are licensed to distribute. It supports admin login, adding/removing movies, uploading separate 360p/480p/720p/1080p video files, streaming and downloading available versions.

## Requirements
- Node.js 20+
- npm

## Setup
1. Copy `.env.example` to `.env`.
2. Create a strong session secret (example command: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and set `SESSION_SECRET`.
3. Create a bcrypt hash for your admin password:
   `node -e "console.log(require('bcryptjs').hashSync('YOUR-STRONG-PASSWORD', 12))"`
   Put that hash into `ADMIN_PASSWORD_HASH`. Set `ADMIN_USERNAME` too.
4. Install dependencies: `npm install`
5. Start: `npm start`
6. Open `http://localhost:3000`

## How to use
- Log in with the credentials you set in `.env`.
- Add a movie and upload one quality version.
- To add other quality versions, use the Upload 360p/480p/720p/1080p buttons in the movie management list.
- The server does not transcode video. Upload a separately encoded file for each quality. A future production upgrade can use FFmpeg or a managed video service to generate adaptive HLS/DASH renditions.
- Movie records are in `storage/cinewave.sqlite`; video files are in `storage/videos/`. Back up both.

## Important production checklist
- This is a starter, not a fully audited production OTT platform.
- Use HTTPS and secure production session storage (not Express MemoryStore).
- Put video files in object storage/CDN; do not rely on local disk for scalable hosting.
- Configure upload limits, quotas, monitoring, backups, and malware/content validation.
- Use a proper video pipeline (HLS/DASH), access control or signed URLs if needed, and test range requests on your chosen hosting.
- Configure CORS only if frontend/backend are on separate origins.
- Never commit `.env` or expose secrets.
- Only upload or distribute content you own or are licensed to distribute.
