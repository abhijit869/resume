const CHATS_KEY = "chats";
const msgKey = (id) => `msg:${id}`;
const FALLBACK_MODELS = [
  { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash" },
];
const STARTERS = [
  "Explain Puter.js like I am shipping a weekend product.",
  "Write a tight TypeScript helper for retrying fetch calls.",
  "Plan a 20-minute workout I can do at home.",
  "Compare streaming vs non-streaming LLM UIs.",
];

const els = {
  sidebar: document.getElementById("sidebar"),
  backdrop: document.getElementById("backdrop"),
  chatList: document.getElementById("chat-list"),
  thread: document.getElementById("thread"),
  prompt: document.getElementById("prompt"),
  composer: document.getElementById("composer"),
  sendBtn: document.getElementById("send-btn"),
  stopBtn: document.getElementById("stop-btn"),
  model: document.getElementById("model"),
  webSearch: document.getElementById("web-search"),
  authBtn: document.getElementById("auth-btn"),
  userName: document.getElementById("user-name"),
  userHint: document.getElementById("user-hint"),
  userAvatar: document.getElementById("user-avatar"),
  attachPreview: document.getElementById("attach-preview"),
  fileInput: document.getElementById("file-input"),
};

const state = {
  chats: {},
  messages: {},
  currentId: null,
  busy: false,
  abort: null,
  attachment: null,
};

function uid() {
  return crypto.randomUUID();
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMarkdown(src) {
  const escaped = escapeHtml(src || "");
  const withCode = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang || "text"}">${code.trim()}</code></pre>`;
  });
  const withInline = withCode.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withBold = withInline.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/(^|[^\*])\*([^*]+)\*/g, "$1<em>$2</em>");
  const withLinks = withItalic.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return withLinks
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("<pre>")) return block;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*]\s/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${line.replace(/^[-*]\s/, "")}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

