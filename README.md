# PrimeBiller

Girder-style billing platform workspace.

## Project structure

```
primebiller/
├── frontend/                 # React + Vite login/UI application
│   ├── src/
│   ├── public/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/                  # Reserved for the next development phase
│   └── README.md
│
└── README.md
```

## Current phase

The current implementation is the **frontend login UI phase**. The supplied Girder design has been implemented with responsive desktop, tablet, and mobile layouts.

The frontend includes the login presentation and UI interactions only. Authentication, sessions, Better Auth, PostgreSQL, API endpoints, authorization, and other backend functionality are intentionally not implemented yet.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
cd frontend
npm run build
```

## Backend — next phase

Backend development will live under `backend/` and will be started after the login UI is accepted. The planned stack is Node.js + Better Auth + PostgreSQL.

Keeping these concerns separate allows frontend work and backend authentication development to evolve independently.

## Design QA

The login UI was reviewed across desktop, tablet, tablet-portrait, mobile, and small-mobile breakpoints. The project also includes the standalone warehouse background asset at:

`frontend/public/images/login-warehouse-bg.svg`
