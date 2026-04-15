/**
 * Sim2Real AI Chat Widget — Vanilla JS (no React, no build step)
 * Drop into any HTML page via: <script src="/js/chatbot-widget.js" defer></script>
 * 
 * Sends messages to POST /api/chat and renders a floating bottom-right chat bubble.
 * Requires: /api/chat endpoint returning { success: true, response: "..." }
 */
(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────────────── */
  var PRIMARY_COLOR = '#1256d6';   // SIM2Real brand blue
  var API_ENDPOINT = '/api/chat';
  var WELCOME_MSG   = 'Hi! I\'m the Sim2Real AI assistant. Ask me anything about sim-to-real transfer, digital twins, robotics simulation, or our platform.';
  var POSITION     = 'bottom-right';
  var STORAGE_KEY  = 'sim2real_chat_session';

  /* ── State ────────────────────────────────────────────────────────────── */
  var isOpen      = false;
  var messages    = [];
  var sessionId   = null;
  var isLoading  = false;

  /* ── Utilities ────────────────────────────────────────────────────────── */
  function uid() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scrollBottom() {
    var el = document.getElementById('s2r-chat-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function storeSession() {
    try { localStorage.setItem(STORAGE_KEY, sessionId); } catch (_) {}
  }

  function loadSession() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  /* ── SVG icons ────────────────────────────────────────────────────────── */
  var ICON_CHAT = '<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
  var ICON_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  /* ── Styles (injected once) ────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('s2r-chat-styles')) return;
    var css = document.createElement('style');
    css.id = 's2r-chat-styles';
    css.textContent = [
      '#s2r-chat-wrap *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '#s2r-chat-fab{position:fixed;width:56px;height:56px;border-radius:50%;background:' + PRIMARY_COLOR + ';border:none;box-shadow:0 4px 16px rgba(0,0,0,0.18);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:99998;transition:transform .2s,box-shadow .2s;outline:none}',
      '#s2r-chat-fab:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(0,0,0,0.22)}',
      '#s2r-chat-win{position:fixed;width:380px;height:540px;background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.22);display:flex;flex-direction:column;overflow:hidden;z-index:99999;right:20px;bottom:20px;opacity:0;transform:translateY(12px) scale(.97);pointer-events:none;transition:opacity .22s,transform .22s}',
      '#s2r-chat-win.open{opacity:1;transform:translateY(0) scale(1);pointer-events:all}',
      '#s2r-chat-header{background:' + PRIMARY_COLOR + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}',
      '#s2r-chat-header h4{margin:0;font-size:15px;font-weight:600}',
      '#s2r-chat-header p{margin:2px 0 0;font-size:12px;opacity:.85}',
      '#s2r-chat-close{background:rgba(255,255,255,.2);border:none;border-radius:6px;padding:5px 10px;cursor:pointer;color:#fff;font-size:13px;display:flex;align-items:center}',
      '#s2r-chat-msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:#f8f9fa}',
      '.s2r-msg{padding:9px 13px;border-radius:12px;font-size:14px;line-height:1.55;max-width:82%;word-break:break-word}',
      '.s2r-msg.assistant{align-self:flex-start;background:#fff;color:#1f2937;border:1px solid #e5e7eb}',
      '.s2r-msg.user{align-self:flex-end;background:' + PRIMARY_COLOR + ';color:#fff}',
      '.s2r-typing{display:flex;gap:5px;padding:10px 13px;border-radius:12px;background:#fff;border:1px solid #e5e7eb;align-self:flex-start;width:60px}',
      '.s2r-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af;animation:s2r-pulse 1.2s infinite ease-in-out}',
      '.s2r-dot:nth-child(2){animation-delay:.2s}.s2r-dot:nth-child(3){animation-delay:.4s}',
      '@keyframes s2r-pulse{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}',
      '#s2r-chat-input-row{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e5e7eb;background:#fff}',
      '#s2r-chat-input{flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:22px;font-size:14px;outline:none;transition:border-color .2s}',
      '#s2r-chat-input:focus{border-color:' + PRIMARY_COLOR + '}',
      '#s2r-chat-send{width:40px;height:40px;border-radius:50%;background:' + PRIMARY_COLOR + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;transition:opacity .2s}',
      '#s2r-chat-send:disabled{opacity:.45;cursor:not-allowed}',
      '#s2r-chat-error{padding:8px 12px;background:#fee2e2;color:#991b1b;border-radius:10px;font-size:13px;align-self:flex-start}',
      '@media(max-width:440px){#s2r-chat-win{width:calc(100vw - 32px);right:8px;bottom:8px}}'
    ].join('\n');
    document.head.appendChild(css);
  }

  /* ── Build DOM once ───────────────────────────────────────────────────── */
  function buildUI() {
    if (document.getElementById('s2r-chat-wrap')) return;
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 's2r-chat-wrap';
    wrap.innerHTML = [
      '<button id="s2r-chat-fab" aria-label="Open Sim2Real chat" title="Chat with us">',
        ICON_CHAT,
      '</button>',
      '<div id="s2r-chat-win" role="dialog" aria-label="Sim2Real AI Assistant" aria-modal="true">',
        '<div id="s2r-chat-header">',
          '<div>',
            '<h4>Sim2Real Assistant</h4>',
            '<p>AI-powered help</p>',
          '</div>',
          '<button id="s2r-chat-close" aria-label="Close chat">',
            ICON_CLOSE,
          '</button>',
        '</div>',
        '<div id="s2r-chat-msgs"></div>',
        '<div id="s2r-chat-input-row">',
          '<input id="s2r-chat-input" type="text" placeholder="Ask about sim-to-real, robotics, digital twins..." autocomplete="off" />',
          '<button id="s2r-chat-send" aria-label="Send message" disabled>',
            ICON_SEND,
          '</button>',
        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(wrap);

    /* FAB toggle */
    document.getElementById('s2r-chat-fab').addEventListener('click', toggleChat);
    document.getElementById('s2r-chat-close').addEventListener('click', toggleChat);

    /* Send on Enter or button click */
    var input  = document.getElementById('s2r-chat-input');
    var sendBtn = document.getElementById('s2r-chat-send');

    input.addEventListener('input', function () {
      sendBtn.disabled = !input.value.trim();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    sendBtn.addEventListener('click', sendMessage);
  }

  /* ── Toggle window ────────────────────────────────────────────────────── */
  function toggleChat() {
    isOpen = !isOpen;
    var win  = document.getElementById('s2r-chat-win');
    var fab  = document.getElementById('s2r-chat-fab');

    if (isOpen) {
      win.classList.add('open');
      fab.style.display = 'none';
      document.getElementById('s2r-chat-input').focus();

      /* Welcome message on first open */
      if (messages.length === 0) {
        appendMsg({ role: 'assistant', content: WELCOME_MSG });
      }
    } else {
      win.classList.remove('open');
      fab.style.display = 'flex';
    }
  }

  /* ── Append a message bubble ───────────────────────────────────────────── */
  function appendMsg(msg) {
    var container = document.getElementById('s2r-chat-msgs');
    var bubble    = document.createElement('div');
    bubble.className = 's2r-msg ' + esc(msg.role);
    bubble.innerHTML = esc(msg.content).replace(/\n/g, '<br>');
    container.appendChild(bubble);
    scrollBottom();
  }

  /* ── Show typing indicator ─────────────────────────────────────────────── */
  function showTyping() {
    var container = document.getElementById('s2r-chat-msgs');
    var typing    = document.createElement('div');
    typing.id = 's2r-typing';
    typing.className = 's2r-typing';
    typing.innerHTML = '<div class="s2r-dot"></div><div class="s2r-dot"></div><div class="s2r-dot"></div>';
    container.appendChild(typing);
    scrollBottom();
  }

  function hideTyping() {
    var el = document.getElementById('s2r-typing');
    if (el) el.remove();
  }

  /* ── Show error ───────────────────────────────────────────────────────── */
  function showError(text) {
    var container = document.getElementById('s2r-chat-msgs');
    var el = document.createElement('div');
    el.id = 's2r-chat-error';
    el.textContent = text;
    container.appendChild(el);
    scrollBottom();
    setTimeout(function () { if (el.parentNode) el.remove(); }, 5000);
  }

  /* ── Send message ─────────────────────────────────────────────────────── */
  function sendMessage() {
    var input  = document.getElementById('s2r-chat-input');
    var sendBtn = document.getElementById('s2r-chat-send');
    var text   = input.value.trim();
    if (!text || isLoading) return;

    /* Reset */
    input.value  = '';
    sendBtn.disabled = true;
    isLoading   = true;

    /* User bubble */
    messages.push({ role: 'user', content: text });
    appendMsg({ role: 'user', content: text });
    showTyping();

    /* POST to /api/chat */
    var controller = new AbortController();
    var timeout    = setTimeout(function () { controller.abort(); }, 12000);

    fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ message: text, sessionId: sessionId })
    })
      .then(function (res) {
        clearTimeout(timeout);
        if (!res.ok) throw new Error('Server error ' + res.status);
        return res.json();
      })
      .then(function (data) {
        hideTyping();
        if (data.success && data.response) {
          messages.push({ role: 'assistant', content: data.response });
          appendMsg({ role: 'assistant', content: data.response });
        } else {
          showError(data.error || 'Sorry, I couldn\'t get a response. Please try again.');
        }
      })
      .catch(function (err) {
        hideTyping();
        var msg = err.name === 'AbortError' ? 'Request timed out. Please try again.' : 'Network error — check your connection.';
        showError(msg);
      })
      .finally(function () {
        clearTimeout(timeout);
        isLoading = false;
        input.focus();
      });
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init() {
    sessionId = loadSession();
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      storeSession();
    }

    /* Defer DOM building until DOMContentLoaded */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildUI);
    } else {
      buildUI();
    }
  }

  init();
})();