function sortedChats() {
  return Object.entries(state.chats)
    .map(([id, chat]) => ({ id, ...chat }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function kvGet(key, fallback) {
  try {
    if (puter.auth.isSignedIn()) {
      const value = await puter.kv.get(key);
      if (value != null) return value;
    }
  } catch {
    /* fall through to local cache */
  }
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}

async function kvSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (puter.auth.isSignedIn()) {
    await puter.kv.set(key, value);
  }
}

async function kvDel(key) {
  localStorage.removeItem(key);
  if (puter.auth.isSignedIn()) {
    await puter.kv.del(key);
  }
}

async function persistChats() {
  await kvSet(CHATS_KEY, state.chats);
}

async function persistMessages(id) {
  await kvSet(msgKey(id), state.messages[id] || []);
}

function setBusy(busy) {
  state.busy = busy;
  els.sendBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.prompt.disabled = busy;
}

async function refreshUser() {
  const signedIn = puter.auth.isSignedIn();
  els.authBtn.textContent = signedIn ? "Sign out" : "Sign in";
  if (!signedIn) {
    els.userName.textContent = "Not signed in";
    els.userHint.textContent = "Sign in to save chats";
    els.userAvatar.textContent = "?";
    return;
  }
  try {
    const user = await puter.auth.getUser();
    const name = user.username || user.email || "Signed in";
    els.userName.textContent = name;
    els.userHint.textContent = "Chats saved to your Puter KV";
    els.userAvatar.textContent = String(name).slice(0, 1).toUpperCase();
  } catch {
    els.userName.textContent = "Signed in";
    els.userHint.textContent = "Chats saved to your Puter KV";
  }
}

function fillModelSelect(models) {
  const preferred = ["gpt-5.4-nano", "gpt-5.5", "claude-sonnet-4-5", "claude-opus-4-8"];
  const sorted = [...models].sort((a, b) => {
    const ai = preferred.indexOf(a.id);
    const bi = preferred.indexOf(b.id);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });
  const current = els.model.value;
  els.model.innerHTML = sorted
    .slice(0, 80)
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`)
    .join("");
  if (current && [...els.model.options].some((opt) => opt.value === current)) {
    els.model.value = current;
  }
}

async function loadModels() {
  fillModelSelect(FALLBACK_MODELS);
  try {
    const listed = await puter.ai.listModels();
    if (!Array.isArray(listed) || !listed.length) return;
    const models = listed
      .map((item) => ({
        id: typeof item === "string" ? item : item.id,
        name: typeof item === "string" ? item : item.name || item.id,
        provider: item.provider,
      }))
      .filter((item) => item.id && !String(item.id).includes(":"));
    if (models.length) fillModelSelect(models);
  } catch {
    /* keep fallbacks */
  }
}

function renderChatList() {
  const chats = sortedChats();
  if (!chats.length) {
    els.chatList.innerHTML = `<p class="user-hint" style="padding:8px">No conversations yet.</p>`;
    return;
  }
  els.chatList.innerHTML = chats
    .map((chat) => {
      const active = chat.id === state.currentId ? "active" : "";
      const when = chat.updatedAt
        ? new Date(chat.updatedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      return `<button class="chat-item ${active}" data-id="${chat.id}" type="button">
        <div class="title">${escapeHtml(chat.title || "New chat")}</div>
        <div class="meta">${escapeHtml(when)}</div>
      </button>`;
    })
    .join("");
}

function renderEmpty() {
  els.thread.innerHTML = `
    <div class="empty">
      <h1>What do you want to think through?</h1>
      <p>Streaming chat with 500+ models. You pay with your Puter account — this app never holds an API key.</p>
      <div class="suggestions">
        ${STARTERS.map((text) => `<button class="suggestion" type="button">${escapeHtml(text)}</button>`).join("")}
      </div>
    </div>`;
  els.thread.querySelectorAll(".suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.prompt.value = btn.textContent;
      els.prompt.focus();
    });
  });
}

function messageHtml(msg) {
  const role = msg.role === "user" ? "user" : "assistant";
  const label = role === "user" ? "You" : "AI";
  const images = (msg.images || [])
    .map((img) => `<p><img alt="Generated" src="${escapeHtml(img)}" style="max-width:100%;border-radius:12px"></p>`)
    .join("");
  const attachment = msg.attachment
    ? `<p><img alt="Attachment" src="${escapeHtml(msg.attachment)}" style="max-width:220px;border-radius:12px"></p>`
    : "";
  const reasoning = msg.reasoning
    ? `<div class="reasoning">${escapeHtml(msg.reasoning)}</div>`
    : "";
  const usage = msg.usage
    ? `<div class="usage">${escapeHtml(msg.usage)}</div>`
    : "";
  return `<article class="message ${role}">
    <div class="avatar ${role}">${label.slice(0, 2)}</div>
    <div class="bubble">
      ${reasoning}
      ${attachment}
      <div class="md">${renderMarkdown(msg.content || "")}</div>
      ${images}
      ${usage}
    </div>
  </article>`;
}

function renderThread() {
  const messages = state.messages[state.currentId] || [];
  if (!messages.length) {
    renderEmpty();
    return;
  }
  els.thread.innerHTML = messages.map(messageHtml).join("");
  els.thread.scrollTop = els.thread.scrollHeight;
}

function errorText(error) {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.msg) return error.msg;
  if (error.error) return typeof error.error === "string" ? error.error : errorText(error.error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function titleFrom(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "New chat";
}

async function ensureChat() {
  if (state.currentId && state.chats[state.currentId]) return state.currentId;
  const id = uid();
  state.chats[id] = {
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model: els.model.value,
  };
  state.messages[id] = [];
  state.currentId = id;
  await persistChats();
  await persistMessages(id);
  renderChatList();
  return id;
}

async function openChat(id) {
  state.currentId = id;
  if (!state.messages[id]) {
    state.messages[id] = (await kvGet(msgKey(id), [])) || [];
  }
  if (state.chats[id]?.model) {
    els.model.value = state.chats[id].model;
  }
  renderChatList();
  renderThread();
}

async function newChat() {
  state.currentId = null;
  renderChatList();
  renderEmpty();
  els.prompt.focus();
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.backdrop.hidden = true;
}

function toApiMessages(messages) {
  return messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      if (msg.compaction) {
        return {
          role: "assistant",
          content: [msg.compaction, { type: "text", text: msg.content || "" }],
        };
      }
      return { role: msg.role, content: msg.content || "" };
    });
}

function formatUsage(part) {
  const details = part.usageDetails || {};
  const inTok = details.inputTokens ?? part.usage?.prompt_tokens;
  const outTok = details.outputTokens ?? part.usage?.completion_tokens;
  const bits = [];
  if (inTok != null) bits.push(`${inTok} in`);
  if (outTok != null) bits.push(`${outTok} out`);
  if (part.usage?.cost != null) {
    bits.push(`$${(part.usage.cost / 100_000_000).toFixed(4)}`);
  }
  return bits.join(" · ");
}

async function sendMessage(text) {
  const prompt = (text || els.prompt.value).trim();
  if (!prompt || state.busy) return;

  const id = await ensureChat();
  const chat = state.chats[id];
  const userMsg = { role: "user", content: prompt };
  if (state.attachment) userMsg.attachment = state.attachment;
  state.messages[id].push(userMsg);
  if (chat.title === "New chat") chat.title = titleFrom(prompt);
  chat.updatedAt = Date.now();
  chat.model = els.model.value;

  els.prompt.value = "";
  resizePrompt();
  clearAttachment();
  renderChatList();
  renderThread();

  const assistant = { role: "assistant", content: "", reasoning: "", images: [] };
  state.messages[id].push(assistant);
  renderThread();
  setBusy(true);
  state.abort = new AbortController();

  const options = {
    model: els.model.value,
    stream: true,
    signal: state.abort.signal,
    compaction: true,
  };
  if (els.webSearch.checked) options.tools = [{ type: "web_search" }];

  try {
    const history = toApiMessages(state.messages[id].slice(0, -1));
    let response;
    if (userMsg.attachment) {
      const file = dataUrlToFile(userMsg.attachment);
      response = await puter.ai.chat(prompt, file, false, options);
    } else {
      response = await puter.ai.chat(
        [{ role: "system", content: "You are Puter Chat, a concise, capable assistant." }, ...history],
        options
      );
    }

    for await (const part of response) {
      if (part.type === "text") assistant.content += part.text || "";
      else if (part.type === "reasoning") assistant.reasoning += part.reasoning || "";
      else if (part.type === "image" && part.image?.image_url?.url) {
        assistant.images.push(part.image.image_url.url);
      } else if (part.type === "compaction") {
        assistant.compaction = {
          type: "compaction",
          id: part.id,
          encrypted_content: part.encrypted_content,
        };
      } else if (part.type === "usage") {
        assistant.usage = formatUsage(part);
      } else if (part.type === "error") {
        assistant.content += `\n\nError: ${part.message || "The model stream failed."}`;
      }
      renderThread();
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      assistant.content = assistant.content || `Something went wrong: ${errorText(error)}`;
      renderThread();
    }
  } finally {
    setBusy(false);
    state.abort = null;
    chat.updatedAt = Date.now();
    await persistChats();
    await persistMessages(id);
    renderThread();
  }
}

function dataUrlToFile(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(meta)?.[1] || "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "attachment.png", { type: mime });
}

function resizePrompt() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 180)}px`;
}

function clearAttachment() {
  state.attachment = null;
  els.fileInput.value = "";
  els.attachPreview.hidden = true;
  els.attachPreview.innerHTML = "";
}

async function loadChats() {
  state.chats = (await kvGet(CHATS_KEY, {})) || {};
  const first = sortedChats()[0];
  if (first) await openChat(first.id);
  else renderEmpty();
  renderChatList();
}

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

els.prompt.addEventListener("input", resizePrompt);
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

document.getElementById("new-chat").addEventListener("click", () => {
  closeSidebar();
  newChat();
});

document.getElementById("delete-chat").addEventListener("click", async () => {
  if (!state.currentId) return;
  const id = state.currentId;
  delete state.chats[id];
  delete state.messages[id];
  await persistChats();
  await kvDel(msgKey(id));
  state.currentId = null;
  const next = sortedChats()[0];
  if (next) await openChat(next.id);
  else {
    renderChatList();
    renderEmpty();
  }
});

els.chatList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-id]");
  if (!item) return;
  closeSidebar();
  openChat(item.dataset.id);
});

els.stopBtn.addEventListener("click", () => state.abort?.abort());

document.getElementById("attach-btn").addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.attachment = reader.result;
    els.attachPreview.hidden = false;
    els.attachPreview.innerHTML = `<img alt="Selected" src="${reader.result}">`;
  };
  reader.readAsDataURL(file);
});

els.authBtn.addEventListener("click", async () => {
  try {
    if (puter.auth.isSignedIn()) {
      puter.auth.signOut();
    } else {
      await puter.auth.signIn();
    }
    await refreshUser();
    await loadChats();
  } catch (error) {
    els.userHint.textContent = error?.msg || error?.message || "Sign-in failed";
  }
});

document.getElementById("menu-btn").addEventListener("click", () => {
  els.sidebar.classList.add("open");
  els.backdrop.hidden = false;
});
els.backdrop.addEventListener("click", closeSidebar);

async function boot() {
  renderEmpty();
  fillModelSelect(FALLBACK_MODELS);
  await refreshUser();
  await loadChats();
  await loadModels();
}

boot();
