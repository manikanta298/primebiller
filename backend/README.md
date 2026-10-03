# PrimeBiller Backend

Node.js + Express API with first-party MySQL-backed authentication.

## Authentication

The project does not use Better Auth. Authentication uses app_users for email/password accounts, app_sessions for secure HTTP-only sessions, and password_reset_otps for email OTP password recovery.

Password recovery continues to use the existing Nodemailer SMTP transporter in backend/email.js.

## Local setup

Run npm install, npm run db:schema, npm run db:migrate, npm run seed:demo, then npm start.

Configure DATABASE_URL, FRONTEND_URL, DEMO_EMAIL, DUMMY_PASSWORD, and the existing SMTP_* variables in .env.

## Email / OTP delivery

`email.js` picks a provider in this order: `BREVO_API_KEY` -> `RESEND_API_KEY` -> SMTP (`SMTP_HOST`) -> console only.

Render free web services block outbound SMTP ports (25, 465, 587), so on the free tier use Brevo or Resend (HTTPS, port 443) or upgrade to a paid instance. Check the startup log line `Email provider: ...` and, for SMTP, `SMTP connection verification failed`.

Set `LOG_OTP=true` to print OTPs in the server log while debugging (disabled in production unless `LOG_OTP_IN_PRODUCTION=true`). Turn it off afterwards.

After a successful password reset the API signs the user in (fresh session cookie, all older sessions revoked) and returns `{ ok, session }`; the frontend then routes to `#/dashboard`.
