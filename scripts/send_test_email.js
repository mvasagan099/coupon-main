#!/usr/bin/env node
// Simple Resend test sender
// Usage: set RESEND_API_KEY (or VITE_RESEND_API_KEY) and run:
//   node scripts/send_test_email.js recipient@example.com

(async () => {
  const key = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
  if (!key) {
    console.error('Missing API key. Set RESEND_API_KEY or VITE_RESEND_API_KEY in your environment.');
    process.exit(1);
  }

  const to = process.argv[2];
  if (!to) {
    console.error('Usage: node scripts/send_test_email.js recipient@example.com');
    process.exit(1);
  }

  const from = process.env.RESEND_FROM || 'no-reply@yourdomain.com';
  const subject = process.env.RESEND_SUBJECT || 'Resend test email from CouponVault';
  const html = process.env.RESEND_HTML || '<p>This is a test email sent via <strong>Resend</strong>.</p>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('Resend API returned an error:', res.status, payload);
      process.exit(2);
    }

    console.log('Email send request accepted:', payload);
    console.log('Check your inbox and Resend dashboard for delivery status.');
  } catch (err) {
    console.error('Failed to call Resend API:', err instanceof Error ? err.message : err);
    process.exit(3);
  }
})();
