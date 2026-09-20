// @ts-nocheck
import { settingsFieldStyles } from "./settings-fields.ts";
const ADDON_ID = "portainer";
const API = `/agent/addons/api/${ADDON_ID}`;
const DEFAULT_KEYCHAIN = "portainer/relay";

const preactHtm = globalThis.__qiushuiaiPreactHtm || globalThis.__qiushuiaiPreact || null;
const html = preactHtm?.html;
const useState = preactHtm?.useState;
const useEffect = preactHtm?.useEffect;
const useCallback = preactHtm?.useCallback;
const HAS_RUNTIME = Boolean(html && useState && useEffect && useCallback);

const ICON = HAS_RUNTIME
  ? html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="7" height="5.5" rx="1"></rect><rect x="13.5" y="7" width="7" height="5.5" rx="1"></rect><rect x="8.5" y="13.5" width="7" height="5.5" rx="1"></rect><path d="M12 13.5v-1.5"></path></svg>`
  : null;

async function loadKeychainHas(name) {
  try {
    const r = await fetch("/agent/keychain");
    if (!r.ok) return false;
    const data = await r.json();
    return (data.entries || []).some((entry) => entry.name === name);
  } catch {
    return false;
  }
}

async function setKeychainSecret(name, secret) {
  try {
    const r = await fetch("/agent/keychain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, secret, type: "secret" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function PortainerSettings() {
  if (!HAS_RUNTIME) return null;
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  const currentKeychain = (cfg?.api_token_keychain || DEFAULT_KEYCHAIN).trim() || DEFAULT_KEYCHAIN;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/config`);
      if (r.ok) {
        const data = await r.json();
        setCfg(data);
        setHasKey(await loadKeychainHas((data?.api_token_keychain || DEFAULT_KEYCHAIN).trim() || DEFAULT_KEYCHAIN));
      } else {
        setMsg("加载 Portainer 设置失败。");
      }
    } catch {
      setMsg("加载 Portainer 设置失败。");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch) => {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch(`${API}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (j.ok) {
        setCfg(j.config);
        setMsg("已保存。");
        setHasKey(await loadKeychainHas((j.config?.api_token_keychain || DEFAULT_KEYCHAIN).trim() || DEFAULT_KEYCHAIN));
        setTimeout(() => setMsg(""), 2500);
      } else {
        setMsg(j.error || "保存失败。");
      }
    } catch {
      setMsg("保存失败。");
    } finally {
      setSaving(false);
    }
  }, []);

  const saveToken = useCallback(async () => {
    const secret = keyInput.trim();
    if (!secret) return;
    setSaving(true);
    const keychainName = currentKeychain;
    const ok = await setKeychainSecret(keychainName, secret);
    setSaving(false);
    if (ok) {
      setHasKey(true);
      setKeyInput("");
      await save({ api_token_keychain: keychainName });
      setMsg(`Token 已保存到密钥链条目 ${keychainName}。`);
      setTimeout(() => setMsg(""), 5000);
    } else {
      setMsg("保存 token 失败。");
    }
  }, [currentKeychain, keyInput, save]);

  if (!cfg) return html`<div style="padding:1rem;color:var(--text-secondary)">加载中…</div>`;

  const S = { display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.4rem 0" };
  const L = { minWidth: "180px", color: "var(--text-secondary)", fontSize: "0.85rem" };
  const H = { margin: "1.2rem 0 0.4rem", fontSize: "0.9rem", color: "var(--text-primary)", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.3rem" };
  const hint = (t) => html`<div style=${{ fontSize: "0.73rem", color: "var(--text-secondary)", margin: "0 0 12px" }}>${t}</div>`;

  const checkbox = (label, key) => html`
    <label style=${S}><span style=${L}>${label}</span>
      <input type="checkbox" checked=${cfg[key]} onChange=${(e) => save({ [key]: e.target.checked })} disabled=${saving} />
    </label>`;

  const textField = (label, key, placeholder, extra = {}) => html`
    <label class="settings-addon-field"><span class="settings-addon-label">${label}</span>
      <input class="settings-addon-control" type="text" value=${cfg[key] ?? ""} style=${extra} placeholder=${placeholder || ""}
        onBlur=${(e) => { if (e.target.value !== (cfg[key] ?? "")) save({ [key]: e.target.value }); }}
        onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); }}
        disabled=${saving} />
    </label>`;

  return html`
    <div data-settings-addon="portainer" style="padding:0.5rem 0;min-width:0">
      <style>${settingsFieldStyles}</style>
      <h4 style=${H}>连接</h4>
      ${textField("主机 / IP", "host", "relay.local 或 192.168.1.20")}
      ${hint("可输入主机名、IP 或完整 URL；插件会将简写主机整理为 https://host:9443。")}
      ${checkbox("允许不安全 TLS", "allow_insecure_tls")}
      ${hint("使用自签名证书时保持启用。")}

      <h4 style=${H}>Token 密钥</h4>
      ${textField("密钥链条目", "api_token_keychain", DEFAULT_KEYCHAIN, { fontFamily: "var(--font-mono, monospace)" })}
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="portainer-secret">API token</label>
        <div class="settings-addon-control-group">
        <input id="portainer-secret" class="settings-addon-control" type="password" value=${keyInput} style="font-family:var(--font-mono, monospace)"
          placeholder=${hasKey ? "•••••••（已存入密钥链）" : "粘贴 Portainer API token"}
          onInput=${(e) => setKeyInput(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") saveToken(); }}
          disabled=${saving} />
        <button style="padding:4px 10px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:0.82rem"
          onClick=${saveToken} disabled=${!keyInput.trim() || saving}>保存</button>
        ${hasKey
          ? html`<span style="font-size:0.72rem;color:var(--accent-color,#2563eb);font-weight:600" title="密钥已存入密钥链">✓</span>`
          : html`<span style="font-size:0.72rem;color:var(--danger-color,#dc2626);font-weight:600" title="未设置密钥">✗</span>`}
        </div>
      </div>
      ${hint(`已保存到密钥链条目 ${currentKeychain}。`) }

      ${cfg.base_url && html`<div style=${{ marginTop: "0.9rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
        整理后的基础 URL：<code style="font-family:var(--font-mono, monospace)">${cfg.base_url}</code>
      </div>`}

      ${msg && html`<div style=${{ marginTop: "0.75rem", fontSize: "0.8rem", color: msg.includes("失败") ? "var(--danger-color)" : "var(--accent-color)" }}>${msg}</div>`}
    </div>`;
}

try {
  if (HAS_RUNTIME) {
    let reg, notify;
    const r = globalThis.__qiushuiaiSettingsPaneRegistry;
    if (r) { reg = r.registerSettingsPane; notify = r.notifySettingsPanesChanged; }
    if (!reg && globalThis.__qiushuiai_web?.registerSettingsPane) {
      reg = globalThis.__qiushuiai_web.registerSettingsPane;
      notify = () => globalThis.dispatchEvent?.(new CustomEvent("qiushuiai:settings-panes-changed"));
    }
    if (reg) {
      reg({ id: "portainer", label: "Portainer 管理", icon: ICON, component: PortainerSettings, order: 177 });
      notify?.();
    }
  }
} catch {}
