// Served only by the loopback preview server, never copied to docs/public.
(function () {
  const widgets = new Map(); let sequence = 0;
  window.turnstile = {
    render(container, options) {
      const id = ++sequence, label = document.createElement("label"), checkbox = document.createElement("input");
      label.style.cssText = "display:flex;align-items:center;gap:12px;padding:14px;border:1px solid #3b6570;border-radius:5px;font-size:13px;color:#adced2;background:#102329";
      checkbox.type = "checkbox"; checkbox.style.width = "18px"; checkbox.style.height = "18px";
      label.append(checkbox, "Local verification (isolated preview)"); container.append(label);
      checkbox.addEventListener("change", () => { if (checkbox.checked) options.callback(`local:${options.action}:${crypto.randomUUID()}`); else options["expired-callback"]?.(); });
      widgets.set(id, {checkbox, options}); return id;
    },
    reset(id) { const item = widgets.get(id); if (item) { item.checkbox.checked = false; item.options["expired-callback"]?.(); } },
    remove(id) { const item = widgets.get(id); if (item) item.checkbox.parentElement.remove(); widgets.delete(id); },
  };
})();
