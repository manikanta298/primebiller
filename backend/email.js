import nodemailer from "nodemailer";

const smtpHost = String(process.env.SMTP_HOST || "").trim();
const smtpUser = String(process.env.SMTP_USER || "").trim();
const smtpPassword = String(process.env.SMTP_PASSWORD || "");
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpFrom = String(process.env.SMTP_FROM || "").trim() || smtpUser;

const transporter = smtpHost
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: smtpUser
        ? {
            user: smtpUser,
            pass: smtpPassword,
          }
        : undefined,
    })
  : null;

if (transporter) {
  transporter
    .verify()
    .then(() => {
      console.log(
        `SMTP connection verified: host=${smtpHost} port=${smtpPort} secure=${smtpSecure} user=${smtpUser ? "configured" : "missing"}`,
      );
    })
    .catch((error) => {
      console.error("SMTP connection verification failed:", error.message);
    });
} else {
  console.warn("SMTP is not configured: SMTP_HOST is missing. OTP emails will only be logged in development.");
}

export async function sendOtpEmail({ email, otp, type }) {
  if (!transporter) {
    // Keep the OTP visible only when SMTP is intentionally not configured.
    console.log(`[dev] ${type} OTP generated for ${email}: ${otp}`);
    return;
  }

  const purpose =
    type === "forget-password"
      ? "password reset"
      : type === "email-verification"
        ? "email verification"
        : "sign in";

  try {
    const info = await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: `PrimeBiller ${purpose} OTP`,
      text: [
        `Your PrimeBiller ${purpose} OTP is: ${otp}`,
        "",
        "This code expires in 5 minutes.",
        "If you did not request this code, you can safely ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
          <h2>PrimeBiller ${purpose}</h2>
          <p>Your one-time password is:</p>
          <p style="font-size:30px;font-weight:700;letter-spacing:8px">${otp}</p>
          <p>This code expires in 5 minutes.</p>
          <p>If you did not request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    console.log(
      `OTP email sent: type=${type} recipient=${email} messageId=${info.messageId || "unknown"}`,
    );
    return info;
  } catch (error) {
    console.error(
      `OTP email send failed: type=${type} recipient=${email} code=${error.code || "unknown"} responseCode=${error.responseCode || "unknown"} message=${error.message}`,
    );
    throw error;
  }
}
