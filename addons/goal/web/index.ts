// @ts-nocheck
import { settingsFieldStyles } from "./settings-fields.ts";
const ADDON_ID = "goal";
const API = `/agent/addons/api/${ADDON_ID}/goal`;
const DEFAULT_CHAT_JID = "web:default";

const preactHtm = globalThis.__qiushuiaiPreactHtm || globalThis.__qiushuiaiPreact || null;
const html = preactHtm?.html;
const useState = preactHtm?.useState;
const useEffect = preactHtm?.useEffect;
const useCallback = preactHtm?.useCallback;
const HAS_RUNTIME = Boolean(html && useState && useEffect && useCallback);

const ICON = HAS_RUNTIME
  ? html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path></svg>`
  : null;

function normalizeChatJid(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_CHAT_JID;
}

function getCurrentChatJid() {
  const fromApi = normalizeChatJid(globalThis.__qiushuiai_web?.getCurrentChatJid?.());
  if (fromApi !== DEFAULT_CHAT_JID) return fromApi;
  const fromGlobal = normalizeChatJid(globalThis.__qiushuiaiCurrentChatJid);
  if (fromGlobal !== DEFAULT_CHAT_JID) return fromGlobal;
  try {
    const url = new URL(globalThis.location?.href || "https://example.test/");
    return normalizeChatJid(url.searchParams.get("chat_jid"));
  } catch {
    return DEFAULT_CHAT_JID;
  }
}

function withChat(url, chatJid) {
  const actual = normalizeChatJid(chatJid);
  return `${url}${url.includes("?") ? "&" : "?"}chat_jid=${encodeURIComponent(actual)}`;
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function loadGoal(chatJid) {
  return await apiJson(withChat(API, chatJid));
}

async function saveGoal(chatJid, patch) {
  return await apiJson(withChat(API, chatJid), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, chat_jid: normalizeChatJid(chatJid) }),
  });
}

function positiveOrEmpty(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function formatTokenCount(value) {
  const numeric = Math.max(0, Math.trunc(Number(value) || 0));
  if (numeric < 1000) return String(numeric);
  const units = ["k", "m", "b", "t"];
  let scaled = numeric;
  let unit = units[0];
  for (let i = 0; i < units.length; i += 1) {
    scaled = numeric / (1000 ** (i + 1));
    unit = units[i];
    if (scaled < 1000 || i === units.length - 1) break;
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$|(?<=\.\d)0+$/g, "")}${unit}`;
}

function statusLabel(status) {
  return ({
    active: "active",
    paused: "paused",
    blocked: "blocked",
    usage_limited: "usage limited",
    budget_limited: "budget limited",
    complete: "complete",
    stopped: "stopped",
  })[status] || "none";
}

function registerPane() {
  if (!HAS_RUNTIME) return;
  let reg, notify;
  const registry = globalThis.__qiushuiaiSettingsPaneRegistry;
  if (registry) {
    reg = registry.registerSettingsPane;
    notify = registry.notifySettingsPanesChanged;
  }
  if (!reg && globalThis.__qiushuiai_web?.registerSettingsPane) {
    reg = globalThis.__qiushuiai_web.registerSettingsPane;
    notify = () => globalThis.dispatchEvent?.(new CustomEvent("qiushuiai:settings-panes-changed"));
  }
  if (!reg) return;
  reg({ id: ADDON_ID, label: "目标管理", icon: ICON, component: GoalSettingsPane, order: 34 });
  notify?.();
}

