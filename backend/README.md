# PrimeBiller Backend

Node.js + Express API with first-party MySQL-backed authentication.

## Authentication

The project does not use Better Auth. Authentication uses app_users for email/password accounts, app_sessions for secure HTTP-only sessions, and password_reset_otps for email OTP password recovery.

Password recovery continues to use the existing Nodemailer SMTP transporter in backend/email.js.

## Local setup

Run npm install, npm run db:schema, npm run db:migrate, npm run seed:demo, then npm start.

Configure DATABASE_URL, FRONTEND_URL, DEMO_EMAIL, DUMMY_PASSWORD, and the existing SMTP_* variables in .env.
