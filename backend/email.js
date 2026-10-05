import dns from "node:dns";
import nodemailer from "nodemailer";

// Prefer IPv4 so SMTP connections work where IPv6 egress is unavailable.
dns.setDefaultResultOrder("ipv4first");

/*
 * Delivery order:
 *   1. HTTPS email API (BREVO_API_KEY or RESEND_API_KEY) - works on Render free tier,
 *      because it uses port 443. Render free web services block SMTP ports 25/465/587.
 *   2. SMTP via nodemailer (SMTP_HOST) - works on paid Render instances / local dev.
 *   3. Console only - when nothing is configured.
 *
 * TEMPORARY TESTING MODE (for when SMTP is blocked):
 *   LOG_OTP=true                    print the OTP in the server console
 *   LOG_OTP_IN_PRODUCTION=true      also required when NODE_ENV=production (e.g. on Render)
 *   OTP_CONSOLE_ONLY=true           skip sending email entirely (instant, nothing to time out)
 * While OTP logging is active, an email delivery failure no longer breaks the reset flow:
 * the OTP stays valid and you read it from the logs. Remove these variables when done.
 */

const brevoKey = String(process.env.BREVO_API_KEY || "").trim();
const resendKey = String(process.env.RESEND_API_KEY || "").trim();

const smtpHost = String(process.env.SMTP_HOST || "").trim();
const smtpUser = String(process.env.SMTP_USER || "").trim();
const smtpPassword = String(process.env.SMTP_PASSWORD || "");
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpFrom = String(process.env.SMTP_FROM || "").trim() || smtpUser;

// MAIL_FROM: "PrimeBiller <no-reply@yourdomain.com>" (sender must be verified with the provider).
const mailFrom = String(process.env.MAIL_FROM || "").trim() || smtpFrom;
const demoEmail = String(process.env.DEMO_EMAIL || "").trim().toLowerCase();

const provider = brevoKey ? "brevo" : resendKey ? "resend" : smtpHost ? "smtp" : "none";

const flag = (name) => String(process.env[name] || "").toLowerCase() === "true";
const isDummyRecipient = (email) => String(email || "").trim().toLowerCase() === demoEmail && Boolean(demoEmail);

const shouldLogOtp = (email) => {
  if (isDummyRecipient(email)) return true;
  if (provider === "none") return true;
  if (!flag("LOG_OTP")) return false;
  return process.env.NODE_ENV !== "production" || flag("LOG_OTP_IN_PRODUCTION");
};

// Only skip email when the OTP will actually be visible in the logs; otherwise the code would be lost.
const isConsoleOnly = (email) => flag("OTP_CONSOLE_ONLY") && shouldLogOtp(email);

if (flag("LOG_OTP") && provider !== "none") {
  console.warn("WARNING: OTP console logging is ON (testing mode). OTPs are written to the server log.");
}
if (flag("OTP_CONSOLE_ONLY") && !isConsoleOnly(demoEmail)) {
  console.warn("OTP_CONSOLE_ONLY is set but ignored: OTP logging is not permitted (set LOG_OTP=true, and LOG_OTP_IN_PRODUCTION=true when NODE_ENV=production).");
}

const transporter =
  provider === "smtp"
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        auth: smtpUser ? { user: smtpUser, pass: smtpPassword } : undefined,
      })
    : null;

console.log(`Email provider: ${provider}`);

if (transporter && !isConsoleOnly()) {
  transporter
    .verify()
    .then(() => {
      console.log(
        `SMTP connection verified: host=${smtpHost} port=${smtpPort} secure=${smtpSecure} user=${smtpUser ? "configured" : "missing"}`,
      );
    })
    .catch((error) => {
      console.error(
        `SMTP connection verification failed: ${error.message}. ` +
          "If this is a free Render web service, outbound SMTP (25/465/587) is blocked - " +
          "set BREVO_API_KEY or RESEND_API_KEY to send over HTTPS instead.",
      );
    });
} else if (provider === "none") {
  console.warn("No email provider configured (BREVO_API_KEY / RESEND_API_KEY / SMTP_HOST). OTPs will only be logged.");
}

const purposeFor = (type) =>
  type === "forget-password" ? "password reset" : type === "email-verification" ? "email verification" : "sign in";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const buildContent = ({ otp, purpose }) => ({
  subject: `PrimeBiller ${purpose} OTP`,
  text: [
    `Your PrimeBiller ${purpose} OTP is: ${otp}`,
    "",
    "This code expires in 5 minutes.",
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n"),
  html: `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
      <h2>PrimeBiller ${escapeHtml(purpose)}</h2>
      <p>Your one-time password is:</p>
      <p style="font-size:30px;font-weight:700;letter-spacing:8px">${escapeHtml(otp)}</p>
      <p>This code expires in 5 minutes.</p>
      <p>If you did not request this code, you can safely ignore this email.</p>
    </div>
  `,
});

// "Name <addr@x.com>" or "addr@x.com" -> { name, email }
const parseFrom = (value) => {
  const match = String(value || "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: String(value || "").trim() };
};

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error?.message || data?.raw || response.statusText);
      error.responseCode = response.status;
      error.code = "HTTP_" + response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaBrevo({ email, content }) {
  const sender = parseFrom(mailFrom);
  if (!sender.email) throw new Error("MAIL_FROM is required when using Brevo (must be a verified sender).");
  const data = await postJson(
    "https://api.brevo.com/v3/smtp/email",
    { "api-key": brevoKey },
    {
      sender,
      to: [{ email }],
      subject: content.subject,
      htmlContent: content.html,
      textContent: content.text,
    },
  );
  return { messageId: data?.messageId };
}

async function sendViaResend({ email, content }) {
  const from = mailFrom || "PrimeBiller <onboarding@resend.dev>";
  const data = await postJson(
    "https://api.resend.com/emails",
    { Authorization: `Bearer ${resendKey}` },
    { from, to: [email], subject: content.subject, html: content.html, text: content.text },
  );
  return { messageId: data?.id };
}

async function sendViaSmtp({ email, content }) {
  return transporter.sendMail({
    from: smtpFrom,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

export async function sendOtpEmail({ email, otp, type }) {
  const purpose = purposeFor(type);

  const logOtp = shouldLogOtp(email);

  // The configured dummy recipient is always logged so the test flow works on Render.
  // Other recipients follow the LOG_OTP flags above.
  if (logOtp) {
    console.log(`[otp] ${type} OTP generated for ${email}: ${otp} (provider=${provider})`);
  }

  if (provider === "none") return { skipped: true };

  if (isConsoleOnly(email)) {
    console.log(`[otp] Email skipped (OTP_CONSOLE_ONLY=true). Read the code above and enter it in the app.`);
    return { skipped: true, consoleOnly: true };
  }

  const content = buildContent({ otp, purpose });
  const send = provider === "brevo" ? sendViaBrevo : provider === "resend" ? sendViaResend : sendViaSmtp;

  try {
    const info = await send({ email, content });
    console.log(
      `OTP email sent: provider=${provider} type=${type} recipient=${email} messageId=${info?.messageId || "unknown"}`,
    );
    return info;
  } catch (error) {
    console.error(
      `OTP email send failed: provider=${provider} type=${type} recipient=${email} code=${error.code || "unknown"} responseCode=${error.responseCode || "unknown"} message=${error.message}`,
    );
    // Testing mode: the OTP is in the log, so keep the flow working instead of failing the request.
    if (logOtp) return { delivered: false, loggedOnly: true };
    throw error;
  }
}
