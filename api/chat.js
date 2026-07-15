/**
 * Helper to parse request bodies if not pre-parsed by the runner.
 */
async function getRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

/**
 * Fetch and return the list of currently active free models from OpenRouter.
 */
async function getActiveFreeModels() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) return [];
    
    const data = await response.json();
    const models = data.data || [];
    
    // OpenRouter free models have both prompt and completion pricing set to "0"
    return models
      .filter(m => m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0')
      .map(m => m.id);
  } catch (e) {
    console.error('Failed to retrieve dynamic free model list:', e.message);
    return [];
  }
}

/**
 * Perform a single chat completion query to OpenRouter.
 */
async function attemptChatCompletion(model, messages, apiKey, temperature) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'OmniChat Professional'
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature ?? 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError;
    try {
      parsedError = JSON.parse(errorText);
    } catch (e) {}
    const errMsg = parsedError?.error?.message || errorText || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  return await response.json();
}

/**
 * Vercel Serverless Function / Express Handler
 * POST /api/chat - Forwards message history with automated free-model fallbacks.
 */
module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Extract API key
  const authHeader = req.headers['authorization'];
  let apiKey = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7).trim();
  } else {
    apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Authorization API Key is required. Please set it in the sidebar.' });
  }

  const body = await getRequestBody(req);
  const { model, messages, temperature } = body;

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing required parameters: "model" or "messages".' });
  }

  const isFreeRequest = model === 'auto-free' || model.endsWith(':free');

  // Try the selected model first
  try {
    const initialModel = model === 'auto-free' ? 'google/gemini-2.5-flash:free' : model;
    console.log(`Primary routing attempt: ${initialModel}`);
    const result = await attemptChatCompletion(initialModel, messages, apiKey, temperature);
    result.model_used = initialModel;
    return res.json(result);
  } catch (initialError) {
    console.warn(`Primary model request failed: ${initialError.message}`);

    // If it's not a free model request, return the error immediately
    if (!isFreeRequest) {
      return res.status(502).json({ error: initialError.message });
    }

    // Otherwise, attempt dynamic fallback routing to other free models
    console.log('Initiating dynamic free model failover...');
    let freeModelsList = await getActiveFreeModels();
    
    // Filter out the model that just failed to avoid infinite loops
    freeModelsList = freeModelsList.filter(m => m !== model);

    if (freeModelsList.length === 0) {
      // Fallback presets
      freeModelsList = [
        'google/gemini-2.5-flash:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'qwen/qwen-2.5-72b-instruct:free'
      ].filter(m => m !== model);
    }

    let lastError = initialError;

    for (const fallbackModel of freeModelsList) {
      try {
        console.log(`Failover routing attempt: Trying ${fallbackModel}`);
        const result = await attemptChatCompletion(fallbackModel, messages, apiKey, temperature);
        result.model_used = fallbackModel;
        return res.json(result);
      } catch (err) {
        console.warn(`Failover model ${fallbackModel} failed: ${err.message}`);
        lastError = err;
      }
    }

    // Return the aggregated error if everything failed
    return res.status(502).json({ 
      error: `All active OpenRouter free models failed. Last error: ${lastError.message}` 
    });
  }
};
