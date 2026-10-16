const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "mango-ai-chats-v1";
const API_BASE = (window.MANGO_API_BASE || "").replace(/\\/$/, "");
const THEME_KEY = "mango-ai-dark";
let chats = loadChats();
let activeId = chats[0]?.id || makeChat();
let pendingImage = null;
let busy = false;

function loadChats() {
  try { const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveChats() {
  // Avoid filling browser storage with image data; images are kept for the current session only.
  const stored = chats.slice(0, 40).map(c => ({
    ...c,
    messages: c.messages.map(({ image, ...m }) => m)
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}
function makeChat() {
  const chat = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), title: "New chat", messages: [] };
  chats.unshift(chat); saveChats(); return chat.id;
}
function currentChat() { return chats.find(c => c.id === activeId); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
// Small Markdown renderer: escapes HTML first, then adds basic formatting and fenced code.
function renderMarkdown(text) {
  let safe = escapeHtml(text);
  const blocks = [];
  safe = safe.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const token = `@@CODE${blocks.length}@@`;
    blocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return token;
  });
  safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^ )]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  safe = safe.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  return safe.replace(/@@CODE(\d+)@@/g, (_, n) => blocks[Number(n)] || "");
}
function renderChats() {
  $("chatList").innerHTML = chats.map(c => `<button class="chat-item ${c.id === activeId ? "active" : ""}" data-id="${escapeHtml(c.id)}">${escapeHtml(c.title || "New chat")}</button>`).join("");
}
function renderMessages() {
  const chat = currentChat();
  $("welcome").hidden = Boolean(chat?.messages.length);
  $("messages").innerHTML = (chat?.messages || []).map(m => `
    <article class="message ${m.role === "user" ? "user" : "assistant"}">
      <div class="avatar">${m.role === "user" ? "◉" : "🥭"}</div>
      <div class="message-body"><div class="message-role">${m.role === "user" ? "You" : "Mango AI"}</div>${m.image ? `<img src="${m.image}" alt="Uploaded image">` : ""}${renderMarkdown(m.content)}</div>
    </article>`).join("");
  $("conversation").scrollTop = $("conversation").scrollHeight;
}
function updateTitle(chat) {
  if (chat.title === "New chat" && chat.messages.length) {
    chat.title = chat.messages.find(m => m.role === "user")?.content.slice(0, 34) || "New chat";
  }
}
function setTheme(dark) {
  document.body.classList.toggle("dark", dark);
  localStorage.setItem(THEME_KEY, dark ? "1" : "0");
  $("themeToggle").innerHTML = dark ? "☀ <span>Toggle light mode</span>" : "☾ <span>Toggle dark mode</span>";
}
function setImage(file) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return alert("Please choose a PNG, JPEG, WEBP, or GIF image.");
  if (file.size > 4 * 1024 * 1024) return alert("Please choose an image under 4 MB.");
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { dataUrl: reader.result, name: file.name };
    $("imagePreview").hidden = false;
    $("imagePreview").innerHTML = `<img src="${reader.result}" alt="Image to send"><button type="button" class="remove-image" id="removeImage">Remove image ×</button>`;
    $("removeImage").onclick = clearImage;
  };
  reader.readAsDataURL(file);
}
function clearImage() {
  pendingImage = null; $("imageInput").value = ""; $("imagePreview").hidden = true; $("imagePreview").innerHTML = "";
}
async function sendMessage(text) {
  if (busy) return;
  const content = text.trim();
  if (!content && !pendingImage) return;
  const chat = currentChat();
  const imageForMessage = pendingImage?.dataUrl || null;
  chat.messages.push({ role: "user", content: content || "Please describe this image.", ...(imageForMessage ? { image: imageForMessage } : {}) });
  updateTitle(chat); saveChats(); renderChats(); renderMessages();
  $("prompt").value = ""; $("prompt").style.height = "auto";
  clearImage();
  busy = true; $("sendBtn").disabled = true;
  const typing = document.createElement("article");
  typing.className = "message"; typing.innerHTML = '<div class="avatar">🥭</div><div class="message-body"><div class="message-role">Mango AI</div><div class="typing">Thinking…</div></div>';
  $("messages").appendChild(typing); $("conversation").scrollTop = $("conversation").scrollHeight;
  try {
    const payloadMessages = chat.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: payloadMessages, ...(imageForMessage ? { image: { dataUrl: imageForMessage } } : {}) })
    });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    chat.messages.push({ role: "assistant", content: data.reply || "I couldn't create a response." });
    saveChats(); renderMessages();
  } catch (err) {
    typing.remove();
    chat.messages.push({ role: "assistant", content: `**Sorry, something went wrong.**\n\n${err.message}`, error: true });
    saveChats(); renderMessages();
  } finally { busy = false; $("sendBtn").disabled = false; $("prompt").focus(); }
}
$("chatForm").addEventListener("submit", e => { e.preventDefault(); sendMessage($("prompt").value); });
$("prompt").addEventListener("input", () => { const el = $("prompt"); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 180) + "px"; });
$("prompt").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chatForm").requestSubmit(); } });
$("newChat").onclick = () => { activeId = makeChat(); renderChats(); renderMessages(); $("prompt").focus(); $("sidebar").classList.remove("open"); };
$("chatList").onclick = e => { const b = e.target.closest("[data-id]"); if (!b) return; activeId = b.dataset.id; renderChats(); renderMessages(); $("sidebar").classList.remove("open"); };
$("themeToggle").onclick = () => setTheme(!document.body.classList.contains("dark"));
$("clearMemory").onclick = () => {
  if (confirm("Delete all Mango AI chats saved in this browser? This cannot be undone.")) {
    chats = []; activeId = makeChat(); renderChats(); renderMessages();
  }
};
$("attachBtn").onclick = () => $("imageInput").click();
$("imageInput").onchange = e => setImage(e.target.files[0]);
$("menuBtn").onclick = () => $("sidebar").classList.toggle("open");
document.querySelectorAll(".suggestion").forEach(b => b.onclick = () => sendMessage(b.dataset.prompt));

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
$("voiceBtn").onclick = () => {
  if (!SpeechRecognition) {
    alert("Voice input is not supported in this browser. Try Chrome or Edge, and allow microphone access.");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  $("voiceBtn").textContent = "⏺";
  recognition.onresult = e => { $("prompt").value = ($("prompt").value + " " + e.results[0][0].transcript).trim(); $("prompt").dispatchEvent(new Event("input")); };
  recognition.onerror = () => alert("Voice input failed. Check microphone permission and try again.");
  recognition.onend = () => $("voiceBtn").textContent = "🎙";
  recognition.start();
};

// Clicking the speaker control is delegated so it also works for newly-rendered replies.
$("messages").addEventListener("dblclick", e => {
  const article = e.target.closest(".message.assistant");
  if (!article || !("speechSynthesis" in window)) return;
  const text = article.querySelector(".message-body").innerText;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
});

setTheme(localStorage.getItem(THEME_KEY) === "1");
if (!chats.length) activeId = makeChat();
renderChats(); renderMessages();
