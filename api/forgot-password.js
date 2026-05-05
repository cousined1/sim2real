/**
 * Forgot Password API Route
 * POST /api/forgot-password
 * Body: { email: string }
 * 
 * Flow:
 * 1. Validate email
 * 2. Call n8n webhook to generate token + send email
 * 3. Return success (even if email doesn't exist for security)
 */

const crypto = require('crypto');

module.exports = async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }

    // Call n8n webhook
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    const n8nApiKey = process.env.N8N_API_KEY;

    if (n8nUrl) {
      await fetch(n8nUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': n8nApiKey
        },
        body: JSON.stringify({ email })
      }).catch(err => console.error('n8n webhook error:', err));
    }

    // Always return success (don't reveal if email exists)
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
