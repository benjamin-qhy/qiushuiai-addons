// Uses each skin's add-on settings controls and the direct authenticated backend API.
export default function register(api: any) {
  const preact =
    (globalThis as any).__piclawPreactHtm || (globalThis as any).__piclawPreact;
  if (!preact) return;
  const { html, useEffect, useState } = preact;
  const base = "/agent/addons/api/a2a/";
  const defaults = {
    enabled: false,
    inbound: false,
    outbound: false,
    publicBaseUrl: "",
    principals: [],
    endpoints: [],
    agents: [],
  };
  async function request(action: string, value?: unknown) {
    const res = await fetch(base + action, {
      method: value === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        value === undefined ? {} : { "Content-Type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function Panel() {
    const [config, setConfig] = useState(defaults),
      [principals, setPrincipals] = useState("[]"),
      [agents, setAgents] = useState("[]"),
      [endpoints, setEndpoints] = useState("[]");
    const [busy, setBusy] = useState(true),
      [error, setError] = useState(""),
      [notice, setNotice] = useState(""),
      [status, setStatus] = useState(null),
      [tasks, setTasks] = useState(null),
      [confirm, setConfirm] = useState(false);
    function populate(next: any) {
      setConfig({ ...defaults, ...next });
      setPrincipals(JSON.stringify(next.principals || [], null, 2));
      setAgents(JSON.stringify(next.agents || [], null, 2));
      setEndpoints(JSON.stringify(next.endpoints || [], null, 2));
      setConfirm(false);
    }
    useEffect(() => {
      let cancelled = false;
      Promise.all([request("config"), request("status")])
        .then(([cfg, state]) => {
          if (!cancelled) {
            populate(cfg);
            setStatus(state);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
      return () => {
        cancelled = true;
      };
    }, []);
    async function save(disable = false) {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        if (config.enabled && !disable && !confirm)
          throw new Error("Confirm reviewed grants before enabling A2A.");
        const next = disable
          ? { ...config, enabled: false }
          : {
              ...config,
              principals: JSON.parse(principals),
              agents: JSON.parse(agents),
              endpoints: JSON.parse(endpoints),
            };
        const result = await request("config", next);
        populate(result.config);
        setStatus(await request("status"));
        setNotice(
          disable
            ? "A2A disabled. Active transport requests stopped; admitted work remains governed by core."
            : "Settings saved.",
        );
      } catch (e: any) {
        setError(e.message || "Unable to save A2A settings.");
      } finally {
        setBusy(false);
      }
    }
    const field = (label: string, key: string, help: string) =>
      html`<div class="settings-row">
        <div class="settings-row-label">${label}</div>
        <label class="settings-toggle"
          ><input
            type="checkbox"
            aria-label=${label}
            checked=${!!config[key]}
            disabled=${busy}
            onChange=${(e: any) => setConfig({ ...config, [key]: e.target.checked })} /><span
            class="settings-toggle-slider"
          ></span
        ></label>
        <div class="settings-row-help">${help}</div>
      </div>`;
    const json = (label: string, value: string, update: any, help: string) =>
      html`<label class="a2a-json"
        ><span>${label}</span
        ><textarea
          aria-label=${label}
          value=${value}
          disabled=${busy}
          spellcheck="false"
          onInput=${(e: any) => update(e.target.value)}
        ></textarea
        ><small>${help}</small></label
      >`;
    return html`<section class="settings-section a2a-settings">
      <style>
        .a2a-settings {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .a2a-settings p,
        .a2a-settings small {
          color: var(--text-secondary);
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .a2a-settings h3 {
          margin: 18px 0 8px;
          font-size: 14px;
        }
        .a2a-settings .a2a-json {
          display: block;
          margin: 14px 0;
        }
        .a2a-json > span,
        .a2a-json > small {
          display: block;
          margin: 6px 0;
        }
        .a2a-json textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 140px;
          resize: vertical;
          font:
            12px/1.5 ui-monospace,
            monospace;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 8px;
          background: var(--bg-primary);
          color: var(--text-primary);
        }
        .a2a-settings .a2a-base {
          display: block;
          width: 100%;
          box-sizing: border-box;
          margin: 7px 0;
        }
        .a2a-settings .a2a-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 16px;
        }
        .a2a-settings .a2a-error {
          color: var(--error-color, #c54);
        }
        .a2a-settings pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: 12px;
        }
        .a2a-confirm {
          display: flex;
          gap: 8px;
          align-items: flex-start;
        }
        .a2a-confirm input {
          margin-top: 3px;
        }
        @media (max-width: 520px) {
          .a2a-json textarea {
            font-size: 16px;
          }
          .a2a-settings .a2a-actions button {
            flex: 1;
          }
        }
      </style>
      <h3>A2A agents</h3>
      <p>
        Optional A2A v1 JSON-RPC interoperability. Installing is
        network-inactive. Inbound publication needs both these principal grants
        and matching core operation grants. Remote cards and messages never
        grant local authority.
      </p>
      ${error && html`<p class="a2a-error" role="alert">${error}</p>`}${notice && html`<p role="status">${notice}</p>`}
      ${field("Enable A2A", "enabled", "Requires reviewed credentials, targets and execution policy.")}
      ${field("Accept inbound requests", "inbound", "Only explicitly published agents can receive requests.")}
      ${field("Allow outbound calls", "outbound", "Calls use approved endpoint aliases; redirects are rejected.")}
      <label
        >Public HTTPS base URL<input
          class="a2a-base"
          aria-label="Public HTTPS base URL"
          value=${config.publicBaseUrl}
          disabled=${busy}
          placeholder="https://agents.example.com"
          onInput=${(e: any) => setConfig({ ...config, publicBaseUrl: e.target.value })}
      /></label>
      ${json("Published agents (JSON)", agents, setAgents, 'Example: [{"id":"summarise","name":"Summarise","description":"Public text task","enabled":true}]')}
      ${json("Inbound principals (JSON)", principals, setPrincipals, 'Example: [{"id":"client","credentialKey":"a2a/client","targets":["summarise"],"enabled":true}]. Use keychain entry names only, never token values.')}
      ${json("Outbound endpoints (JSON)", endpoints, setEndpoints, 'Example: [{"alias":"lab","cardUrl":"https://agent.example/card","credentialKey":"a2a/lab","allowPrivate":false,"enabled":true}]. Private-address permission is an explicit network grant.')}
      <label class="a2a-confirm"
        ><input
          type="checkbox"
          aria-label="I reviewed grants and credentials"
          checked=${confirm}
          disabled=${busy}
          onChange=${(e: any) => setConfirm(e.target.checked)}
        /><span
          >I reviewed the endpoint, principal, credential references and core
          operation grants.</span
        ></label
      >
      <div class="a2a-actions">
        <button disabled=${busy} onClick=${() => save()}>
          Save A2A settings</button
        ><button disabled=${busy} onClick=${() => save(true)}>
          Disable A2A now</button
        ><button
          disabled=${busy}
          onClick=${async () => {
            try {
              setStatus(await request("status"));
              setTasks(await request("tasks"));
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Refresh diagnostics
        </button>
      </div>
      <details>
        <summary>Local diagnostics</summary>
        <pre>
${status ? JSON.stringify(status, null, 2) : "No runtime status available."}</pre>
        <pre>
${tasks ? JSON.stringify(tasks, null, 2) : "Refresh diagnostics to inspect principal-scoped task state."}</pre>
      </details>
      <p>
        Agent Card URL: /api/addons/a2a/agents/&lt;id&gt;/agent-card.json.
        Bearer authentication is required. Token values belong in Keychain
        settings. No connection test here executes remote work.
      </p>
    </section>`;
  }
  api?.registerSettingsPane?.({
    id: "a2a",
    label: "A2A",
    order: 191,
    render: Panel,
  });
}
