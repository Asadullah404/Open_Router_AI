document.addEventListener('DOMContentLoaded', () => {
  // ── Theme ───────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('omnichat_theme', theme);
    themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
    themeToggle.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
  }

  applyTheme(root.getAttribute('data-theme') || 'dark');

  themeToggle.addEventListener('click', (e) => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduceMotion) {
      applyTheme(next);
      return;
    }

    // Circular reveal that grows out of the switch itself.
    const rect = themeToggle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => applyTheme(next));
    transition.ready.then(() => {
      root.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]
        },
        {
          duration: 620,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    });
  });

  // ── Toasts (replaces alert) ─────────────────────────────────────────────────
  const toastHost = document.getElementById('toast-host');

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 3200);
  }

  // ── Mobile drawer ───────────────────────────────────────────────────────────
  const menuBtn = document.getElementById('menu-btn');
  const sidebarScrim = document.getElementById('sidebar-scrim');

  menuBtn.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  sidebarScrim.addEventListener('click', () => document.body.classList.remove('sidebar-open'));

  // Elements
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const messagesContainer = document.getElementById('messages-container');
  const emptyState = document.getElementById('empty-state');
  const typingIndicator = document.getElementById('typing-indicator');
  
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
  const modelSelector = document.getElementById('model-selector');
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const dynamicModelsGroup = document.getElementById('dynamic-models-group');
  const tempSlider = document.getElementById('temp-slider');
  const tempValue = document.getElementById('temp-value');
  
  const newChatBtn = document.getElementById('new-chat-btn');
  const chatList = document.getElementById('chat-list');
  const activeChatTitle = document.getElementById('active-chat-title');
  const activeModelName = document.getElementById('active-model-name');
  const clearCurrentChatBtn = document.getElementById('clear-current-chat-btn');
  const customModelGroup = document.getElementById('custom-model-group');
  const customModelInput = document.getElementById('custom-model-input');

  // App State
  let conversations = JSON.parse(localStorage.getItem('omnichat_sessions')) || [];
  let currentSessionId = localStorage.getItem('omnichat_active_session_id') || null;

  // Initialize Configurations
  loadApiKey();
  loadTemperature();
  fetchModels();
  renderHistoryList();

  // Load active session
  if (currentSessionId) {
    loadSession(currentSessionId);
  } else {
    createNewSession();
  }

  // ── API Key Management ──────────────────────────────────────────────────────
  function loadApiKey() {
    const key = localStorage.getItem('omnichat_api_key');
    if (key) apiKeyInput.value = key;
  }

  apiKeyInput.addEventListener('input', () => {
    localStorage.setItem('omnichat_api_key', apiKeyInput.value.trim());
  });

  toggleKeyVisibility.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibility.title = isPassword ? 'Hide key' : 'Show key';
    toggleKeyVisibility.setAttribute('aria-label', toggleKeyVisibility.title);
  });

  // ── Temperature Config ──────────────────────────────────────────────────────
  function loadTemperature() {
    const temp = localStorage.getItem('omnichat_temperature');
    if (temp) {
      tempSlider.value = temp;
      tempValue.textContent = temp;
    }
  }

  tempSlider.addEventListener('input', () => {
    tempValue.textContent = tempSlider.value;
    localStorage.setItem('omnichat_temperature', tempSlider.value);
  });

  // ── Fetch OpenRouter Models ─────────────────────────────────────────────────
  async function fetchModels() {
    refreshModelsBtn.classList.add('spinning');
    const apiKey = apiKeyInput.value.trim();
    
    try {
      const headers = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch('/api/models', { headers });
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const resData = await response.json();
      const models = resData.data || [];
      
      dynamicModelsGroup.innerHTML = '';
      
      // Filter & sort models
      models
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(model => {
          const opt = document.createElement('option');
          opt.value = model.id;
          opt.textContent = `${model.name} (${model.id.split('/')[0]})`;
          dynamicModelsGroup.appendChild(opt);
        });

    } catch (err) {
      console.warn('Could not load dynamic OpenRouter models list, falling back.', err);
    } finally {
      refreshModelsBtn.classList.remove('spinning');
    }
  }

  refreshModelsBtn.addEventListener('click', fetchModels);

  // ── Textarea Auto-Grow (animated, Gemini-style) ─────────────────────────────
  const inputBar = document.querySelector('.chat-input-bar');
  const MAX_INPUT_HEIGHT = 260; // px — beyond this the field scrolls instead
  const BASE_INPUT_HEIGHT = 26; // px — one line

  function autoGrowInput() {
    const previous = chatInput.style.height;

    // Measure the natural content height without animating the measurement.
    chatInput.style.transition = 'none';
    chatInput.style.height = 'auto';
    const contentHeight = chatInput.scrollHeight;

    // Snap back to where we were, flush the layout, then animate to the new height.
    chatInput.style.height = previous || BASE_INPUT_HEIGHT + 'px';
    void chatInput.offsetHeight;
    chatInput.style.transition = '';

    const nextHeight = Math.min(contentHeight, MAX_INPUT_HEIGHT);
    chatInput.style.height = nextHeight + 'px';

    // Corners tighten as the box grows; scrolling only kicks in at the ceiling.
    inputBar.classList.toggle('expanded', contentHeight > BASE_INPUT_HEIGHT + 12);
    chatInput.classList.toggle('scrollable', contentHeight > MAX_INPUT_HEIGHT);
  }

  // Auto-grow disabled: input box is locked to a fixed single-line height.
  // Previous lines scroll out of view.
  function resetInputHeight() {
    chatInput.style.height = BASE_INPUT_HEIGHT + 'px';
    inputBar.classList.remove('expanded');
    chatInput.classList.remove('scrollable');
  }

  resetInputHeight();

  // Handle Enter to Submit, Shift+Enter for new line
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  // ── Conversation Management ─────────────────────────────────────────────────
  function saveSessions() {
    localStorage.setItem('omnichat_sessions', JSON.stringify(conversations));
    if (currentSessionId) {
      localStorage.setItem('omnichat_active_session_id', currentSessionId);
    }
  }

  // Load Custom model inputs on key change
  customModelInput.addEventListener('input', () => {
    const session = conversations.find(c => c.id === currentSessionId);
    if (session && modelSelector.value === 'custom') {
      session.model = 'custom:' + customModelInput.value.trim();
      activeModelName.textContent = customModelInput.value.trim().split('/').pop() || 'custom';
      saveSessions();
    }
  });

  function createNewSession() {
    const newId = 'session_' + Date.now();
    const newSession = {
      id: newId,
      title: 'New Conversation',
      model: modelSelector.value === 'custom' ? ('custom:' + customModelInput.value.trim()) : (modelSelector.value || 'auto-free'),
      messages: []
    };
    
    conversations.unshift(newSession);
    currentSessionId = newId;
    saveSessions();
    renderHistoryList();
    loadSession(newId);
  }

  newChatBtn.addEventListener('click', createNewSession);

  function loadSession(id) {
    currentSessionId = id;
    const session = conversations.find(c => c.id === id);
    if (!session) return;

    // Update active UI details
    activeChatTitle.textContent = session.title;
    
    // Parse model: if it starts with 'custom:', it's a custom model ID
    const modelToLoad = session.model || 'auto-free';
    if (modelToLoad.startsWith('custom:')) {
      const customId = modelToLoad.substring(7);
      modelSelector.value = 'custom';
      customModelInput.value = customId;
      customModelGroup.style.display = 'block';
      activeModelName.textContent = customId.split('/').pop() || 'custom';
    } else {
      modelSelector.value = modelToLoad;
      customModelGroup.style.display = 'none';
      activeModelName.textContent = modelToLoad.split('/').pop();
    }
    
    // Highlight sidebar
    document.querySelectorAll('.chat-history-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-id') === id);
    });

    renderMessages(session.messages || []);
    saveSessions();
  }

  function deleteSession(id, event) {
    event.stopPropagation();
    conversations = conversations.filter(c => c.id !== id);
    
    if (currentSessionId === id) {
      currentSessionId = conversations.length ? conversations[0].id : null;
    }
    
    saveSessions();
    renderHistoryList();
    
    if (currentSessionId) {
      loadSession(currentSessionId);
    } else {
      createNewSession();
    }
  }

  function renderHistoryList() {
    chatList.innerHTML = '';
    
    conversations.forEach(session => {
      const li = document.createElement('li');
      li.className = `chat-history-item ${session.id === currentSessionId ? 'active' : ''}`;
      li.setAttribute('data-id', session.id);
      li.textContent = session.title;
      
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-session-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete chat';
      delBtn.addEventListener('click', (e) => deleteSession(session.id, e));
      
      li.appendChild(delBtn);
      li.addEventListener('click', () => {
        loadSession(session.id);
        document.body.classList.remove('sidebar-open');
      });
      
      chatList.appendChild(li);
    });
  }

  clearCurrentChatBtn.addEventListener('click', () => {
    const session = conversations.find(c => c.id === currentSessionId);
    if (session) {
      session.messages = [];
      session.title = 'New Conversation';
      saveSessions();
      renderHistoryList();
      loadSession(currentSessionId);
    }
  });

  // ── Render Messages ─────────────────────────────────────────────────────────
  function renderMessages(messages) {
    messagesContainer.innerHTML = '';

    // The empty state lives inside the container, so re-attach it after clearing.
    messagesContainer.appendChild(emptyState);

    if (messages.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    
    messages.forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `message ${msg.role}`;
      
      const avatar = document.createElement('div');
      avatar.className = 'avatar-icon';
      avatar.textContent = msg.role === 'user' ? 'U' : 'AI';
      
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = formatMarkdown(msg.content);
      
      msgDiv.appendChild(avatar);
      msgDiv.appendChild(bubble);
      
      messagesContainer.appendChild(msgDiv);
    });
    
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Simple Markdown parser supporting code blocks with languages and Canvas trigger
  function formatMarkdown(text) {
    if (!text) return '';
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code Blocks with explicit language: ```javascript ... ```
    escaped = escaped.replace(/```(\w+)\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang.trim().toLowerCase();
      const cleanCode = code.trim();
      return `<pre><code class="language-${language}">${cleanCode}</code></pre>
              <button class="view-canvas-btn" data-lang="${language}">🖥️ View in Canvas</button>`;
    });

    // Fallback Code Blocks: ```code```
    escaped = escaped.replace(/```([\s\S]*?)```/g, (match, code) => {
      const cleanCode = code.trim();
      return `<pre><code class="language-txt">${cleanCode}</code></pre>
              <button class="view-canvas-btn" data-lang="txt">🖥️ View in Canvas</button>`;
    });

    // Inline Code: `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold text: **text**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Line breaks
    escaped = escaped.replace(/\n/g, '<br>');

    return escaped;
  }

  // ── Submit Message ──────────────────────────────────────────────────────────
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = chatInput.value.trim();
    if (!prompt) return;

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      toast('Add your OpenRouter API key in the sidebar to send messages.');
      document.body.classList.add('sidebar-open');
      apiKeyInput.focus();
      return;
    }

    const session = conversations.find(c => c.id === currentSessionId);
    if (!session) return;

    // Reset Input heights
    chatInput.value = '';
    resetInputHeight();

    // Append User Message to local state
    session.messages.push({ role: 'user', content: prompt });
    
    // Auto name conversation based on first prompt if title is default
    if (session.title === 'New Conversation' && session.messages.length === 1) {
      session.title = prompt.length > 24 ? prompt.substring(0, 24) + '...' : prompt;
      renderHistoryList();
    }

    // Save and re-render
    const resolvedModel = modelSelector.value === 'custom' 
      ? 'custom:' + customModelInput.value.trim() 
      : modelSelector.value;
      
    session.model = resolvedModel;
    activeModelName.textContent = resolvedModel.startsWith('custom:') 
      ? resolvedModel.substring(7).split('/').pop() 
      : resolvedModel.split('/').pop();
      
    renderMessages(session.messages);
    
    // Toggle typing indicator loading state
    typingIndicator.style.display = 'flex';
    scrollToBottom();
    
    try {
      const modelToSend = resolvedModel.startsWith('custom:') 
        ? resolvedModel.substring(7) 
        : resolvedModel;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelToSend,
          messages: session.messages,
          temperature: parseFloat(tempSlider.value)
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const aiReply = data.choices?.[0]?.message?.content || 'No response returned from the model.';

      // Append assistant response
      session.messages.push({ role: 'assistant', content: aiReply });
      renderMessages(session.messages);

    } catch (err) {
      console.error(err);
      session.messages.push({ 
        role: 'assistant', 
        content: `❌ **Failed to retrieve response from OpenRouter.**\nDetails: ${err.message}` 
      });
      renderMessages(session.messages);
    } finally {
      typingIndicator.style.display = 'none';
      saveSessions();
    }
  });

  // Handle Quick Starts
  document.querySelectorAll('.quick-start-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.textContent;
      chatInput.focus();
      chatInput.dispatchEvent(new Event('input')); // auto resize
    });
  });

  modelSelector.addEventListener('change', () => {
    const session = conversations.find(c => c.id === currentSessionId);
    if (session) {
      if (modelSelector.value === 'custom') {
        customModelGroup.style.display = 'block';
        const customId = customModelInput.value.trim() || 'openrouter/fusion';
        customModelInput.value = customId;
        session.model = 'custom:' + customId;
        activeModelName.textContent = customId.split('/').pop();
      } else {
        customModelGroup.style.display = 'none';
        session.model = modelSelector.value;
        activeModelName.textContent = session.model.split('/').pop();
      }
      saveSessions();
    }
  });

  // ── Canvas Mode Logic ────────────────────────────────────────────────────────
  const canvasPanel = document.getElementById('canvas-panel');
  const canvasFileName = document.getElementById('canvas-file-name');
  const canvasLangBadge = document.getElementById('canvas-lang-badge');
  const canvasCodeDisplay = document.getElementById('canvas-code-display');
  const canvasCopyBtn = document.getElementById('canvas-copy-btn');
  const canvasCloseBtn = document.getElementById('canvas-close-btn');
  const editorGutter = canvasPanel.querySelector('.editor-gutter');

  // Handle click on "View in Canvas" button in message bubble (Delegated event)
  messagesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-canvas-btn');
    if (!btn) return;

    // Find the associated code block in the bubble
    const bubble = btn.closest('.bubble');
    if (!bubble) return;

    const pre = bubble.querySelector('pre');
    if (!pre) return;

    const code = pre.querySelector('code');
    const codeContent = code ? code.textContent : pre.textContent;
    const lang = btn.getAttribute('data-lang') || 'txt';

    openCanvas(codeContent, lang);
  });

  function openCanvas(code, lang) {
    canvasCodeDisplay.textContent = code;
    canvasLangBadge.textContent = lang;

    // Map common languages to file extensions for premium editor look
    const extMap = {
      javascript: 'script.js',
      js: 'script.js',
      html: 'index.html',
      css: 'style.css',
      python: 'main.py',
      py: 'main.py',
      json: 'data.json',
      typescript: 'types.ts',
      ts: 'types.ts',
      go: 'main.go',
      rust: 'main.rs',
      rs: 'main.rs',
      cpp: 'main.cpp',
      java: 'Main.java'
    };

    canvasFileName.textContent = extMap[lang.toLowerCase()] || `snippet.${lang}`;

    // Populate Gutter Line Numbers
    const lines = code.split('\n');
    editorGutter.innerHTML = '';
    lines.forEach((_, idx) => {
      const span = document.createElement('span');
      span.textContent = idx + 1;
      editorGutter.appendChild(span);
    });

    // Expand Split Screen Layout
    document.body.classList.add('canvas-active');
  }

  function closeCanvas() {
    document.body.classList.remove('canvas-active');
  }

  canvasCloseBtn.addEventListener('click', closeCanvas);

  // Copy code inside Canvas view
  canvasCopyBtn.addEventListener('click', () => {
    const codeText = canvasCodeDisplay.textContent;
    navigator.clipboard.writeText(codeText).then(() => {
      canvasCopyBtn.textContent = 'Copied';
      toast('Code copied to clipboard');
      setTimeout(() => { canvasCopyBtn.textContent = 'Copy code'; }, 1800);
    }).catch(err => {
      console.error('Clipboard copy failed: ', err);
      toast('Copy failed — select the code and copy manually.');
    });
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      closeCanvas();
      document.body.classList.remove('sidebar-open');
    }

    if (!typing && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      createNewSession();
      chatInput.focus();
    }
  });
});