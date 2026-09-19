import { settingsFieldStyles } from "./settings-fields.ts";
// Host-provided Preact/HTM; no runtime SDK or secrets shipped to the browser.
const host = globalThis as any;
const runtime = host.__piclawPreactHtm || host.__piclawPreact;
export default function register(api: any) {
  if (!runtime?.html || !runtime?.useState || !runtime?.useEffect) return;
  const { html, useState, useEffect } = runtime;
  function Settings() {
    const [profiles, setProfiles] = useState([]),
      [message, setMessage] = useState("Loading…"),
      [busy, setBusy] = useState(false);
    const endpoint = "/agent/addons/api/linkr/config";
    useEffect(() => {
      let active = true;
      fetch(endpoint)
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          if (active) {
            setProfiles((data.config ?? data).profiles ?? []);
            setMessage("");
          }
        })
        .catch(() => {
          if (active) setMessage("Could not load Linkr configuration.");
        });
      return () => {
        active = false;
      };
    }, []);
    const update = (i: number, key: string, value: unknown) =>
      setProfiles((old: any[]) =>
        old.map((p, n) => (n === i ? { ...p, [key]: value } : p)),
      );
    const save = async () => {
      if (
        !globalThis.confirm(
          "Save Linkr device origins and keychain references? Requests send each referenced token to its configured origin. Confirm each KVM and attached computer identity.",
        )
      )
        return;
      setBusy(true);
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profiles }),
        });
        if (!r.ok) throw new Error();
        const result = await r.json();
        if (result.ok === false) throw new Error();
        setMessage(
          "Saved. Select a profile with linkr; capture a screenshot before enabling or sending input.",
        );
      } catch {
        setMessage(
          "Save failed. Check unique IDs/origins and required fields.",
        );
      } finally {
        setBusy(false);
      }
    };
    return html`<section class="settings-section" data-settings-addon="linkr">
      <style>${settingsFieldStyles}</style>
      <h3>Linkr KVM</h3>
      <p>
        Profiles identify both the KVM and the attached computer. HID is
        disabled by default. Store tokens in Settings → Keychain; enter only the
        keychain entry name here.
      </p>
      <p>
        HTTP sends tokens and screen contents unencrypted: use a trusted LAN/VPN
        or verified HTTPS. Power, virtual media and appliance reboot are
        unsupported in this version.
      </p>
      ${profiles.map(
     (p: any, i: number) =>
       html`<fieldset
         key=${i}
         disabled=${busy}
         style="margin:1em 0;padding:1em;min-width:0"
       >
         <legend>${p.label || "New Linkr device"}</legend>
         ${[
      ["id", "Profile ID"],
      ["label", "Label"],
      ["origin", "HTTP(S) origin"],
      ["targetIdentity", "Attached computer identity"],
      ["tokenKeychain", "Keychain token reference"],
    ].map(
      ([key, label]) =>
        html`<label class="settings-addon-field"
          ><span class="settings-addon-label">${label}</span><input
            class="settings-addon-control" type="text"
            value=${p[key] || ""}
            onInput=${(e: any) => update(i, key, e.currentTarget.value)}
        /></label>`,
    )}
         <label
           ><input
             type="checkbox"
             checked=${p.inputEnabled === true}
             onChange=${(e: any) => update(i, "inputEnabled", e.currentTarget.checked)}
           />
           Allow keyboard and mouse input to this computer</label
         >
         <button
           type="button"
           onClick=${() => setProfiles((a: any[]) => a.filter((_: any, n: number) => n !== i))}
         >
           Remove profile
         </button>
       </fieldset>`,
   )}
      <button
        disabled=${busy || profiles.length >= 32}
        onClick=${() => setProfiles((a: any[]) => [...a, { id: "", label: "", origin: "", targetIdentity: "", tokenKeychain: "linkr/device-token", inputEnabled: false }])}
      >
        Add device
      </button>
      <button disabled=${busy} onClick=${save}>Save</button>
      <p role="status">${message}</p>
      <p>
        Use linkr job.status / job.cancel for bounded jobs. Profiles do not
        provide machine identity attestation; re-confirm the attached computer
        after moving cables.
      </p>
    </section>`;
  }
  api?.registerSettingsPane?.({
    id: "linkr",
    label: "Linkr",
    // Classic hides navigation text on phones; retain a visible, named icon.
    icon: html`<svg role="img" aria-label="Linkr" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="12" rx="2"/><path d="M8 21h8M12 15v6M7 8h10"/></svg>`,
    order: 179,
    component: Settings,
  });
}

// Hosts import web entries for side effects; do not rely on a default-export caller.
register(host.__piclawSettingsPaneRegistry || host.__piclaw_web);
