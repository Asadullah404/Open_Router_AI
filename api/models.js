/**
 * Vercel Serverless Function / Express Handler
 * GET /api/models - Fetches all available models from OpenRouter.
 */
module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get key from client header or server env
  const authHeader = req.headers['authorization'];
  let apiKey = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7).trim();
  } else {
    apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': req.headers.referer || 'http://localhost:3000',
      'X-Title': 'OmniChat Professional'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).send(errorText);
    }

    const data = await response.json();
    return res.json(data);

  } catch (error) {
    console.error('Fetch models error:', error.message);
    return res.status(502).json({ error: `Failed to fetch models from OpenRouter: ${error.message}` });
  }
};
