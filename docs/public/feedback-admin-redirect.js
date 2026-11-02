(function () {
  const language = new URLSearchParams(location.search).get("lang") === "en" ? "?lang=en" : "";
  location.replace(`scorpio_v1_admin.html${language}#feedback`);
})();
