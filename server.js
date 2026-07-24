require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const chatHandler = require('./api/chat');
const modelsHandler = require('./api/models');
const configHandler = require('./api/config');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Parse incoming JSON bodies
app.use(express.json());

// Disable browser caching for static assets in development
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Serve static frontend assets from public/
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

/**
 * Route: GET /api/config
 * Serves public Firebase configuration read from .env
 */
app.get('/api/config', configHandler);

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

function startServer(port) {
  const server = app.listen(port, () => {
    console.log('================================================================');
    console.log(`🤖 OmniChat Professional Gateway is Live!`);
    console.log(`👉 Access Client Interface: http://localhost:${port}`);
    console.log(`🔑 OpenRouter & Firebase Integration: Ready`);
    console.log('================================================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is busy. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
