(function () {
  "use strict";
  const {t, icon, icons, escape} = window.ScorpioAccountViews;
  const form = document.getElementById("feedbackForm"), files = [];
  const panel = document.createElement("section"); panel.className = "feedback-uploads";
  panel.innerHTML = `<div class="feedback-upload-head"><h3>${t("问题截图（选填）", "Screenshots (optional)")}</h3><button type="button" class="portal-text-button" id="feedbackAddImages">${icon("image-plus")}${t("添加截图", "Add screenshots")}</button></div><p id="feedbackImageHint">${t("最多 3 张，每张不超过 5 MB，支持 PNG、JPG、WebP。请遮盖截图中的个人信息。", "Up to 3 images, 5 MB each. PNG, JPG and WebP. Redact personal information before uploading.")}</p><input id="feedbackImages" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-describedby="feedbackImageHint"><p id="feedbackImageError" class="portal-notice error" role="alert" hidden></p><div class="feedback-image-grid" id="feedbackImagePreviews"></div>`;
  form.querySelector('[data-feedback-step="1"] .feedback-fields').append(panel);
  const input = document.getElementById("feedbackImages"), error = document.getElementById("feedbackImageError");
  let selecting = false;
  function render() {
    document.getElementById("feedbackImagePreviews").innerHTML = files.map((item, index) => `<div class="feedback-image"><img src="${item.url}" alt="${escape(item.file.name)}"><button type="button" class="portal-icon" data-remove-image="${index}" title="${t("移除截图", "Remove screenshot")}" aria-label="${escape(t(`移除截图 ${index + 1}`, `Remove screenshot ${index + 1}`))}">${icon("x")}</button><small>${escape(item.file.name)} · ${Math.ceil(item.file.size / 1024)} KB</small></div>`).join("");
    document.getElementById("feedbackAddImages").disabled = files.length >= 3; icons();
    window.ScorpioFeedbackCenter?.summary();
  }
  async function add(incoming) {
    if (selecting || form.getAttribute("aria-busy") === "true") return;
    selecting = true; document.getElementById("feedbackAddImages").disabled = true;
    error.hidden = true;
    try {
      if (files.length + incoming.length > 3) throw new Error(t("最多可添加 3 张截图。", "You can attach up to 3 screenshots."));
      const accepted = [];
      for (const file of incoming) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(t("只支持 PNG、JPG 和 WebP 图片。", "Only PNG, JPG and WebP images are supported."));
        if (!file.size || file.size > 5 * 1024 * 1024) throw new Error(t("每张截图不能超过 5 MB。", "Each screenshot must be no larger than 5 MB."));
        let bitmap; try { bitmap = await createImageBitmap(file); } catch { throw new Error(t("图片无法读取，请选择有效截图。", "The image could not be read. Select a valid screenshot.")); }
        const valid = bitmap.width <= 16000 && bitmap.height <= 16000 && bitmap.width * bitmap.height <= 24000000; bitmap.close();
        if (!valid) throw new Error(t("图片尺寸过大，请缩小后重试。", "The image dimensions are too large. Resize it and retry."));
        accepted.push(file);
      }
      for (const file of accepted) files.push({file, url: URL.createObjectURL(file)});
      render();
    } catch (cause) { error.textContent = cause.message; error.hidden = false; }
    finally { selecting = false; input.value = ""; render(); }
  }
  document.getElementById("feedbackAddImages").onclick = () => input.click();
  input.onchange = () => add([...input.files]);
  panel.addEventListener("click", (event) => { const button = event.target.closest("[data-remove-image]"); if (button) { const index = Number(button.dataset.removeImage); URL.revokeObjectURL(files[index].url); files.splice(index, 1); render(); } });
  form.addEventListener("paste", (event) => { const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/")); if (images.length && !form.querySelector('[data-feedback-step="1"]').hidden) { event.preventDefault(); add(images); } });
  function clear() { files.forEach((file) => URL.revokeObjectURL(file.url)); files.length = 0; render(); error.hidden = true; }
  window.ScorpioFeedbackUploads = {files: () => files.map((item) => item.file), clear};
  window.addEventListener("pagehide", (event) => { if (!event.persisted) clear(); });
  render();
})();
