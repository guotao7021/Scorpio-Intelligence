const host = document.querySelector(".gateway-scene");
const canvas = host?.querySelector("canvas");
const control = document.querySelector(".gateway-motion");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
window.lucide?.createIcons();

async function start() {
  if (!canvas) return;
  const THREE = await import("./vendor/three.module.min.js");
  const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: "low-power"});
  renderer.setClearColor(0x080e15, 1); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  camera.position.set(0, 0, 19); camera.lookAt(0, 0, 0);
  const field = new THREE.Group(); field.rotation.x = -.28; field.rotation.z = -.16; scene.add(field);
  const resources = [], flows = [], routeMaterials = [];
  const retain = (item) => { resources.push(item); return item; };
  for (let band = 0; band < 2; band++) {
    const color = band ? 0x20b69e : 0x36bdea;
    const material = retain(new THREE.LineBasicMaterial({color, transparent: true, opacity: .23, vertexColors: true})); routeMaterials.push(material);
    for (let row = 0; row < 15; row++) {
      const points = [], colors = [];
      for (let step = 0; step <= 90; step++) {
        const x = -13 + step * 26 / 90;
        const y = (band ? -1 : 1) * (2.1 + row * .16) + Math.sin(x * .35 + row * .05 + band) * .58;
        points.push(new THREE.Vector3(x, y, Math.cos(x * .32 + row * .18) * .85));
        const brightness = .25 + Math.min(1, Math.abs(x) / 6) * .75;
        colors.push(brightness, brightness, brightness);
      }
      const geometry = retain(new THREE.BufferGeometry().setFromPoints(points)); geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      field.add(new THREE.Line(geometry, material));
      if (row % 4 === 0) {
        const curve = new THREE.CatmullRomCurve3(points);
        const markerMaterial = retain(new THREE.MeshBasicMaterial({color: row === 8 ? 0xe2c55e : color, transparent: true, opacity: .72}));
        const geometry = retain(new THREE.BoxGeometry(.045, .045, .045));
        for (let index = 0; index < 3; index++) { const marker = new THREE.Mesh(geometry, markerMaterial); field.add(marker); flows.push({object: marker, curve, offset: index / 3 + row * .031, band}); }
      }
    }
  }
  let frame = 0, last = 0, elapsed = 0, painted = 0, paused = false, disposed = false, focused = -1;
  const pointer = {x: 0, y: 0};
  const active = () => !paused && !motion.matches && !document.hidden && !disposed;
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(draw); }
  function draw(now) {
    frame = 0; if (disposed) return;
    if (active() && now - painted < 32) { frame = requestAnimationFrame(draw); return; }
    if (active()) elapsed += Math.min((now - (last || now)) / 1000, .05);
    last = now; painted = now;
    field.rotation.y = (motion.matches ? 0 : pointer.x) * .055;
    field.position.y = (motion.matches ? 0 : pointer.y) * .12;
    for (const item of flows) item.object.position.copy(item.curve.getPointAt((elapsed * (focused === item.band ? .04 : .024) + item.offset) % 1));
    routeMaterials.forEach((material, index) => { material.opacity = focused === index ? .36 : .23; });
    renderer.render(scene, camera);
    if (active()) frame = requestAnimationFrame(draw);
  }
  function resize() { const {width, height} = host.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.position.z = width <= 620 ? 23 : 19; camera.updateProjectionMatrix(); schedule(); }
  function syncControl() { control.hidden = motion.matches || host.classList.contains("unavailable"); control.setAttribute("aria-pressed", String(paused)); const label = paused ? "播放背景动效 / Play motion" : "暂停背景动效 / Pause motion"; control.title = label; control.setAttribute("aria-label", label); control.innerHTML = `<i data-lucide="${paused ? "play" : "pause"}" aria-hidden="true"></i>`; window.lucide?.createIcons(); }
  control.addEventListener("click", () => { paused = !paused; cancelAnimationFrame(frame); frame = 0; last = 0; syncControl(); if (!paused) schedule(); });
  document.addEventListener("pointermove", (event) => { if (!active()) return; pointer.x = event.clientX / innerWidth - .5; pointer.y = event.clientY / innerHeight - .5; });
  for (const link of document.querySelectorAll(".gateway-route")) {
    const select = () => { focused = link.dataset.locale === "cn" ? 0 : 1; if (!paused) schedule(); };
    const clear = () => { focused = -1; if (!paused) schedule(); };
    link.addEventListener("pointerenter", select); link.addEventListener("focus", select); link.addEventListener("pointerleave", clear); link.addEventListener("blur", clear);
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  function visibility() { cancelAnimationFrame(frame); frame = 0; last = 0; if (!document.hidden) schedule(); }
  function preference() { syncControl(); visibility(); }
  document.addEventListener("visibilitychange", visibility); motion.addEventListener("change", preference);
  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); cancelAnimationFrame(frame); disposed = true; host.classList.add("unavailable"); control.hidden = true; });
  window.addEventListener("pagehide", (event) => { if (event.persisted) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); motion.removeEventListener("change", preference); resources.forEach((item) => item.dispose()); renderer.dispose(); }, {once: true});
  resize(); syncControl();
}

start().catch(() => { host?.classList.add("unavailable"); if (control) control.hidden = true; });
