# OmniChat // Premium OpenRouter AI Chat Client

A premium, dark-themed developer sandbox designed to query any Large Language Model (LLM) supported by OpenRouter (such as Google Gemini, Anthropic Claude, OpenAI GPT, and DeepSeek) using your OpenRouter API key.

## Technology Stack

- **Backend:** Node.js, Express (serving static assets and providing a secure API gateway/CORS-bridge)
- **Frontend:** HTML5, CSS3 (ambient gradient spheres, customized inputs, responsive grids), Vanilla JS (local state, chat histories, markdown parser, model sync)

---

## Key Features

1. **Seamless API Key Integration:** Input your OpenRouter API key on the frontend sidebar (masked for privacy). The key is stored locally in your browser (`localStorage`) and never written to server logs.
2. **Dynamic Model Synchronization:** Retrieve and populate active models directly from the OpenRouter endpoints. Includes fallback presets for popular models.
3. **Local History Management:** Conversations, settings, and model selections are automatically persisted to the browser's local cache. 
4. **Rich Dialogues:** Bubbles are custom-styled to support paragraphs, inline code, fenced code blocks, and markdown emphasis.
5. **Zero-Lock Cloud Parity:** Configured out-of-the-box for serverless deployment on Vercel or local hosting.

---

## How to Run Locally

### 1. Install Dependencies
Run the standard dependency installer inside the project directory:

```bash
npm install
```

### 2. Launch the Application
Start the Node.js/Express server wrapper:

```bash
npm start
```
*(On Windows systems where script execution is restricted, run `npm.cmd start` instead).*

### 3. Open the Dashboard
Open your web browser and navigate to:
[http://localhost:3000](http://localhost:3000)

---

## Cloud Deployment (Vercel)

This project can be deployed instantly to Vercel. Vercel will host the frontend folder (`public/`) statically and automatically execute `/api/chat.js` and `/api/models.js` as serverless functions.

1. **Option 1: Vercel CLI**
   ```bash
   npm i -g vercel
   vercel
   ```
2. **Option 2: Git Integration**
   Link this repository directly within the Vercel Dashboard for automated CI/CD builds on push.
