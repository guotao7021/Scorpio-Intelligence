(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const SESSION_KEY = "scorpio_site_analytics_session";

  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") {
      return;
    }
    const payload = {
      event_id: eventId(),
      page_path: window.location.pathname || "/",
      page_title: document.title || "",
      language: document.documentElement.lang || navigator.language || "",
      referrer: document.referrer || "",
      screen: screenSize(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    };
    const body = JSON.stringify(payload);
    const url = `${API_BASE}/site/visit`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(function () {});
  } catch (error) {
    // Analytics must never affect public page rendering.
  }

  function eventId() {
    const session = analyticsSession();
    return `visit_${Date.now().toString(36)}_${session}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function analyticsSession() {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const value = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(SESSION_KEY, value);
      return value;
    } catch (error) {
      return Math.random().toString(36).slice(2, 12);
    }
  }

  function screenSize() {
    if (!window.screen) return "";
    return `${window.screen.width || 0}x${window.screen.height || 0}`;
  }
})();
