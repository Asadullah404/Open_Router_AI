require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const chatHandler = require('./api/chat');
const modelsHandler = require('./api/models');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Parse incoming JSON bodies
app.use(express.json());

// Serve static frontend assets from public/
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Route: GET /api/models
 * Delegates to serverless models handler
 */
app.get('/api/models', modelsHandler);

/**
 * Route: POST /api/chat
 * Delegates to serverless chat completions handler
 */
app.post('/api/chat', chatHandler);

// Serve frontend client index for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🤖 OmniChat Professional Gateway is Live!`);
  console.log(`👉 Access Client Interface: http://localhost:${PORT}`);
  console.log(`🔑 OpenRouter integration: Enabled`);
  console.log('================================================================');
});
