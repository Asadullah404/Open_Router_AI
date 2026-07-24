/**
 * Vercel Serverless Function / Express Handler
 * POST /api/chat - Dynamic Multi-Key Failover & Zero-Cost Free Model Fallback
 */

// Fallback zero-cost free models verified on OpenRouter
const DYNAMIC_FREE_MODELS = [
  'openrouter/free',
  'google/gemini-2.0-flash-lite-preview-02-05:free',
  'google/gemini-2.0-pro-exp-02-05:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'mistralai/mistral-7b-instruct:free'
];

async function getRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(bodyData || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

async function attemptChatCompletion(model, messages, apiKey, temperature = 0.7) {
  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'OmniChat Ultra'
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature
    })
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const errorMsg = errorJson?.error?.message || errorJson?.message || `HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  return await response.json();
}

async function getActiveFreeModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) return DYNAMIC_FREE_MODELS;
    const data = await res.json();
    const liveFree = (data.data || [])
      .filter(m => (m.id === 'openrouter/free' || m.id.endsWith(':free') || (m.pricing && (m.pricing.prompt === '0' || parseFloat(m.pricing.prompt) === 0))))
      .map(m => m.id);
    return liveFree.length ? ['openrouter/free', ...liveFree.filter(id => id !== 'openrouter/free')] : DYNAMIC_FREE_MODELS;
  } catch (e) {
    return DYNAMIC_FREE_MODELS;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Keys');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const body = await getRequestBody(req);
  const { model, messages, temperature, apiKeys: bodyKeys } = body;

  let keysToTry = [];

  const headerKeys = req.headers['x-api-keys'];
  if (headerKeys) {
    try {
      if (headerKeys.startsWith('[')) {
        keysToTry = JSON.parse(headerKeys);
      } else {
        keysToTry = headerKeys.split(',').map(k => k.trim());
      }
    } catch (e) {}
  }

  if (keysToTry.length === 0 && Array.isArray(bodyKeys) && bodyKeys.length > 0) {
    keysToTry = bodyKeys.map(k => String(k).trim()).filter(Boolean);
  }

  if (keysToTry.length === 0) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      keysToTry = [authHeader.substring(7).trim()];
    }
  }

  if (keysToTry.length === 0 && process.env.OPENROUTER_API_KEY) {
    keysToTry = [process.env.OPENROUTER_API_KEY.trim()];
  }

  keysToTry = [...new Set(keysToTry.filter(k => k && k.length > 5))].slice(0, 5);

  if (keysToTry.length === 0) {
    return res.status(401).json({ error: 'OpenRouter API Key is required. Get a free key at openrouter.ai/keys and paste it into Settings ⚙️.' });
  }

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing required parameters: "model" or "messages".' });
  }

  const isFreeRequest = model === 'auto-free' || model.endsWith(':free') || model === 'openrouter/free';
  const initialModel = model === 'auto-free' ? 'openrouter/free' : model;

  let lastKeyError = null;

  // Primary attempt
  for (let i = 0; i < keysToTry.length; i++) {
    const currentKey = keysToTry[i];
    try {
      const result = await attemptChatCompletion(initialModel, messages, currentKey, temperature);
      result.model_used = initialModel;
      result.key_index_used = i + 1;
      result.reply = result.choices?.[0]?.message?.content || result.reply || '';
      return res.json(result);
    } catch (err) {
      console.warn(`Key #${i + 1} failed for ${initialModel}: ${err.message}`);
      lastKeyError = err;
    }
  }

  // Dynamic Zero-Cost Free Failover across all active free models
  if (isFreeRequest) {
    let freeModelsList = await getActiveFreeModels();
    freeModelsList = freeModelsList.filter(m => m !== initialModel);

    for (const fallbackModel of freeModelsList) {
      for (let i = 0; i < keysToTry.length; i++) {
        try {
          const result = await attemptChatCompletion(fallbackModel, messages, keysToTry[i], temperature);
          result.model_used = fallbackModel;
          result.key_index_used = i + 1;
          result.reply = result.choices?.[0]?.message?.content || result.reply || '';
          return res.json(result);
        } catch (err) {
          lastKeyError = err;
        }
      }
    }
  }

  return res.status(502).json({ 
    error: `Request failed. OpenRouter error: ${lastKeyError?.message || 'Unknown error'}` 
  });
};
