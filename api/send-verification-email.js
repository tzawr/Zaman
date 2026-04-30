export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, token, origin } = req.body
  if (!email || !token) return res.status(400).json({ error: 'Missing email or token' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Email service not configured' })

  const verifyUrl = `${origin || 'https://hengam.app'}/verify-email/${token}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f13;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#18181f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Hengam</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Scheduling</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Verify your email</p>
            <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6;">
              Thanks for signing up for Hengam. Click the button below to verify your email address and activate your account.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#bfdbfe,#60a5fa,#2563eb);border-radius:10px;">
                  <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;">
                    Verify my email &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">
              Or copy this link into your browser:
            </p>
            <p style="margin:0 0 28px;font-size:12px;color:#4f46e5;word-break:break-all;background:#1e1e2a;border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:12px 14px;">
              ${verifyUrl}
            </p>

            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
              This link expires in <strong style="color:#9ca3af;">24 hours</strong>. If you didn't create a Hengam account, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:12px;color:#4b5563;">
              © 2026 Hengam · Built in Irvine, CA<br>
              <span style="color:#374151;">You're receiving this because you created a Hengam account with ${email}</span>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hengam <onboarding@resend.dev>',
        to: [email],
        subject: 'Verify your Hengam account',
        html,
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('Resend error:', err)
      return res.status(500).json({ error: 'Failed to send email' })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Send error:', err)
    return res.status(500).json({ error: 'Failed to send email' })
  }
}
