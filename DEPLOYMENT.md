# Deployment & GitHub Setup

Repo name: **ai-agents-backend** (backend package is `ai-agents-backend`; the repo contains both backend and frontend.)

---

## 1. Is the repo ready for GitHub?

Yes, after you:

- Copy `.env.example` to `.env` and fill in secrets (do not commit `.env`).
- Ensure `.env` and `node_modules/` are in `.gitignore`.
- Run backend and frontend from their own folders (see below).

---

## 2. Project structure

```
├── backend/                 # API server (ai-agents-backend)
│   ├── package.json
│   ├── server.js
│   └── pdfParser.js
├── src/                     # React frontend (ai-agents-frontend)
├── public/
├── package.json             # Frontend package.json
├── .env.example
├── .env                     # Your secrets (do not commit)
└── docs/
```

---

## 3. Local development

**Terminal 1 – Backend**

```bash
cd backend
npm install
npm start
# Runs on http://localhost:5000 (or PORT from .env)
```

**Terminal 2 – Frontend**

```bash
npm install
npm start
# Runs on http://localhost:3000, proxies /api to backend
```

Or from repo root: `npm run start:backend` in one terminal and `npm start` in another.

---

## 4. Environment variables

- Copy `.env.example` to `.env` in the **repo root**.
- Backend loads `.env` from `backend/` or from repo root.
- Required: `LLM_KEY_API` or `LLM_API_KEY`, `LLM_MODEL`.
- Optional: JIRA_*, SLACK_*, TELEGRAM_BOT_TOKEN, etc. (see `.env.example`).

---

## 5. Cloud deployment (single server)

Backend is set up for cloud:

- **PORT**: Set `PORT` in the environment (e.g. `8080`). Default is `5000`.
- **NODE_ENV**: Set `NODE_ENV=production`.
- **Static frontend**: In production, if a `build/` folder exists at repo root, the backend serves it (single deploy).

**Steps:**

1. **Build frontend**

   ```bash
   npm install
   npm run build
   ```

2. **Install and run backend**

   ```bash
   cd backend
   npm install
   PORT=8080 NODE_ENV=production node server.js
   ```

   Or set `PORT` and `NODE_ENV` in your host’s environment (e.g. Heroku, Railway, Render).

3. Open `http://your-host:8080`. The same server serves the React app and `/api/*`.

**Optional:** Put `.env` in `backend/` or set all variables in the cloud dashboard; backend reads root or `backend/.env`.

---

## 6. Frontend deployment (frontend package.json)

- **Scripts**: `npm start` (dev), `npm run build` (production build).
- **API URL**: For production, if the frontend is served by the **same** backend, leave `REACT_APP_API_URL` unset (relative `/api`).
- If the frontend is on a **different** host (e.g. Vercel), set `REACT_APP_API_URL` at build time to your backend URL (e.g. `https://api.yourdomain.com`).

---

## 7. Steps to push to GitHub

1. **Create repo on GitHub**  
   Name: `ai-agents-backend` (or any name). Do not add a README if you already have one.

2. **Ignore secrets and installs**  
   Ensure `.gitignore` contains:
   ```
   .env
   node_modules/
   backend/node_modules/
   build/
   ```

3. **Use the new backend locally**  
   - Run backend from `backend/` with `npm start` (see section 3).  
   - Keep using the root `package.json` for the frontend; do not run the old root `server.js`.

4. **Optional: remove old root server files**  
   After confirming the backend in `backend/` works, you can delete the root `server.js` and `pdfParser.js` to avoid confusion.

5. **Commit and push**

   ```bash
   git init
   git add .
   git commit -m "Initial commit: ai-agents backend + frontend"
   git remote add origin https://github.com/YOUR_USERNAME/ai-agents-backend.git
   git push -u origin main
   ```

---

## 8. Summary

| Item              | Location / Action                                      |
|-------------------|--------------------------------------------------------|
| Backend package   | `backend/package.json` (name: `ai-agents-backend`)    |
| Frontend package  | Root `package.json` (name: `ai-agents-frontend`)       |
| Env template      | `.env.example` (copy to `.env`, do not commit `.env`) |
| Server for cloud  | `backend/server.js` (PORT, NODE_ENV, serves `build/`)  |
| Frontend for prod | `npm run build`; set `REACT_APP_API_URL` if different host |
