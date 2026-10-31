import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { Resend } from "resend";
import { getDb, schema } from "@/db/client";

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

const from = process.env.RESEND_FROM ?? "Made Of <login@madeof.app>";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
    },
  }),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: false },
  user: {
    additionalFields: {
      tier: { type: "string", defaultValue: "free", input: false },
      ageConfirmedAt: { type: "date", required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    cookiePrefix: "madeof",
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        if (!process.env.RESEND_API_KEY) {
          console.log(`[auth] magic link for ${email}: ${url}`);
          return;
        }
        const { error } = await resend.emails.send({
          from,
          to: email,
          subject: "Your Made Of sign-in link",
          text: [
            "Made Of — Everything is made of something.",
            "",
            "Here's your sign-in link. It expires in 15 minutes and can only be used once:",
            "",
            url,
            "",
            "Didn't ask for this? You can ignore the email — the link won't do anything until it's clicked.",
            "",
            "madeof.app",
          ].join("\n"),
          html: magicLinkEmail(url),
        });
        if (error) {
          throw new Error(`Resend error: ${error.message}`);
        }
      },
    }),
  ],
});

/**
 * Magic-link email. Styled to match the app's "phero" section: Chivo display
 * font (falling back to Helvetica), a mono eyebrow, a thick ink border on the
 * CTA, and the app's light-theme palette from globals.css. Dark-mode is left
 * off intentionally — too many email clients mangle it.
 *
 * All styles are inline because Gmail strips <style>. Chivo is loaded via a
 * <link>, which Gmail does respect; clients that strip it fall back to
 * Helvetica/Arial and the layout still works.
 */
function magicLinkEmail(url: string): string {
  const bg = "#F2F3EF";
  const surface = "#FFFFFF";
  const ink = "#111417";
  const muted = "#4A4F55";
  const line = "#B9BCB4";
  const accent = "#2B3FB5";
  // Humans are tier N (natural), living kind. Pastel green tile + ink border
  // matches the app's chip for the "humans" item.
  const tileFill = "#B5DDA4";
  const display =
    "'Chivo', 'Helvetica Neue', Arial, system-ui, sans-serif";
  const mono = "'Chivo Mono', ui-monospace, 'SF Mono', Menlo, monospace";

  // Gmail web blocks data: URIs in <img src>, so we host the pictogram as
  // a PNG under /public/email/. The URL must be a public origin reachable
  // by Gmail's image proxy. For local testing without a public URL, the
  // tile falls back to the pastel-fill background + text label.
  // Regenerate the PNG by running: node scripts/build-email-pictograms.mjs
  const emailAssetBase =
    process.env.EMAIL_ASSET_BASE ?? process.env.BETTER_AUTH_URL ?? "";
  const humansSrc = emailAssetBase
    ? `${emailAssetBase.replace(/\/$/, "")}/email/humans.png`
    : "";

  // Full element card for "you", mirroring the Explore chips: pastel-tier
  // tile with the humans pictogram, mono name tag beside it, ink border.
  // The PNG itself includes the tile background and border, so the <td>
  // just needs to size and position it. If the image fails to load, the
  // alt text still reads sensibly next to the name.
  const youCard = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;"><tr>
    <td width="72" height="72" style="width:72px;height:72px;padding:0;vertical-align:middle;" valign="middle"><img src="${humansSrc}" width="72" height="72" alt="You" style="display:block;width:72px;height:72px;border:0;outline:none;text-decoration:none;background:${tileFill};border-radius:4px;" /></td>
    <td style="padding-left:12px;vertical-align:middle;" valign="middle">
      <div style="font-family:${display};font-weight:700;font-size:18px;letter-spacing:-0.01em;color:${ink};line-height:1;">You</div>
      <div style="font-family:${mono};font-size:10.5px;letter-spacing:0.09em;text-transform:uppercase;color:${muted};margin-top:5px;">Natural &middot; Living</div>
    </td>
  </tr></table>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Sign in to Made Of</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;500;700;800&family=Chivo+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background:${bg};color:${ink};font-family:${display};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your sign-in link for Made Of. Expires in 15 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:540px;">
            <tr>
              <td style="padding:0 4px 20px 4px;">
                <div style="font-family:${display};font-weight:800;font-size:30px;letter-spacing:-0.02em;line-height:1;color:${ink};">Made Of</div>
                <div style="font-family:${mono};font-size:12px;color:${muted};letter-spacing:0.04em;margin-top:6px;">Everything is made of something.</div>
              </td>
            </tr>
            <tr>
              <td style="background:${surface};border:1px solid ${line};padding:36px 32px;">
                ${youCard}
                <div style="font-family:${mono};font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:${muted};margin-bottom:14px;">Sign in</div>
                <h1 style="margin:0 0 14px 0;font-family:${display};font-weight:800;font-size:28px;letter-spacing:-0.025em;line-height:1.08;color:${ink};">Here&rsquo;s your sign-in link.</h1>
                <p style="margin:0 0 28px 0;font-family:${display};font-size:15px;line-height:1.5;color:${ink};">Click the button to sign in. The link expires in 15 minutes and can only be used once.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
                  <tr>
                    <td style="background:${ink};border:1.5px solid ${ink};border-radius:4px;">
                      <a href="${url}" style="display:inline-block;padding:12px 22px;font-family:${display};font-weight:600;font-size:15px;color:${bg};text-decoration:none;letter-spacing:-0.005em;">Sign in to Made Of</a>
                    </td>
                  </tr>
                </table>
                <div style="font-family:${mono};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${muted};margin:0 0 8px 0;">Or paste this link</div>
                <div style="font-family:${mono};font-size:12.5px;color:${accent};word-break:break-all;line-height:1.5;">${url}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0 4px;font-family:${display};font-size:12.5px;line-height:1.5;color:${muted};">
                Didn&rsquo;t ask for this? You can safely ignore the email &mdash; the link won&rsquo;t do anything until it&rsquo;s clicked.
              </td>
            </tr>
            <tr>
              <td style="padding:24px 4px 0 4px;border-top:1px solid ${line};margin-top:24px;font-family:${mono};font-size:11px;letter-spacing:0.06em;color:${muted};">
                MADE OF &middot; <a href="https://madeof.app" style="color:${muted};text-decoration:none;">madeof.app</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type Session = typeof auth.$Infer.Session;
