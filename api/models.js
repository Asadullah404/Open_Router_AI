/**
 * Vercel Serverless Function / Express Handler
 * GET /api/models - Dynamic, precise categorization of all 340+ OpenRouter models.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
      'X-Title': 'OmniChat Ultra'
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
    const rawModels = data.data || [];

    const mapModel = m => ({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length
    });

    // Helper to check if a model is zero cost free
    const isZeroCost = m => (
      m.id === 'openrouter/free' ||
      m.id.endsWith(':free') ||
      (m.pricing && (m.pricing.prompt === '0' || parseFloat(m.pricing.prompt) === 0) && (m.pricing.completion === '0' || parseFloat(m.pricing.completion) === 0))
    );

    // 1. Zero Cost Free Models (Always include Gemini Flash Free at top)
    const presetGeminiFree = [
      { id: 'auto-free', name: '⚡ Auto-select Best Free Model (openrouter/free)' },
      { id: 'google/gemini-2.0-flash-lite-preview-02-05:free', name: 'Google Gemini 2.0 Flash Lite (Free)' },
      { id: 'google/gemini-2.0-pro-exp-02-05:free', name: 'Google Gemini 2.0 Pro Exp (Free)' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta Llama 3.3 70B (Free)' },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)' }
    ];

    const rawFree = rawModels
      .filter(isZeroCost)
      .map(mapModel)
      .filter(m => !presetGeminiFree.some(pf => pf.id === m.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    const freeModels = [
      ...presetGeminiFree,
      ...rawFree
    ];

    // 2. Google Models (Gemini, Gemma, Lyria) A-Z
    const googleModels = rawModels
      .filter(m => m.id.startsWith('google/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 3. DeepSeek Models A-Z
    const deepseekModels = rawModels
      .filter(m => m.id.startsWith('deepseek/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 4. Anthropic Claude Models A-Z
    const anthropicModels = rawModels
      .filter(m => m.id.startsWith('anthropic/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 5. OpenAI Models A-Z
    const openaiModels = rawModels
      .filter(m => m.id.startsWith('openai/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 6. Meta Llama Models A-Z
    const llamaModels = rawModels
      .filter(m => m.id.startsWith('meta-llama/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 7. NVIDIA Models A-Z
    const nvidiaModels = rawModels
      .filter(m => m.id.startsWith('nvidia/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 8. Qwen Models A-Z
    const qwenModels = rawModels
      .filter(m => m.id.startsWith('qwen/'))
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    // 9. All OpenRouter Models A-Z
    const allModels = rawModels
      .map(mapModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      freeModels,
      googleModels,
      deepseekModels,
      anthropicModels,
      openaiModels,
      llamaModels,
      nvidiaModels,
      qwenModels,
      allModels
    });

  } catch (error) {
    console.error('Fetch models error:', error.message);
    return res.status(502).json({ error: `Failed to fetch models from OpenRouter: ${error.message}` });
  }
};
