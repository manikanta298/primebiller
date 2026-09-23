import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;

const transporter = smtpHost
  ? nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
    })
  : null;

export async function sendOtpEmail({ email, otp, type }) {
  if (!transporter) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM before requesting an email OTP."
    );
  }

  const purpose =
    type === "forget-password"
      ? "password reset"
      : type === "email-verification"
        ? "email verification"
        : "sign in";

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `Girder ${purpose} OTP`,
    text: [
      `Your Girder ${purpose} OTP is: ${otp}`,
      "",
      "This code expires in 5 minutes.",
      "If you did not request this code, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
        <h2>Girder ${purpose}</h2>
        <p>Your one-time password is:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:8px">${otp}</p>
        <p>This code expires in 5 minutes.</p>
        <p>If you did not request this code, you can safely ignore this email.</p>
      </div>
    `,
  });
}
