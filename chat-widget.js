// Sim2Real Sales Rep Chat Widget
// Works with existing /api/chat endpoint (no changes needed)

(function() {
  const ACCENT = '#1256d6';
  const ACCENT_HOVER = '#0e45ad';
  let isOpen = false;
  let messages = [];

  const WELCOME = "Hi, I'm your Sim2Real guide. Ask me about simulation-to-real transfer, digital twins, pricing, or getting started with a pilot.";

  function createWidget() {
    const styles = document.createElement('style');
    styles.textContent = `
      .s2r-chat-toggle {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_HOVER} 100%);
        border: none;
        box-shadow: 0 4px 20px rgba(18,86,214,0.35);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .s2r-chat-toggle:hover { transform: scale(1.06); box-shadow: 0 6px 28px rgba(18,86,214,0.5); }
      .s2r-chat-toggle svg { width: 26px; height: 26px; fill: white; }
      .s2r-chat-panel {
        position: fixed;
        bottom: 92px;
        right: 24px;
        width: 380px;
        height: 540px;
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 8px 48px rgba(0,0,0,0.16);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(18,86,214,0.12);
        z-index: 9998;
        animation: s2rSlideIn 0.25s ease-out;
      }
      @keyframes s2rSlideIn {
        from { opacity: 0; transform: translateY(12px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .s2r-chat-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_HOVER} 100%);
        color: #fff;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .s2r-chat-header h3 { margin: 0; font-size: 15px; font-weight: 700; }
      .s2r-chat-header p { margin: 2px 0 0; font-size: 11px; opacity: 0.88; }
      .s2r-chat-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        cursor: pointer;
        font-size: 17px;
        padding: 4px 10px;
        border-radius: 6px;
        line-height: 1;
      }
      .s2r-chat-close:hover { background: rgba(255,255,255,0.3); }
      .s2r-chat-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #f8f9fc;
      }
      .s2r-msg {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 14px;
        line-height: 1.55;
        word-break: break-word;
      }
      .s2r-msg.bot {
        align-self: flex-start;
        background: #fff;
        color: #16202f;
        border: 1px solid rgba(18,86,214,0.12);
        border-radius: 14px 14px 14px 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07);
      }
      .s2r-msg.user {
        align-self: flex-end;
        background: ${ACCENT};
        color: #fff;
        border-radius: 14px 14px 4px 14px;
        box-shadow: 0 2px 8px rgba(18,86,214,0.25);
      }
      .s2r-typing {
        max-width: 85%;
        align-self: flex-start;
        background: #fff;
        padding: 12px 16px;
        border-radius: 14px 14px 14px 4px;
        border: 1px solid rgba(18,86,214,0.12);
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .s2r-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: ${ACCENT};
        animation: s2rBounce 1.2s infinite ease-in-out;
      }
      .s2r-dot:nth-child(2) { animation-delay: 0.15s; }
      .s2r-dot:nth-child(3) { animation-delay: 0.30s; }
      @keyframes s2rBounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-5px); opacity: 1; }
      }
      .s2r-chat-input {
        padding: 12px 16px;
        border-top: 1px solid rgba(18,86,214,0.1);
        background: #fff;
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .s2r-chat-input input {
        flex: 1;
        padding: 10px 16px;
        border-radius: 24px;
        border: 1.5px solid rgba(18,86,214,0.18);
        font-size: 14px;
        outline: none;
        font-family: inherit;
        color: #16202f;
      }
      .s2r-chat-input input:focus { border-color: ${ACCENT}; }
      .s2r-chat-input button {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_HOVER} 100%);
        border: none;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: opacity 0.2s;
      }
      .s2r-chat-input button:disabled { opacity: 0.45; cursor: not-allowed; }
      .s2r-chat-input button svg { width: 17px; height: 17px; fill: currentColor; }
      @media (max-width: 440px) {
        .s2r-chat-panel { width: calc(100vw - 32px); right: 16px; left: 16px; bottom: 88px; }
        .s2r-chat-toggle { right: 16px; bottom: 16px; }
      }
    `;
    document.head.appendChild(styles);

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 's2r-chat-toggle';
    toggle.setAttribute('aria-label', 'Open Sim2Real Assistant');
    toggle.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    toggle.onclick = toggleChat;
    document.body.appendChild(toggle);

    // Panel
    const panel = document.createElement('div');
    panel.className = 's2r-chat-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="s2r-chat-header">
        <div>
          <h3>Sim2Real Assistant</h3>
          <p>Simulation-to-real transfer help</p>
        </div>
        <button class="s2r-chat-close" aria-label="Close">✕</button>
      </div>
      <div class="s2r-chat-body"></div>
      <div class="s2r-chat-input">
        <input type="text" placeholder="Ask about Sim2Real…" />
        <button aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
      </div>
    `;
    document.body.appendChild(panel);

    // Event listeners
    panel.querySelector('.s2r-chat-close').onclick = () => setOpen(false);
    const input = panel.querySelector('.s2r-chat-input input');
    const sendBtn = panel.querySelector('.s2r-chat-input button');
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    sendBtn.onclick = send;

    function setOpen(open) {
      isOpen = open;
      panel.style.display = open ? 'flex' : 'none';
      toggle.style.display = open ? 'none' : 'flex';
      if (open && messages.length === 0) {
        addMessage('bot', WELCOME);
      }
    }

    function toggleChat() { setOpen(!isOpen); }

    function addMessage(role, content) {
      messages.push({ role, content });
      const body = panel.querySelector('.s2r-chat-body');
      const div = document.createElement('div');
      div.className = `s2r-msg ${role}`;
      div.textContent = content;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }

    function showTyping() {
      const body = panel.querySelector('.s2r-chat-body');
      const div = document.createElement('div');
      div.className = 's2r-typing';
      div.id = 's2r-typing';
      div.innerHTML = '<div class="s2r-dot"></div><div class="s2r-dot"></div><div class="s2r-dot"></div>';
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }

    function hideTyping() {
      const el = document.getElementById('s2r-typing');
      if (el) el.remove();
    }

    async function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendBtn.disabled = true;
      addMessage('user', text);
      showTyping();

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: AbortSignal.timeout(15000)
        });
        const data = await res.json();
        hideTyping();
        if (data.success && data.response) {
          addMessage('bot', data.response);
        } else {
          addMessage('bot', "I'm having trouble responding right now. Please try again or email us at hello@sim2real.dev.");
        }
      } catch {
        hideTyping();
        addMessage('bot', "Network error. Please check your connection and try again.");
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();