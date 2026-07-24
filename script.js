document.addEventListener('DOMContentLoaded', () => {
  // ── 1. Theme Setup & Circular Transition ──────────────────────────────────
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('omnichat_theme', theme);
    if (themeToggle) {
      themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
      themeToggle.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      );
    }
  }

  applyTheme(root.getAttribute('data-theme') || 'dark');

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduceMotion) {
        applyTheme(next);
        return;
      }

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
  }

  // ── 2. Toast System ────────────────────────────────────────────────────────
  const toastHost = document.getElementById('toast-host');

  function toast(message) {
    if (!toastHost) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 3200);
  }

  function getApiUrl(path) {
    if (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null') {
      return 'http://localhost:3000' + path;
    }
    return path;
  }

  // ── 3. Application State ───────────────────────────────────────────────────
  let apiKeys = JSON.parse(localStorage.getItem('omnichat_api_keys')) || [];
  // Migrate legacy single key if exists
  const legacyKey = localStorage.getItem('omnichat_api_key');
  if (legacyKey && (!apiKeys.length || apiKeys[0] !== legacyKey)) {
    apiKeys = [legacyKey, ...apiKeys.filter(k => k !== legacyKey)].slice(0, 5);
    localStorage.setItem('omnichat_api_keys', JSON.stringify(apiKeys));
  }

  let connectedModels = JSON.parse(localStorage.getItem('omnichat_connected_models')) || [
    'anthropic/claude-3.5-haiku',
    'deepseek/deepseek-r1',
    'meta-llama/llama-3.3-70b-instruct'
  ];

  let defaultModel = localStorage.getItem('omnichat_default_model') || 'auto-free';
  let conversations = JSON.parse(localStorage.getItem('omnichat_sessions')) || [];
  let currentSessionId = localStorage.getItem('omnichat_active_session_id') || null;
  let currentUser = null;
  let db = null;
  let attachedFiles = []; // Currently staged files [{name, ext, size, content}]

  // System Rules & Personas State
  const PRESET_RULES = {
    none: '',
    architect: 'You are an expert Senior Software Architect. Provide clean, production-ready, efficient code with clear and concise architectural explanations.',
    concise: 'Be extremely concise, direct, and to the point. Give the answer immediately without any fluff, intro greetings, or concluding filler.',
    debugger: 'Act as an expert software debugger. Analyze input code thoroughly for subtle edge-case bugs, performance bottlenecks, and security flaws with step-by-step fixes.',
    teacher: 'Explain concepts simply and step-by-step as a patient expert teacher. Use clear analogies and structured examples.'
  };

  let customRules = JSON.parse(localStorage.getItem('omnichat_custom_rules')) || [
    { id: 'rule_1', title: 'Python Pandas Expert', prompt: 'You are a Python Data Science & Pandas expert. Always output clean, vectorized Pandas code with type hints.' }
  ];

  let selectedSystemRuleId = localStorage.getItem('omnichat_selected_rule') || 'none';

  // Elements
  const menuBtn = document.getElementById('menu-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarScrim = document.getElementById('sidebar-scrim');

  function persistSidebar(collapsed) {
    try { localStorage.setItem('omnichat_sidebar_collapsed', collapsed ? '1' : '0'); } catch (e) {}
  }

  function toggleSidebar() {
    if (window.innerWidth <= 900) {
      document.body.classList.toggle('sidebar-open');
    } else {
      const nowCollapsed = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', nowCollapsed);
      persistSidebar(nowCollapsed);
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 900) {
      document.body.classList.remove('sidebar-open');
    } else {
      document.body.classList.add('sidebar-collapsed');
      persistSidebar(true);
    }
  }

  function openSidebarDesktop() {
    document.body.classList.remove('sidebar-collapsed');
    persistSidebar(false);
  }

  // Restore persisted desktop sidebar state
  try {
    if (window.innerWidth > 900 && localStorage.getItem('omnichat_sidebar_collapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch (e) {}

  if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarScrim) sidebarScrim.addEventListener('click', () => document.body.classList.remove('sidebar-open'));

  const sidebarReopenTab = document.getElementById('sidebar-reopen-tab');
  if (sidebarReopenTab) sidebarReopenTab.addEventListener('click', openSidebarDesktop);

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const messagesContainer = document.getElementById('messages-container');
  const emptyState = document.getElementById('empty-state');
  const typingIndicator = document.getElementById('typing-indicator');

  const modelSelector = document.getElementById('model-selector');
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const dynamicModelsGroup = document.getElementById('dynamic-models-group');
  const connectedCustomModelsGroup = document.getElementById('connected-custom-models-group');
  const customModelGroup = document.getElementById('custom-model-group');
  const customModelInput = document.getElementById('custom-model-input');
  const tempSlider = document.getElementById('temp-slider');
  const tempValue = document.getElementById('temp-value');

  const newChatBtn = document.getElementById('new-chat-btn');
  const chatList = document.getElementById('chat-list');
  const activeChatTitle = document.getElementById('active-chat-title');
  const activeModelName = document.getElementById('active-model-name');
  const clearCurrentChatBtn = document.getElementById('clear-current-chat-btn');
  const activeKeysBadge = document.getElementById('active-keys-badge');

  // File Upload Elements
  const fileUploadInput = document.getElementById('file-upload-input');
  const attachFileBtn = document.getElementById('attach-file-btn');
  const fileChipsContainer = document.getElementById('file-chips-container');

  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const quickOpenKeysBtn = document.getElementById('quick-open-keys-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const modalTabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const keyInput1 = document.getElementById('key-input-1');
  const keyInput2 = document.getElementById('key-input-2');
  const keyInput3 = document.getElementById('key-input-3');
  const keyInput4 = document.getElementById('key-input-4');
  const keyInput5 = document.getElementById('key-input-5');
  const defaultModelSelect = document.getElementById('default-model-select');
  const newModelIdInput = document.getElementById('new-model-id-input');
  const connectModelBtn = document.getElementById('connect-model-btn');
  const customConnectedList = document.getElementById('custom-connected-list');

  // ── 4. Multi-Key & Settings Initialization ────────────────────────────────
  function updateActiveKeysBadge() {
    const validCount = apiKeys.filter(k => k && k.trim().length > 5).length;
    if (activeKeysBadge) {
      activeKeysBadge.textContent = `${validCount} / 5 Active`;
      activeKeysBadge.style.color = validCount > 0 ? '#818cf8' : '#ef4444';
    }
  }

  function loadKeyInputsFromState() {
    if (keyInput1) keyInput1.value = apiKeys[0] || '';
    if (keyInput2) keyInput2.value = apiKeys[1] || '';
    if (keyInput3) keyInput3.value = apiKeys[2] || '';
    if (keyInput4) keyInput4.value = apiKeys[3] || '';
    if (keyInput5) keyInput5.value = apiKeys[5 - 1] || '';
    updateActiveKeysBadge();
  }

  loadKeyInputsFromState();

  // Password visibility toggle buttons inside settings
  document.querySelectorAll('.toggle-pass-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const inputEl = document.getElementById(targetId);
      if (inputEl) {
        const isPass = inputEl.type === 'password';
        inputEl.type = isPass ? 'text' : 'password';
        btn.textContent = isPass ? 'Hide' : 'Show';
      }
    });
  });

  // Modal Open / Close
  function openSettings(defaultTab = 'tab-keys') {
    loadKeyInputsFromState();
    renderCustomModelsListModal();
    renderCustomRulesModalList();
    if (defaultModelSelect) defaultModelSelect.value = defaultModel;
    
    // Switch to target tab
    modalTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === defaultTab));
    tabContents.forEach(c => c.classList.toggle('active', c.id === defaultTab));

    settingsModal.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    settingsModal.setAttribute('aria-hidden', 'true');
  }

  if (openSettingsBtn) openSettingsBtn.addEventListener('click', () => openSettings('tab-keys'));
  if (quickOpenKeysBtn) quickOpenKeysBtn.addEventListener('click', () => openSettings('tab-keys'));
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);

  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      modalTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const targetEl = document.getElementById(target);
      if (targetEl) targetEl.classList.add('active');
    });
  });

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      const newKeys = [
        keyInput1.value.trim(),
        keyInput2.value.trim(),
        keyInput3.value.trim(),
        keyInput4.value.trim(),
        keyInput5.value.trim()
      ].filter(Boolean);

      apiKeys = newKeys;
      localStorage.setItem('omnichat_api_keys', JSON.stringify(apiKeys));
      if (apiKeys.length) localStorage.setItem('omnichat_api_key', apiKeys[0]);

      if (defaultModelSelect) {
        defaultModel = defaultModelSelect.value;
        localStorage.setItem('omnichat_default_model', defaultModel);
      }

      updateActiveKeysBadge();
      closeSettings();
      if (typeof syncUserDataToFirebase === 'function') {
        syncUserDataToFirebase();
      }
      toast('Settings saved successfully.');
    });
  }

  // ── 5. Connected Custom Models System ─────────────────────────────────────
  function renderConnectedModelsDropdown() {
    if (!connectedCustomModelsGroup) return;
    connectedCustomModelsGroup.innerHTML = '';

    connectedModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${m.split('/').pop()} — ${m}`;
      connectedCustomModelsGroup.appendChild(opt);
    });
  }

  function renderCustomModelsListModal() {
    if (!customConnectedList) return;
    customConnectedList.innerHTML = '';

    connectedModels.forEach((m, idx) => {
      const li = document.createElement('li');
      li.className = 'custom-model-tag';
      li.innerHTML = `<span>${m}</span>`;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove custom model';
      removeBtn.addEventListener('click', () => {
        connectedModels.splice(idx, 1);
        localStorage.setItem('omnichat_connected_models', JSON.stringify(connectedModels));
        renderCustomModelsListModal();
        renderConnectedModelsDropdown();
        if (typeof syncUserDataToFirebase === 'function') {
          syncUserDataToFirebase();
        }
        toast(`Removed model ${m}`);
      });

      li.appendChild(removeBtn);
      customConnectedList.appendChild(li);
    });
  }

  if (connectModelBtn) {
    connectModelBtn.addEventListener('click', () => {
      const modelId = newModelIdInput.value.trim();
      if (!modelId) return;

      if (!modelId.includes('/')) {
        toast('Please enter a valid OpenRouter model ID in format "provider/model-name"');
        return;
      }

      if (!connectedModels.includes(modelId)) {
        connectedModels.push(modelId);
        localStorage.setItem('omnichat_connected_models', JSON.stringify(connectedModels));
        renderConnectedModelsDropdown();
        renderCustomModelsListModal();
        
        // Select newly added model
        modelSelector.value = modelId;
        modelSelector.dispatchEvent(new Event('change'));
        
        newModelIdInput.value = '';
        if (typeof syncUserDataToFirebase === 'function') {
          syncUserDataToFirebase();
        }
        toast(`Connected model ${modelId} successfully!`);
      } else {
        toast('This model is already connected.');
      }
    });
  }

  renderConnectedModelsDropdown();

  // ── 5b. System Persona & Rules System ─────────────────────────────────────
  const systemRuleSelector = document.getElementById('system-rule-selector');
  const customRulesOptgroup = document.getElementById('custom-rules-optgroup');
  const customRulesList = document.getElementById('custom-rules-list');
  const newRuleTitleInput = document.getElementById('new-rule-title-input');
  const newRulePromptInput = document.getElementById('new-rule-prompt-input');
  const createRuleBtn = document.getElementById('create-rule-btn');

  function renderSystemRulesDropdown() {
    if (!customRulesOptgroup) return;
    customRulesOptgroup.innerHTML = '';

    customRules.forEach(r => {
      const opt = document.createElement('option');
      opt.value = `custom:${r.id}`;
      opt.textContent = r.title;
      customRulesOptgroup.appendChild(opt);
    });

    if (systemRuleSelector) {
      systemRuleSelector.value = selectedSystemRuleId;
    }
  }

  function renderCustomRulesModalList() {
    if (!customRulesList) return;
    customRulesList.innerHTML = '';

    customRules.forEach((r, idx) => {
      const li = document.createElement('li');
      li.className = 'custom-model-tag';
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.justifyContent = 'space-between';
      li.style.padding = '8px 12px';

      li.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
          <strong style="font-size:13px; color:var(--fg);">${escapeHtml(r.title)}</strong>
          <span style="font-size:11px; color:var(--fg-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:360px;">${escapeHtml(r.prompt)}</span>
        </div>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Delete system rule';
      removeBtn.style.color = '#ef4444';
      removeBtn.style.fontSize = '14px';
      removeBtn.style.marginLeft = '12px';
      removeBtn.addEventListener('click', () => {
        customRules.splice(idx, 1);
        localStorage.setItem('omnichat_custom_rules', JSON.stringify(customRules));
        renderCustomRulesModalList();
        renderSystemRulesDropdown();
        if (typeof syncUserDataToFirebase === 'function') syncUserDataToFirebase();
        toast(`Deleted rule "${r.title}"`);
      });

      li.appendChild(removeBtn);
      customRulesList.appendChild(li);
    });
  }

  if (systemRuleSelector) {
    systemRuleSelector.addEventListener('change', () => {
      selectedSystemRuleId = systemRuleSelector.value;
      localStorage.setItem('omnichat_selected_rule', selectedSystemRuleId);
      toast('Active System Persona/Rule updated!');
    });
  }

  if (createRuleBtn) {
    createRuleBtn.addEventListener('click', () => {
      const title = newRuleTitleInput ? newRuleTitleInput.value.trim() : '';
      const prompt = newRulePromptInput ? newRulePromptInput.value.trim() : '';

      if (!title || !prompt) {
        toast('Please enter both a Rule Title and Prompt instructions.');
        return;
      }

      const newRule = {
        id: `rule_${Date.now()}`,
        title: title,
        prompt: prompt
      };

      customRules.push(newRule);
      localStorage.setItem('omnichat_custom_rules', JSON.stringify(customRules));

      if (newRuleTitleInput) newRuleTitleInput.value = '';
      if (newRulePromptInput) newRulePromptInput.value = '';

      renderCustomRulesModalList();
      renderSystemRulesDropdown();

      selectedSystemRuleId = `custom:${newRule.id}`;
      if (systemRuleSelector) systemRuleSelector.value = selectedSystemRuleId;
      localStorage.setItem('omnichat_selected_rule', selectedSystemRuleId);

      if (typeof syncUserDataToFirebase === 'function') syncUserDataToFirebase();
      toast(`Created rule "${title}" successfully!`);
    });
  }

  function getActiveSystemRulePrompt() {
    if (!selectedSystemRuleId || selectedSystemRuleId === 'none') return '';
    if (selectedSystemRuleId.startsWith('custom:')) {
      const ruleId = selectedSystemRuleId.substring(7);
      const customR = customRules.find(r => r.id === ruleId);
      return customR ? customR.prompt : '';
    }
    return PRESET_RULES[selectedSystemRuleId] || '';
  }

  renderSystemRulesDropdown();

  // ── 6. Temperature Config ─────────────────────────────────────────────────
  function loadTemperature() {
    const temp = localStorage.getItem('omnichat_temperature');
    if (temp && tempSlider) {
      tempSlider.value = temp;
      if (tempValue) tempValue.textContent = temp;
    }
  }

  if (tempSlider) {
    tempSlider.addEventListener('input', () => {
      if (tempValue) tempValue.textContent = tempSlider.value;
      localStorage.setItem('omnichat_temperature', tempSlider.value);
    });
  }
  loadTemperature();

  // ── 7. Fetch All OpenRouter Models (A to Z) ─────────────────────────────
  // Helper to populate category optgroups into any select dropdown
  function populateCategorySelect(selectEl, resData) {
    if (!selectEl) return;
    const currentVal = selectEl.value;

    selectEl.innerHTML = '';

    const createGroup = (label, list) => {
      if (!list || !list.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = (m.id === 'auto-free' || m.name.includes('(Free)')) ? m.name : `${m.name} (${m.id.split('/')[0]})`;
        group.appendChild(opt);
      });
      selectEl.appendChild(group);
    };

    // 1. Free Models (Zero Credits)
    createGroup('Free Models (A to Z — Zero Credits)', resData.freeModels);

    // 2. Google Models (Gemini, Gemma, Lyria)
    createGroup('Google Models (A to Z)', resData.googleModels);

    // 3. DeepSeek Models
    createGroup('DeepSeek Models (A to Z)', resData.deepseekModels);

    // 4. Anthropic Claude Models
    createGroup('Anthropic Claude Models (A to Z)', resData.anthropicModels);

    // 5. OpenAI GPT Models
    createGroup('OpenAI GPT Models (A to Z)', resData.openaiModels);

    // 6. Meta Llama Models
    createGroup('Meta Llama Models (A to Z)', resData.llamaModels);

    // 7. NVIDIA Models
    createGroup('NVIDIA Nemotron Models (A to Z)', resData.nvidiaModels);

    // 8. Qwen Models
    createGroup('Qwen Models (A to Z)', resData.qwenModels);

    // 9. Connected Custom Models
    if (connectedModels && connectedModels.length) {
      const customGrp = document.createElement('optgroup');
      customGrp.label = 'Connected Custom Models';
      connectedModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m.split('/').pop()} — ${m}`;
        customGrp.appendChild(opt);
      });
      selectEl.appendChild(customGrp);
    }

    // 10. All OpenRouter Models (A to Z)
    createGroup('All 340+ OpenRouter Models (A to Z)', resData.allModels);

    // 9. Other option
    const otherGrp = document.createElement('optgroup');
    otherGrp.label = 'Other';
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Paste Custom Model ID…';
    otherGrp.appendChild(customOpt);
    selectEl.appendChild(otherGrp);

    if (currentVal && Array.from(selectEl.options).some(o => o.value === currentVal)) {
      selectEl.value = currentVal;
    }
  }

  // ── 7. Fetch All OpenRouter Models (Categorized & A to Z) ─────────────────
  async function fetchModels() {
    if (!refreshModelsBtn) return;
    refreshModelsBtn.classList.add('spinning');
    const primaryKey = apiKeys[0] || '';

    try {
      const headers = {};
      if (primaryKey) headers['Authorization'] = `Bearer ${primaryKey}`;

      const response = await fetch(getApiUrl('/api/models'), { headers });
      if (!response.ok) throw new Error('Failed to fetch models');

      const resData = await response.json();

      // Populate Sidebar Active Model selector
      populateCategorySelect(modelSelector, resData);

      // Populate Settings Default Model selector
      populateCategorySelect(defaultModelSelect, resData);

    } catch (err) {
      console.warn('Could not load dynamic OpenRouter models list:', err.message);
    } finally {
      refreshModelsBtn.classList.remove('spinning');
    }
  }

  if (refreshModelsBtn) refreshModelsBtn.addEventListener('click', fetchModels);
  fetchModels();

  // ── 8. Textarea Auto-Grow & Keyboard Submit ────────────────────────────────
  const inputBar = document.querySelector('.chat-input-bar');
  const MAX_INPUT_HEIGHT = 240;
  const MIN_INPUT_HEIGHT = 28;

  function adjustInputHeight() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    const newHeight = Math.min(Math.max(chatInput.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT);
    chatInput.style.height = `${newHeight}px`;

    if (inputBar) {
      inputBar.classList.toggle('expanded', newHeight > MIN_INPUT_HEIGHT + 10);
    }
    chatInput.classList.toggle('scrollable', chatInput.scrollHeight > MAX_INPUT_HEIGHT - 10);
  }

  function resetInputHeight() {
    if (!chatInput) return;
    chatInput.style.height = `${MIN_INPUT_HEIGHT}px`;
    if (inputBar) inputBar.classList.remove('expanded');
    chatInput.classList.remove('scrollable');
  }

  resetInputHeight();

  if (chatInput) {
    chatInput.addEventListener('input', adjustInputHeight);
    chatInput.addEventListener('paste', () => setTimeout(adjustInputHeight, 20));
    chatInput.addEventListener('change', adjustInputHeight);
    chatInput.addEventListener('focus', adjustInputHeight);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (typeof chatForm.requestSubmit === 'function') {
          chatForm.requestSubmit();
        } else {
          chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      } else {
        setTimeout(adjustInputHeight, 0);
      }
    });
  }

  // ── 9. File Upload & Attachment Parsers (.js, .html, .py, .pdf, .docx, .txt) ──
  if (attachFileBtn && fileUploadInput) {
    attachFileBtn.addEventListener('click', () => fileUploadInput.click());

    fileUploadInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      for (const file of files) {
        try {
          const parsedContent = await readFileContent(file);
          attachedFiles.push({
            name: file.name,
            ext: file.name.split('.').pop().toLowerCase(),
            size: (file.size / 1024).toFixed(1) + ' KB',
            content: parsedContent
          });
        } catch (err) {
          console.error(err);
          toast(`Failed to read file ${file.name}: ${err.message}`);
        }
      }

      fileUploadInput.value = '';
      renderFileChips();
    });
  }

  async function readFileContent(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    // 1. Text & Code files (.js, .html, .css, .py, .txt, .json, .md, .cpp, .c, .java, .ts, etc.)
    if (['js', 'html', 'css', 'py', 'json', 'md', 'cpp', 'c', 'java', 'ts', 'go', 'rs', 'php', 'rb', 'txt'].includes(ext)) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('File reading error'));
        reader.readAsText(file);
      });
    }

    // 2. PDF Files (.pdf) via PDF.js
    if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF parser loading failed.');
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
      }
      return fullText.trim() || 'No text extracted from PDF.';
    }

    // 3. DOC / DOCX Files (.docx) via Mammoth.js
    if (ext === 'docx' || ext === 'doc') {
      if (typeof mammoth === 'undefined') {
        throw new Error('Word document parser loading failed.');
      }
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      return result.value.trim() || 'No text extracted from document.';
    }

    // Fallback text reader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unsupported file format.'));
      reader.readAsText(file);
    });
  }

  function renderFileChips() {
    if (!fileChipsContainer) return;
    fileChipsContainer.innerHTML = '';

    attachedFiles.forEach((f, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';

      chip.innerHTML = `
        <span class="file-chip-icon">${f.ext.toUpperCase()}</span>
        <span class="file-chip-name" title="${f.name}">${f.name}</span>
        <span class="file-chip-size">${f.size}</span>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-chip-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove attached file';
      removeBtn.addEventListener('click', () => {
        attachedFiles.splice(idx, 1);
        renderFileChips();
      });

      chip.appendChild(removeBtn);
      fileChipsContainer.appendChild(chip);
    });
  }

  // ── 10. Conversation Management ──────────────────────────────────────────
  function saveSessions() {
    if (currentUser) {
      const userSessionKey = `omnichat_sessions_${currentUser.uid}`;
      const userActiveSessionKey = `omnichat_active_session_${currentUser.uid}`;
      localStorage.setItem(userSessionKey, JSON.stringify(conversations));
      if (currentSessionId) localStorage.setItem(userActiveSessionKey, currentSessionId);
    }
    localStorage.setItem('omnichat_sessions', JSON.stringify(conversations));
    if (currentSessionId) {
      localStorage.setItem('omnichat_active_session_id', currentSessionId);
    }
    if (typeof syncUserDataToFirebase === 'function') {
      syncUserDataToFirebase();
    }
  }

  if (customModelInput) {
    customModelInput.addEventListener('input', () => {
      const session = conversations.find(c => c.id === currentSessionId);
      if (session && modelSelector.value === 'custom') {
        session.model = 'custom:' + customModelInput.value.trim();
        activeModelName.textContent = customModelInput.value.trim().split('/').pop() || 'custom';
        saveSessions();
      }
    });
  }

  function createNewSession() {
    const newId = 'session_' + Date.now();
    const chosenModel = defaultModel || (modelSelector ? modelSelector.value : 'auto-free');

    const newSession = {
      id: newId,
      title: 'New Conversation',
      model: chosenModel === 'custom' ? ('custom:' + customModelInput.value.trim()) : chosenModel,
      messages: []
    };

    conversations.unshift(newSession);
    currentSessionId = newId;
    saveSessions();
    renderHistoryList();
    loadSession(newId);
  }

  if (newChatBtn) newChatBtn.addEventListener('click', createNewSession);

  function loadSession(id) {
    currentSessionId = id;
    const session = conversations.find(c => c.id === id);
    if (!session) return;

    if (activeChatTitle) activeChatTitle.textContent = session.title;

    const modelToLoad = session.model || defaultModel || 'auto-free';
    if (modelToLoad.startsWith('custom:')) {
      const customId = modelToLoad.substring(7);
      if (modelSelector) modelSelector.value = 'custom';
      if (customModelInput) customModelInput.value = customId;
      if (customModelGroup) customModelGroup.style.display = 'block';
      if (activeModelName) activeModelName.textContent = customId.split('/').pop() || 'custom';
    } else {
      if (modelSelector) modelSelector.value = modelToLoad;
      if (customModelGroup) customModelGroup.style.display = 'none';
      if (activeModelName) activeModelName.textContent = modelToLoad.split('/').pop();
    }

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
    if (!chatList) return;
    chatList.innerHTML = '';

    conversations.forEach(session => {
      const li = document.createElement('li');
      li.className = `chat-history-item ${session.id === currentSessionId ? 'active' : ''}`;
      li.setAttribute('data-id', session.id);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-item-title';
      titleSpan.textContent = session.title || 'New Conversation';

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-session-btn';
      delBtn.innerHTML = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 12 4v1.5M5.5 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10"/></svg>';
      delBtn.title = 'Delete conversation';
      delBtn.addEventListener('click', (e) => deleteSession(session.id, e));

      li.appendChild(titleSpan);
      li.appendChild(delBtn);

      li.addEventListener('click', () => {
        loadSession(session.id);
        document.body.classList.remove('sidebar-open');
      });

      chatList.appendChild(li);
    });
  }

  if (clearCurrentChatBtn) {
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
  }

  // Initial Session Loading
  renderHistoryList();
  if (currentSessionId) {
    loadSession(currentSessionId);
  } else {
    createNewSession();
  }

  // ── 11. Render Messages & Markdown Format ─────────────────────────────────
  function renderMessages(messages) {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    if (emptyState) messagesContainer.appendChild(emptyState);

    if (messages.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

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
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function getFileNameForLang(lang) {
    const extMap = {
      javascript: 'script.js', js: 'script.js', html: 'index.html', css: 'style.css',
      python: 'main.py', py: 'main.py', json: 'data.json', typescript: 'types.ts',
      ts: 'types.ts', go: 'main.go', rust: 'main.rs', cpp: 'main.cpp', java: 'Main.java',
      sql: 'query.sql', sh: 'script.sh', bash: 'script.sh'
    };
    return extMap[(lang || '').toLowerCase()] || `snippet.${lang || 'txt'}`;
  }

  function formatMarkdown(text) {
    if (!text) return '';

    const codeBlocks = [];
    let placeholderText = text;

    // 1. Extract Fenced Code Blocks: ```lang ... ``` BEFORE parsing Markdown
    placeholderText = placeholderText.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang ? lang.trim().toLowerCase() : 'code';
      const cleanCode = code.trim();
      const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
      const fileName = getFileNameForLang(language);

      codeBlocks.push({
        code: cleanCode,
        lang: language,
        html: `<div class="code-canvas-card">
                 <div class="code-card-header">
                   <div class="code-card-info">
                     <span class="code-card-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 3 10 6 16"/><polyline points="14 4 17 10 14 16"/><line x1="12" y1="4" x2="8" y2="16"/></svg></span>
                     <span class="code-card-title">${escapeHtml(fileName)} <code>${escapeHtml(language)}</code></span>
                   </div>
                   <span class="code-card-badge">Opened in Canvas</span>
                 </div>
                 <div class="code-card-actions">
                   <button class="view-canvas-btn primary-card-btn" data-lang="${escapeHtml(language)}"><span class="btn-glyph" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="3.5" width="15" height="11" rx="1.5"/><path d="M7 17.5h6M10 14.5v3"/></svg></span>Open Code in Canvas</button>
                   <button class="toggle-code-preview-btn"><span class="btn-glyph" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 10s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/><circle cx="10" cy="10" r="2.5"/></svg></span>Toggle Inline View</button>
                 </div>
                 <pre class="inline-code-preview" style="display: none;"><code class="language-${escapeHtml(language)}">${escapeHtml(cleanCode)}</code></pre>
               </div>`
      });
      return placeholder;
    });

    // Extract Fallback Code Blocks: ```...```
    placeholderText = placeholderText.replace(/```([\s\S]*?)```/g, (match, code) => {
      const cleanCode = code.trim();
      const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;

      codeBlocks.push({
        code: cleanCode,
        lang: 'txt',
        html: `<div class="code-canvas-card">
                 <div class="code-card-header">
                   <div class="code-card-info">
                     <span class="code-card-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 3 10 6 16"/><polyline points="14 4 17 10 14 16"/><line x1="12" y1="4" x2="8" y2="16"/></svg></span>
                     <span class="code-card-title">Code Snippet <code>txt</code></span>
                   </div>
                   <span class="code-card-badge">Opened in Canvas</span>
                 </div>
                 <div class="code-card-actions">
                   <button class="view-canvas-btn primary-card-btn" data-lang="txt"><span class="btn-glyph" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="3.5" width="15" height="11" rx="1.5"/><path d="M7 17.5h6M10 14.5v3"/></svg></span>Open Code in Canvas</button>
                   <button class="toggle-code-preview-btn"><span class="btn-glyph" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 10s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/><circle cx="10" cy="10" r="2.5"/></svg></span>Toggle Inline View</button>
                 </div>
                 <pre class="inline-code-preview" style="display: none;"><code class="language-txt">${escapeHtml(cleanCode)}</code></pre>
               </div>`
      });
      return placeholder;
    });

    let rendered = '';

    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      try {
        rendered = marked.parse(placeholderText, { gfm: true, breaks: true });
      } catch (e) {
        console.warn('Marked.js error, falling back:', e);
        rendered = customMarkdownParse(placeholderText);
      }
    } else {
      rendered = customMarkdownParse(placeholderText);
    }

    // Restore Code Blocks
    codeBlocks.forEach((cb, idx) => {
      const placeholder = `___CODE_BLOCK_${idx}___`;
      rendered = rendered.replace(new RegExp(`<p>\\s*${placeholder}\\s*</p>`, 'g'), cb.html);
      rendered = rendered.replace(new RegExp(placeholder, 'g'), cb.html);
    });

    return rendered;
  }

  function customMarkdownParse(str) {
    if (!str) return '';

    let text = escapeHtml(str);

    // 1. Markdown Tables (| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |)
    text = text.replace(/(?:^|\n)((?:\|[^\n]+\|\r?\n){2,}(?:\|[^\n]+\|(?:$|\n))*)/g, (match, tableBlock) => {
      const lines = tableBlock.trim().split(/\r?\n/).map(l => l.trim());
      if (lines.length < 2) return match;
      if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[1])) return match;

      const parseRow = (rowStr) => rowStr.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = parseRow(lines[0]);
      let html = '<div class="table-wrapper"><table><thead><tr>';
      headers.forEach(h => { html += `<th>${h}</th>`; });
      html += '</tr></thead><tbody>';

      for (let i = 2; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = parseRow(lines[i]);
        html += '<tr>';
        cells.forEach(c => { html += `<td>${c}</td>`; });
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      return '\n' + html + '\n';
    });

    // 2. Headings (# Title, ## Subtitle, ### H3, #### H4)
    text = text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
      const level = hashes.length;
      return `<h${level}>${content.trim()}</h${level}>`;
    });

    // 3. Horizontal Rule
    text = text.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr>');

    // 4. Blockquotes
    text = text.replace(/^(?:&gt;|>)\s?(.*)$/gm, '<blockquote><p>$1</p></blockquote>');
    text = text.replace(/<\/blockquote>\s*blockquote>/g, '<br>');

    // 5. Lists
    text = text.replace(/^(?:[\*\-\+])\s+(.+)$/gm, '<ul><li>$1</li></ul>');
    text = text.replace(/^(\d+)\.\s+(.+)$/gm, '<ol><li>$2</li></ol>');
    text = text.replace(/<\/ul>\s*<ul>/g, '');
    text = text.replace(/<\/ol>\s*<ol>/g, '');

    // 6. Inline Formatting
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
    text = text.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 7. Line breaks
    const parts = text.split(/(<div[\s\S]*?<\/div>|<table[\s\S]*?<\/table>|<h[1-6][\s\S]*?<\/h[1-6]>|<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>|<blockquote[\s\S]*?<\/blockquote>|<hr>)/gi);
    return parts.map(part => {
      if (/^<(div|table|h[1-6]|ul|ol|blockquote|hr)/i.test(part.trim())) return part;
      return part.replace(/\n/g, '<br>');
    }).join('');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getValidApiKeys() {
    return apiKeys.filter(k => k && k.trim().length > 5);
  }

  function clearAttachedFiles() {
    attachedFiles = [];
    renderFileChips();
  }

  // ── 12. Submit Message with Multi-Key Failover & Attachments ──────────────
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userText = chatInput ? chatInput.value.trim() : '';

      if (!userText && attachedFiles.length === 0) return;

      const validKeys = getValidApiKeys();
      if (validKeys.length === 0) {
        toast('Please enter at least 1 OpenRouter API key in Settings');
        openSettings('tab-keys');
        return;
      }

      let session = conversations.find(c => c.id === currentSessionId);
      if (!session) {
        createNewSession();
        session = conversations.find(c => c.id === currentSessionId);
      }

      let fullPromptText = userText;
      if (attachedFiles.length > 0) {
        let filesContext = '\n\n--- ATTACHED FILES ---\n';
        attachedFiles.forEach(f => {
          filesContext += `\n=== FILE: ${f.name} (${f.ext}) ===\n${f.content}\n`;
        });
        fullPromptText += filesContext;
      }

      const userMsg = {
        role: 'user',
        content: userText || (attachedFiles.length > 0 ? `[Attached ${attachedFiles.length} file(s)]` : '')
      };
      session.messages.push(userMsg);

      if (session.messages.filter(m => m.role === 'user').length === 1 && userText) {
        session.title = userText.substring(0, 36) + (userText.length > 36 ? '…' : '');
      }

      renderMessages(session.messages);
      renderHistoryList();
      saveSessions();

      if (chatInput) chatInput.value = '';
      resetInputHeight();
      clearAttachedFiles();

      if (typingIndicator) typingIndicator.style.display = 'flex';

      try {
        const systemRuleText = getActiveSystemRulePrompt();
        const payloadMessages = [];

        if (systemRuleText) {
          payloadMessages.push({ role: 'system', content: systemRuleText });
        }

        session.messages.forEach(m => {
          if (m.role === 'user' && m === userMsg && attachedFiles.length > 0) {
            payloadMessages.push({ role: 'user', content: fullPromptText });
          } else {
            payloadMessages.push({ role: m.role, content: m.content });
          }
        });

        const activeModel = modelSelector ? modelSelector.value : 'auto-free';
        const targetModel = activeModel.startsWith('custom:') ? activeModel.substring(7) : (activeModel === 'custom' ? customModelInput.value.trim() : activeModel);

        const response = await fetch(getApiUrl('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKeys: validKeys,
            model: targetModel,
            messages: payloadMessages,
            temperature: parseFloat(tempSlider ? tempSlider.value : 0.7)
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        const replyContent = data.reply || data.choices?.[0]?.message?.content;
        if (!replyContent) throw new Error(data.error || 'No text response returned from model.');

        const aiMsg = {
          role: 'assistant',
          content: replyContent
        };
        session.messages.push(aiMsg);
        renderMessages(session.messages);

        // Auto open canvas if response contains a code snippet
        if (replyContent && replyContent.includes('```')) {
          const match = replyContent.match(/```(\w*)\n([\s\S]*?)```/);
          if (match) {
            openCanvas(match[2].trim(), match[1] || 'javascript');
          }
        }

      } catch (err) {
        console.error(err);
        let errorHint = err.message;
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          errorHint = `Failed to connect to backend server (${err.message}).\n\nPlease ensure your Node server is running on **http://localhost:3000** (run \`npm start\`).`;
        } else if (err.message.includes('API Key is required') || err.message.includes('401') || err.message.includes('User not found')) {
          errorHint += `\n\n**Tip**: Please click **Settings** and enter a valid OpenRouter API key under **API Key #1**.`;
          openSettings('tab-keys');
        }
        session.messages.push({
          role: 'assistant',
          content: `**Failed to retrieve response from model.**\nDetails: ${errorHint}`
        });
        renderMessages(session.messages);
      } finally {
        if (typingIndicator) typingIndicator.style.display = 'none';
        saveSessions();
      }
    });
  }

  // ── 13. Canvas Mode & Side Panel Toggle ──────────────────────────────────
  const canvasPanel = document.getElementById('canvas-panel');
  const canvasFileName = document.getElementById('canvas-file-name');
  const canvasLangBadge = document.getElementById('canvas-lang-badge');
  const canvasCodeDisplay = document.getElementById('canvas-code-display');
  const canvasCopyBtn = document.getElementById('canvas-copy-btn');
  const canvasCloseBtn = document.getElementById('canvas-close-btn');
  const toggleCanvasBtn = document.getElementById('toggle-canvas-btn');

  if (toggleCanvasBtn) {
    toggleCanvasBtn.addEventListener('click', () => {
      document.body.classList.toggle('canvas-active');
    });
  }

  let activeCanvasRawCode = '';

  function highlightCode(code, lang) {
    if (!code) return '';
    let escaped = escapeHtml(code);
    const l = (lang || '').toLowerCase();

    if (['html', 'xml', 'svg', 'jsx', 'tsx'].includes(l)) {
      return escaped
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="syn-comment">$1</span>')
        .replace(/(&lt;\/?[\w:-]+)/gi, '<span class="syn-tag">$1</span>')
        .replace(/([\w:-]+)=(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|"[^"]*"|'[^']*')/gi, '<span class="syn-attr">$1</span>=<span class="syn-string">$2</span>')
        .replace(/(&gt;)/g, '<span class="syn-tag">$1</span>');
    }

    const tokens = [];
    const saveToken = (cls, content) => {
      const id = `___TOK_${tokens.length}___`;
      tokens.push(`<span class="${cls}">${content}</span>`);
      return id;
    };

    // 1. Comments (Multiline /* ... */ and Single-line // or #)
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/|\/\/.*$|#.*$)/gm, (m) => saveToken('syn-comment', m));

    // 2. Strings (Double quote, single quote, template literals multiline)
    escaped = escaped.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, (m) => saveToken('syn-string', m));

    // 3. Keywords
    const keywordRegex = /\b(const|let|var|function|return|if|else|for|while|do|import|export|from|class|extends|async|await|try|catch|finally|throw|default|switch|case|break|continue|new|this|typeof|instanceof|def|self|lambda|print|None|True|False|null|undefined|true|false|public|private|protected|static|void|int|float|double|string|boolean|interface|type|enum|package|struct|fn|let|mut|use|mod)\b/g;
    escaped = escaped.replace(keywordRegex, (m) => saveToken('syn-keyword', m));

    // 4. Function calls
    escaped = escaped.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, (m, name) => saveToken('syn-function', name));

    // 5. Numbers
    escaped = escaped.replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, (m) => saveToken('syn-number', m));

    // 6. Operators
    escaped = escaped.replace(/(=&gt;|&lt;=|&gt;=|==|===|!=|!==|&amp;&amp;|\|\||\+|-|\*|\/|%|=|\?|:)/g, (m) => saveToken('syn-operator', m));

    // Restore tokens
    tokens.forEach((tHtml, idx) => {
      escaped = escaped.replace(`___TOK_${idx}___`, tHtml);
    });

    return escaped;
  }

  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('.toggle-code-preview-btn');
      if (toggleBtn) {
        const card = toggleBtn.closest('.code-canvas-card');
        if (card) {
          const preview = card.querySelector('.inline-code-preview');
          if (preview) {
            const isHidden = preview.style.display === 'none';
            preview.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? 'Hide Inline View' : 'Toggle Inline View';
          }
        }
        return;
      }

      const btn = e.target.closest('.view-canvas-btn');
      if (!btn) return;

      const card = btn.closest('.code-canvas-card');
      if (!card) return;

      const codeEl = card.querySelector('.inline-code-preview code');
      const codeContent = codeEl ? codeEl.textContent : '';
      const lang = btn.getAttribute('data-lang') || 'txt';

      openCanvas(codeContent, lang);
    });
  }

  function openCanvas(code, lang) {
    if (!canvasPanel) return;
    activeCanvasRawCode = code;
    if (canvasCodeDisplay) canvasCodeDisplay.innerHTML = highlightCode(code, lang);
    if (canvasLangBadge) canvasLangBadge.textContent = lang;

    if (canvasFileName) canvasFileName.textContent = getFileNameForLang(lang);

    const editorGutter = canvasPanel.querySelector('.editor-gutter');
    if (editorGutter) {
      const lines = code.split('\n');
      editorGutter.innerHTML = '';
      lines.forEach((_, idx) => {
        const span = document.createElement('span');
        span.textContent = idx + 1;
        editorGutter.appendChild(span);
      });
    }

    document.body.classList.add('canvas-active');
  }

  function closeCanvas() {
    document.body.classList.remove('canvas-active');
  }

  if (canvasCloseBtn) canvasCloseBtn.addEventListener('click', closeCanvas);

  if (canvasCopyBtn) {
    canvasCopyBtn.addEventListener('click', () => {
      const codeText = activeCanvasRawCode || (canvasCodeDisplay ? canvasCodeDisplay.textContent : '');
      navigator.clipboard.writeText(codeText).then(() => {
        canvasCopyBtn.textContent = 'Copied';
        toast('Code copied to clipboard');
        setTimeout(() => { canvasCopyBtn.textContent = 'Copy code'; }, 1800);
      }).catch(err => {
        toast('Copy failed.');
      });
    });
  }

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      closeCanvas();
      closeSettings();
      document.body.classList.remove('sidebar-open');
    }

    if (!typing && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      createNewSession();
      if (chatInput) chatInput.focus();
    }
  });

  // ── 14. Firebase Backend & Mandatory Google Auth Gate ─────────────────────
  const loginModal = document.getElementById('login-modal');
  const gateGoogleBtn = document.getElementById('gate-google-btn');
  const googleLoginBtn = document.getElementById('google-login-btn');
  const modalGoogleBtn = document.getElementById('modal-google-btn');
  const userProfile = document.getElementById('user-profile');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const logoutBtn = document.getElementById('logout-btn');
  const fbStatusTitle = document.getElementById('fb-status-title');
  const fbStatusDesc = document.getElementById('fb-status-desc');
  const fbStatusIcon = document.getElementById('fb-status-icon');

  const defaultFirebaseConfig = {
    apiKey: "AIzaSyDemoOmniChatApiKeyForFirebase",
    authDomain: "omnichat-ai-client.firebaseapp.com",
    projectId: "omnichat-ai-client",
    storageBucket: "omnichat-ai-client.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
  };

  let firebaseConfig = JSON.parse(localStorage.getItem('omnichat_firebase_config')) || defaultFirebaseConfig;

  // Populate Firebase Form fields if present
  const fbApiKeyInput = document.getElementById('fb-cfg-api-key');
  const fbAuthDomainInput = document.getElementById('fb-cfg-auth-domain');
  const fbProjectIdInput = document.getElementById('fb-cfg-project-id');
  const fbStorageBucketInput = document.getElementById('fb-cfg-storage-bucket');
  const fbAppIdInput = document.getElementById('fb-cfg-app-id');
  const saveFbConfigBtn = document.getElementById('save-firebase-config-btn');

  if (fbApiKeyInput) fbApiKeyInput.value = firebaseConfig.apiKey || '';
  if (fbAuthDomainInput) fbAuthDomainInput.value = firebaseConfig.authDomain || '';
  if (fbProjectIdInput) fbProjectIdInput.value = firebaseConfig.projectId || '';
  if (fbStorageBucketInput) fbStorageBucketInput.value = firebaseConfig.storageBucket || '';
  if (fbAppIdInput) fbAppIdInput.value = firebaseConfig.appId || '';

  async function ensureFirebaseInitialized() {
    if (typeof firebase === 'undefined') return false;

    try {
      const configRes = await fetch(getApiUrl('/api/config')).catch(() => null);
      if (configRes && configRes.ok) {
        const envConfig = await configRes.json();
        if (envConfig.apiKey && envConfig.projectId && envConfig.apiKey.length > 10) {
          firebaseConfig = envConfig;
        }
      }
    } catch (e) {}

    if (firebase.apps.length) {
      const currentConfig = firebase.app().options;
      if (currentConfig && currentConfig.apiKey !== firebaseConfig.apiKey) {
        try { await firebase.app().delete(); } catch (e) {}
      }
    }

    if (!firebase.apps.length && firebaseConfig.apiKey) {
      try {
        firebase.initializeApp(firebaseConfig);
      } catch (e) {
        console.warn('Firebase initializeApp note:', e.message);
      }
    }

    if (firebase.apps.length) {
      try { db = firebase.firestore(); } catch (e) {}
      return true;
    }
    return false;
  }

  async function initFirebaseApp() {
    if (typeof firebase === 'undefined') return;
    try {
      await ensureFirebaseInitialized();

      if (firebase.apps.length) {
        firebase.auth().onAuthStateChanged((user) => {
          currentUser = user;
          if (user) {
            // Logged In state
            if (loginModal) loginModal.setAttribute('aria-hidden', 'true');
            if (googleLoginBtn) googleLoginBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userAvatar) userAvatar.src = user.photoURL || 'logo.png';
            if (userName) userName.textContent = user.displayName || user.email.split('@')[0];

            if (fbStatusTitle) fbStatusTitle.textContent = `Signed in as ${user.displayName || user.email}`;
            if (fbStatusDesc) fbStatusDesc.textContent = 'Your API keys and conversations are synced with your account.';
            if (fbStatusIcon) fbStatusIcon.textContent = '';
            if (modalGoogleBtn) modalGoogleBtn.textContent = 'Sign Out';

            // Clear any previous user state from memory so accounts NEVER mix
            conversations = [];
            currentSessionId = null;
            apiKeys = [];
            renderHistoryList();
            if (messagesContainer) messagesContainer.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';

            // Load & sync data from cloud for this specific user UID
            loadUserDataFromFirebase(user.uid);
          } else {
            // Logged Out state
            conversations = [];
            currentSessionId = null;
            apiKeys = [];
            renderHistoryList();
            if (messagesContainer) messagesContainer.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';

            if (loginModal) loginModal.setAttribute('aria-hidden', 'false');
            if (googleLoginBtn) googleLoginBtn.style.display = 'flex';
            if (userProfile) userProfile.style.display = 'none';

            if (fbStatusTitle) fbStatusTitle.textContent = 'Google Authentication';
            if (fbStatusDesc) fbStatusDesc.textContent = 'Sign in with Google to access your account.';
            if (fbStatusIcon) fbStatusIcon.textContent = '';
            if (modalGoogleBtn) modalGoogleBtn.textContent = 'Sign in with Google';
          }
        });
      } else {
        if (loginModal) loginModal.setAttribute('aria-hidden', 'false');
      }
    } catch (err) {
      console.warn('Firebase init note:', err.message);
    }
  }

  initFirebaseApp();

  if (saveFbConfigBtn) {
    saveFbConfigBtn.addEventListener('click', () => {
      firebaseConfig = {
        apiKey: fbApiKeyInput ? fbApiKeyInput.value.trim() : '',
        authDomain: fbAuthDomainInput ? fbAuthDomainInput.value.trim() : '',
        projectId: fbProjectIdInput ? fbProjectIdInput.value.trim() : '',
        storageBucket: fbStorageBucketInput ? fbStorageBucketInput.value.trim() : '',
        appId: fbAppIdInput ? fbAppIdInput.value.trim() : ''
      };
      localStorage.setItem('omnichat_firebase_config', JSON.stringify(firebaseConfig));
      initFirebaseApp();
      toast('Firebase Cloud credentials saved!');
    });
  }

  let isLoggingIn = false;

  async function handleGoogleSignIn() {
    console.log('Google Sign-in button clicked');
    if (isLoggingIn) return;
    isLoggingIn = true;

    if (gateGoogleBtn) gateGoogleBtn.innerHTML = '<span>Connecting to Google...</span>';
    if (googleLoginBtn) googleLoginBtn.innerHTML = '<span>Connecting to Google...</span>';

    try {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        alert('Firebase Auth SDK is not loaded yet. Please check your internet connection or refresh the page.');
        return;
      }

      // Hardcode/ensure Firebase config from .env or fallback
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('Demo')) {
        try {
          const configRes = await fetch(getApiUrl('/api/config')).catch(() => null);
          if (configRes && configRes.ok) {
            const envConfig = await configRes.json();
            if (envConfig.apiKey && envConfig.apiKey.length > 10) {
              firebaseConfig = envConfig;
            }
          }
        } catch (e) {}
      }

      if (firebase.apps.length) {
        const currentConfig = firebase.app().options;
        if (currentConfig && currentConfig.apiKey !== firebaseConfig.apiKey) {
          try { await firebase.app().delete(); } catch (e) {}
        }
      }

      if (!firebase.apps.length) {
        try {
          firebase.initializeApp(firebaseConfig);
        } catch (e) {
          console.warn('InitializeApp error:', e.message);
        }
      }

      if (!firebase.apps.length || !firebase.auth) {
        alert('Firebase App failed to initialize. Please check your .env credentials.');
        return;
      }

      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      // Trigger sign-in with popup
      try {
        const res = await firebase.auth().signInWithPopup(provider);
        if (res && res.user) {
          toast(`Welcome ${res.user.displayName || 'User'}!`);
          if (loginModal) loginModal.setAttribute('aria-hidden', 'true');
        }
      } catch (popupErr) {
        console.warn('Popup login note:', popupErr.code, popupErr.message);
        if (popupErr.code === 'auth/unauthorized-domain') {
          const currentHost = window.location.hostname;
          alert(`Firebase Domain Error!\n\nYour deployment domain ("${currentHost}") is NOT authorized in Firebase.\n\nTo fix:\n1. Open Firebase Console → Authentication → Settings → Authorized Domains\n2. Add "${currentHost}" to the list.\n3. Save and try again.`);
        } else if (popupErr.code === 'auth/operation-not-allowed') {
          alert('Google Provider Disabled!\n\nPlease open Firebase Console → Authentication → Sign-in method → Google and click Enable!');
        } else if (popupErr.code === 'auth/invalid-api-key' || popupErr.code === 'auth/api-key-not-valid') {
          alert('Invalid Firebase API Key!\n\nPlease check your FIREBASE_API_KEY in your .env file.');
        } else if (popupErr.code === 'auth/popup-closed-by-user' || popupErr.code === 'auth/cancelled-popup-request') {
          console.log('User closed popup or cancelled sign-in.');
        } else {
          console.warn('Other sign-in note:', popupErr.message || popupErr);
        }
      }
    } catch (err) {
      console.error('Google Sign in error:', err);
      alert(`Google Sign-in Error: ${err.message || err}`);
    } finally {
      isLoggingIn = false;
      if (gateGoogleBtn) gateGoogleBtn.innerHTML = '<svg viewBox="0 0 24 24" class="google-icon"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg><span>Continue with Google</span>';
    }
  }

  window.handleGoogleSignIn = handleGoogleSignIn;

  if (gateGoogleBtn) gateGoogleBtn.addEventListener('click', (e) => { e.preventDefault(); handleGoogleSignIn(); });
  if (googleLoginBtn) googleLoginBtn.addEventListener('click', (e) => { e.preventDefault(); handleGoogleSignIn(); });
  if (modalGoogleBtn) modalGoogleBtn.addEventListener('click', (e) => { e.preventDefault(); handleGoogleSignIn(); });

  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      firebase.auth().signOut().then(() => {
        currentUser = null;
        conversations = [];
        currentSessionId = null;
        apiKeys = [];
        renderHistoryList();
        if (messagesContainer) messagesContainer.innerHTML = '';
        if (emptyState) emptyState.style.display = 'flex';
        toast('Signed out successfully.');
      });
    }
  });

  async function syncUserDataToFirebase() {
    if (!currentUser || !db) return;
    try {
      const userSessionKey = `omnichat_sessions_${currentUser.uid}`;
      const userKeysKey = `omnichat_api_keys_${currentUser.uid}`;
      const userActiveSessionKey = `omnichat_active_session_${currentUser.uid}`;

      localStorage.setItem(userSessionKey, JSON.stringify(conversations));
      localStorage.setItem(userKeysKey, JSON.stringify(apiKeys));
      if (currentSessionId) localStorage.setItem(userActiveSessionKey, currentSessionId);

      await db.collection('users').doc(currentUser.uid).set({
        apiKeys: apiKeys,
        connectedModels: connectedModels,
        defaultModel: defaultModel,
        conversations: conversations,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Cloud sync background note:', e.message);
    }
  }

  async function loadUserDataFromFirebase(uid) {
    if (!db) return;

    const userSessionKey = `omnichat_sessions_${uid}`;
    const userKeysKey = `omnichat_api_keys_${uid}`;
    const userActiveSessionKey = `omnichat_active_session_${uid}`;

    try {
      const doc = await db.collection('users').doc(uid).get();
      if (doc.exists) {
        const data = doc.data();

        // Account-scoped API keys
        if (data.apiKeys && Array.isArray(data.apiKeys)) {
          apiKeys = data.apiKeys;
        } else {
          apiKeys = [];
        }
        localStorage.setItem(userKeysKey, JSON.stringify(apiKeys));
        localStorage.setItem('omnichat_api_keys', JSON.stringify(apiKeys));

        if (data.connectedModels) connectedModels = data.connectedModels;
        if (data.defaultModel) defaultModel = data.defaultModel;

        // Account-scoped conversations
        if (data.conversations && Array.isArray(data.conversations)) {
          conversations = data.conversations;
        } else {
          conversations = [];
        }
        localStorage.setItem(userSessionKey, JSON.stringify(conversations));
        localStorage.setItem('omnichat_sessions', JSON.stringify(conversations));

      } else {
        // New User in Firestore! Load from user-scoped localStorage if present or start clean
        conversations = JSON.parse(localStorage.getItem(userSessionKey)) || [];
        apiKeys = JSON.parse(localStorage.getItem(userKeysKey)) || [];
      }

      // Render updated account state
      renderHistoryList();
      updateActiveKeysBadge();
      loadKeyInputsFromState();

      const savedActiveId = localStorage.getItem(userActiveSessionKey) || localStorage.getItem('omnichat_active_session_id');
      if (conversations.length) {
        const targetId = (savedActiveId && conversations.some(s => s.id === savedActiveId)) ? savedActiveId : conversations[0].id;
        loadSession(targetId);
      } else {
        // Create initial fresh conversation for new user
        createNewSession();
      }

      // Check if user has 0 API keys saved after login
      const validCount = apiKeys.filter(k => k && k.trim().length > 5).length;
      if (validCount === 0) {
        openSettings('tab-keys');
        const apiKeyBanner = document.getElementById('api-key-banner');
        if (apiKeyBanner) {
          apiKeyBanner.innerHTML = `<strong>Welcome ${currentUser ? (currentUser.displayName || '') : ''}.</strong> Please add at least 1 OpenRouter API key to start chatting.`;
        }
        toast('Please add at least 1 OpenRouter API key to begin.');
      }

    } catch (e) {
      console.warn('Cloud load background note:', e.message);
    }
  }

  // ── 15. Resizable Canvas Panel Drag Handler ─────────────────────────────
  // FIX: panel width is controlled by CSS grid (grid-template-columns uses
  // var(--canvas-w)), so we MUST mutate the CSS variable — setting the panel's
  // inline width does nothing visible. Also adds touch support & persistence.
  const canvasResizer = document.getElementById('canvas-resizer');
  const CANVAS_W_KEY = 'omnichat_canvas_width';
  const DEFAULT_CANVAS_W = 460;

  const clampCanvasWidth = (w) => {
    const min = 320;
    const max = Math.max(min, window.innerWidth - 340);
    return Math.max(min, Math.min(max, w));
  };

  const setCanvasWidth = (w) => {
    const clamped = clampCanvasWidth(w);
    document.documentElement.style.setProperty('--canvas-w', `${clamped}px`);
    return clamped;
  };

  // Restore persisted width
  try {
    const saved = parseInt(localStorage.getItem(CANVAS_W_KEY), 10);
    if (!isNaN(saved) && saved >= 320) setCanvasWidth(saved);
  } catch (e) {}

  let isResizingCanvas = false;
  let startX = 0;
  let startWidth = DEFAULT_CANVAS_W;

  function beginResize(clientX) {
    isResizingCanvas = true;
    startX = clientX;
    // Read the ACTUAL rendered width from the CSS var / bounding box
    const cs = getComputedStyle(document.documentElement).getPropertyValue('--canvas-w').trim();
    startWidth = parseInt(cs, 10) || (canvasPanel ? canvasPanel.getBoundingClientRect().width : DEFAULT_CANVAS_W);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing-canvas');
  }

  function moveResize(clientX) {
    if (!isResizingCanvas) return;
    const diffX = startX - clientX; // drag left = grow
    setCanvasWidth(startWidth + diffX);
  }

  function endResize() {
    if (!isResizingCanvas) return;
    isResizingCanvas = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.classList.remove('is-resizing-canvas');
    try {
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--canvas-w'), 10);
      if (!isNaN(cur)) localStorage.setItem(CANVAS_W_KEY, String(cur));
    } catch (e) {}
  }

  if (canvasResizer && canvasPanel) {
    // Mouse
    canvasResizer.addEventListener('mousedown', (e) => { e.preventDefault(); beginResize(e.clientX); });
    document.addEventListener('mousemove', (e) => moveResize(e.clientX));
    document.addEventListener('mouseup', endResize);

    // Touch (tablet/phone in landscape)
    canvasResizer.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      beginResize(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!isResizingCanvas || e.touches.length !== 1) return;
      moveResize(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchend', endResize);
    document.addEventListener('touchcancel', endResize);

    // Keyboard nudge for accessibility (focus the handle + arrows)
    canvasResizer.setAttribute('tabindex', '0');
    canvasResizer.setAttribute('role', 'separator');
    canvasResizer.setAttribute('aria-orientation', 'vertical');
    canvasResizer.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 12;
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--canvas-w'), 10) || DEFAULT_CANVAS_W;
      if (e.key === 'ArrowLeft')      { setCanvasWidth(cur + step); e.preventDefault(); }
      else if (e.key === 'ArrowRight'){ setCanvasWidth(cur - step); e.preventDefault(); }
      else if (e.key === 'Home')      { setCanvasWidth(DEFAULT_CANVAS_W); e.preventDefault(); }
    });

    // Double-click = reset to default
    canvasResizer.addEventListener('dblclick', () => {
      setCanvasWidth(DEFAULT_CANVAS_W);
      try { localStorage.setItem(CANVAS_W_KEY, String(DEFAULT_CANVAS_W)); } catch (e) {}
    });

    // Re-clamp on viewport resize so canvas never exceeds available room
    window.addEventListener('resize', () => {
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--canvas-w'), 10);
      if (!isNaN(cur)) setCanvasWidth(cur);
    });
  }
});