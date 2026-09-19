/** Package-local fallback for supported hosts predating the shared field contract.
 * Layered, pane-scoped rules yield to the host; native booleans/buttons are untouched.
 */
export const settingsFieldStyles = `
@layer linkr-settings-fields {
  :where([data-settings-addon="linkr"]) .settings-addon-field { display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;max-width:100%;margin-bottom:12px; }
  :where([data-settings-addon="linkr"]) .settings-addon-label { color:var(--text-secondary);font-size:.88em;font-weight:500; }
  :where([data-settings-addon="linkr"]) .settings-addon-control { box-sizing:border-box;min-width:0;max-width:100%;width:280px;padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:.88em; }
  :where([data-settings-addon="linkr"]) textarea.settings-addon-control { resize:vertical; }
  :where([data-settings-addon="linkr"]) .settings-addon-control-group { display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;max-width:100%; }
  :where([data-settings-addon="linkr"]) .settings-addon-control-group > .settings-addon-control { flex:1 1 160px; }
  :where([data-settings-addon="linkr"]) .settings-addon-help { color:var(--text-secondary);font-size:.84em;overflow-wrap:anywhere; }
  :where([data-settings-addon="linkr"]) .settings-addon-control:focus-visible { outline:2px solid var(--accent-color);outline-offset:2px; }
  :where([data-settings-addon="linkr"]) .settings-addon-control:disabled { opacity:.5; }
  @media(max-width:640px) {
    :where([data-settings-addon="linkr"]) .settings-addon-field { align-items:stretch; }
    :where([data-settings-addon="linkr"]) .settings-addon-control { width:100%; }
  }
}
`;
