// import nodemailer from 'nodemailer';
// import logger from './logger';

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST,
//   port: parseInt(process.env.SMTP_PORT || '587'),
//   secure: false, // true for 465, false for 587 (STARTTLS)
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
// });

// const FROM = process.env.EMAIL_FROM || 'Voicer AI <noreply@voicer.ai>';
// const CLIENT = process.env.CLIENT_URL || 'http://localhost:5173';

// const send = async (to: string, subject: string, html: string) => {
//   try {
//     await transporter.sendMail({ from: FROM, to, subject, html });
//     logger.info(`Email sent to ${to}: ${subject}`);
//   } catch (err) {
//     // Log but don't crash the request — email is non-critical path
//     logger.warn(`Failed to send email to ${to}`, { err });
//   }
// };

// const btn = (url: string, label: string) =>
//   `<a href="${url}" style="display:inline-block;background:#1BB8C4;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">${label}</a>`;

// const wrap = (body: string) => `
//   <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A2E">
//     <h2 style="color:#1BB8C4">Voicer AI</h2>
//     ${body}
//     <p style="color:#888;font-size:12px;margin-top:32px">Voicer AI — Audio Dataset Platform</p>
//   </div>`;

// export const sendVerificationEmail = (email: string, token: string) =>
//   send(email, 'Verify your Voicer AI account', wrap(`
//     <p>Thanks for signing up! Verify your email to get started.</p>
//     ${btn(`${CLIENT}/verify-email?token=${token}`, 'Verify Email')}
//     <p style="color:#888;font-size:13px">This link expires in 24 hours.</p>
//   `));

// export const sendPasswordResetEmail = (email: string, token: string) =>
//   send(email, 'Reset your Voicer AI password', wrap(`
//     <p>We received a request to reset your password.</p>
//     ${btn(`${CLIENT}/reset-password?token=${token}`, 'Reset Password')}
//     <p style="color:#888;font-size:13px">This link expires in 60 minutes. If you did not request this, ignore this email.</p>
//   `));

// export const sendInvitationEmail = (
//   email: string,
//   token: string,
//   projectName: string,
//   role: string,
//   inviterName: string
// ) =>
//   send(email, `You've been invited to join ${projectName} on Voicer AI`, wrap(`
//     <p><strong>${inviterName}</strong> has invited you to join <strong>${projectName}</strong> as a <strong>${role}</strong>.</p>
//     ${btn(`${CLIENT}/accept-invitation?token=${token}`, 'Accept Invitation')}
//     <p style="color:#888;font-size:13px">This invitation expires in 72 hours.</p>
//   `));

// export const sendReviewNotificationEmail = (
//   email: string,
//   status: string,
//   taskTitle: string,
//   feedback?: string | null
// ) => {
//   const approved = status === 'APPROVED';
//   return send(
//     email,
//     approved ? `Your recording for "${taskTitle}" was approved` : `Your recording for "${taskTitle}" needs revision`,
//     wrap(`
//       <p>Your submission for <strong>${taskTitle}</strong> has been <strong>${status}</strong>.</p>
//       ${feedback ? `<p><strong>Reviewer feedback:</strong> ${feedback}</p>` : ''}
//       ${btn(`${CLIENT}/dashboard`, 'View Dashboard')}
//     `)
//   );
// };

import { Resend } from 'resend';
import logger from './logger';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM    = process.env.EMAIL_FROM  || 'Voicer AI <onboarding@resend.dev>';
const CLIENT  = process.env.CLIENT_URL  || 'http://localhost:5173';

const send = async (to: string, subject: string, html: string) => {
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) throw new Error(error.message);
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.warn(`Failed to send email to ${to}`, { err });
  }
};

const btn = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;background:#1BB8C4;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">${label}</a>`;

const wrap = (body: string) => `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A2E">
    <h2 style="color:#1BB8C4">Voicer AI</h2>
    ${body}
    <p style="color:#888;font-size:12px;margin-top:32px">Voicer AI — Audio Dataset Platform</p>
  </div>`;

export const sendVerificationEmail = (email: string, token: string) =>
  send(email, 'Verify your Voicer AI account', wrap(`
    <p>Thanks for signing up! Click below to verify your email.</p>
    ${btn(`${CLIENT}/verify-email?token=${token}`, 'Verify Email')}
    <p style="color:#888;font-size:13px">Expires in 24 hours.</p>
  `));

export const sendPasswordResetEmail = (email: string, token: string) =>
  send(email, 'Reset your Voicer AI password', wrap(`
    <p>We received a request to reset your password.</p>
    ${btn(`${CLIENT}/reset-password?token=${token}`, 'Reset Password')}
    <p style="color:#888;font-size:13px">Expires in 60 minutes.</p>
  `));

export const sendInvitationEmail = (
  email: string, token: string,
  projectName: string, role: string, inviterName: string
) =>
  send(email, `You've been invited to join ${projectName} on Voicer AI`, wrap(`
    <p><strong>${inviterName}</strong> invited you to join <strong>${projectName}</strong> as <strong>${role}</strong>.</p>
    ${btn(`${CLIENT}/accept-invitation?token=${token}`, 'Accept Invitation')}
    <p style="color:#888;font-size:13px">Expires in 72 hours.</p>
  `));

export const sendReviewNotificationEmail = (
  email: string, status: string,
  taskTitle: string, feedback?: string | null
) =>
  send(
    email,
    status === 'APPROVED'
      ? `Your recording for "${taskTitle}" was approved`
      : `Your recording for "${taskTitle}" needs revision`,
    wrap(`
      <p>Your submission for <strong>${taskTitle}</strong> has been <strong>${status}</strong>.</p>
      ${feedback ? `<p><strong>Reviewer feedback:</strong> ${feedback}</p>` : ''}
      ${btn(`${CLIENT}/dashboard`, 'View Dashboard')}
    `)
  );