function GoalSettingsPane() {
  if (!HAS_RUNTIME) return null;
  const [chatJid, setChatJid] = useState(getCurrentChatJid);
  const [response, setResponse] = useState(null);
  const [draftObjective, setDraftObjective] = useState("");
  const [draftBudget, setDraftBudget] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const goal = response?.goal || null;
  const remaining = response?.remainingTokens;

  const load = useCallback(async () => {
    setMessage("");
    const result = await loadGoal(chatJid);
    setResponse(result);
    setDraftObjective(result.goal?.objective || "");
    setDraftBudget(result.goal?.tokenBudget == null ? "" : String(result.goal.tokenBudget));
  }, [chatJid]);

  useEffect(() => { load().catch((error) => setMessage(String(error?.message || error))); }, [load]);

  useEffect(() => {
    const updateChatJid = () => setChatJid(getCurrentChatJid());
    globalThis.addEventListener?.("qiushuiai:current-chat-changed", updateChatJid);
    globalThis.addEventListener?.("popstate", updateChatJid);
    return () => {
      globalThis.removeEventListener?.("qiushuiai:current-chat-changed", updateChatJid);
      globalThis.removeEventListener?.("popstate", updateChatJid);
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const payload = event?.detail?.payload || event?.detail || {};
      if (payload?.key !== "goal.thread-goal-updated") return;
      if (normalizeChatJid(payload.chat_jid) !== chatJid) return;
      load().catch((error) => setMessage(String(error?.message || error)));
    };
    globalThis.addEventListener?.("qiushuiai-extension-ui:status", handler);
    return () => globalThis.removeEventListener?.("qiushuiai-extension-ui:status", handler);
  }, [chatJid, load]);

  const save = useCallback(async (patch, label = "目标已保存。") => {
    setSaving(true);
    try {
      const result = await saveGoal(chatJid, patch);
      setResponse(result);
      setDraftObjective(result.goal?.objective || "");
      setDraftBudget(result.goal?.tokenBudget == null ? "" : String(result.goal.tokenBudget));
      const queuedSuffix = result.continuationQueued ? " Server-side continuation queued." : "";
      setMessage(`${label}${queuedSuffix}`);
    } catch (error) {
      setMessage(String(error?.message || error));
    } finally {
      setSaving(false);
    }
  }, [chatJid]);

  const clear = useCallback(async () => {
    setSaving(true);
    try {
      const result = await saveGoal(chatJid, { objective: "" });
      setResponse(result);
      setDraftObjective("");
      setDraftBudget("");
      setMessage("目标状态已清除。");
    } catch (error) {
      setMessage(String(error?.message || error));
    } finally {
      setSaving(false);
    }
  }, [chatJid]);

  const S = { display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.45rem 0" };
  const L = { minWidth: "130px", color: "var(--text-secondary)", fontSize: "0.85rem", alignSelf: "flex-start", paddingTop: "0.35rem" };
  const H = { margin: "1.15rem 0 0.45rem", fontSize: "0.9rem", color: "var(--text-primary)", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.3rem" };
  const hint = (text) => html`<div style=${{ fontSize: "0.73rem", color: "var(--text-secondary)", margin: "0 0 12px" }}>${text}</div>`;

  return html`
    <div data-settings-addon="goal" style="padding:0.5rem 0;min-width:0">
      <style>${settingsFieldStyles}</style>
      <h4 style=${H}>Codex 风格的对话目标</h4>
      <div style=${{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
        Chat: <code style="font-family:var(--font-mono, monospace)">${chatJid}</code>
      </div>

      <div style=${{ padding: "0.6rem", border: "1px solid var(--border-color)", borderRadius: "8px", background: "var(--bg-secondary)" }}>
        <div><strong>状态：</strong> ${statusLabel(goal?.status)}</div>
        <div><strong>Token：</strong> ${formatTokenCount(goal?.tokensUsed || 0)}${goal?.tokenBudget == null ? " / 无上限" : ` / ${formatTokenCount(goal.tokenBudget)}（剩余 ${formatTokenCount(remaining || 0)}）`}</div>
        <div><strong>用时：</strong> ${goal?.timeUsedSeconds || 0}秒</div>
      </div>

      <label class="settings-addon-field">
        <span class="settings-addon-label">目标</span>
        <textarea class="settings-addon-control" style="min-height:96px" value=${draftObjective}
          placeholder="请描述完整目标；保存后会替换当前对话目标。"
          onInput=${(e) => setDraftObjective(e.target.value)}
          disabled=${saving}></textarea>
      </label>
      ${hint("Use /goal <objective> to start from chat, or save here to replace the thread goal and queue a server-side continuation.")}

      <label class="settings-addon-field">
        <span class="settings-addon-label">Token 预算</span>
        <input class="settings-addon-control" type="number" min="1" step="1000" value=${draftBudget}
          placeholder="无上限"
          onInput=${(e) => setDraftBudget(e.target.value)}
          disabled=${saving} />
      </label>
      ${hint("Empty means no token budget. Budget exhaustion marks the goal budget_limited and emits a wrap-up prompt.")}

      <div style=${{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <button onClick=${() => save({ objective: draftObjective, token_budget: positiveOrEmpty(draftBudget) }, "目标已保存并替换。")} disabled=${saving || !draftObjective.trim()}>保存/替换并运行</button>
        <button onClick=${() => save({ status: "active", token_budget: positiveOrEmpty(draftBudget) }, "目标已继续。")} disabled=${saving || !goal}>继续并运行</button>
        <button onClick=${() => save({ status: "paused", token_budget: positiveOrEmpty(draftBudget) }, "目标已暂停。")} disabled=${saving || !goal}>暂停</button>
        <button onClick=${() => save({ status: "blocked", token_budget: positiveOrEmpty(draftBudget) }, "目标已标记为受阻。")} disabled=${saving || !goal}>标记受阻</button>
        <button onClick=${() => save({ status: "complete", token_budget: positiveOrEmpty(draftBudget) }, "目标已标记完成。")} disabled=${saving || !goal}>标记完成</button>
        <button onClick=${() => clear()} disabled=${saving || !goal}>清除</button>
        <button onClick=${() => load()} disabled=${saving}>刷新</button>
      </div>

      <h4 style=${H}>模型工具</h4>
      <div style=${{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
        The add-on exposes Codex-style <code>get_goal</code>, <code>create_goal</code>, <code>goal_complete</code>, <code>goal_stop</code>, and <code>update_goal</code>. Prefer <code>goal_complete</code> for verified completion when available, but <code>update_goal(status=&quot;complete&quot;)</code> remains the Codex-compatible completion path. These tools update goal state without early-terminating the QiushuiAI turn, so agents can still send a final user-visible answer. Use <code>goal_stop</code> to stop the loop without marking complete.
      </div>

      ${message ? html`<div style=${{ marginTop: "0.75rem", fontSize: "0.8rem", color: /failed|error/i.test(message) ? "var(--danger-color,#dc2626)" : "var(--accent-color,#2563eb)" }}>${message}</div>` : null}
    </div>`;
}

try {
  registerPane();
  if (typeof window !== "undefined") {
    window.addEventListener("qiushuiai:addons-loaded", () => { try { registerPane(); } catch {} });
  }
} catch {}
