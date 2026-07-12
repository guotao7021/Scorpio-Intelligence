(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let threeModulePromise;

  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!threeModulePromise) threeModulePromise = import("./vendor/three.module.min.js");
    return threeModulePromise;
  }

  function initStellarField() {
    const canvas = document.getElementById("stellar-field");
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let points = [];
    let frameId = 0;
    let tick = 0;
    const pointer = { x: 0, y: 0 };

    const createPoints = () => {
      const count = Math.max(28, Math.min(72, Math.round(width / 22)));
      points = Array.from({ length: count }, (_, index) => ({
        x: (((index + 7) * 83) % 997) / 997 * width,
        y: (((index + 11) * 197) % 991) / 991 * height,
        radius: index % 11 === 0 ? 1.5 : 0.8,
        phase: (index * 0.73) % (Math.PI * 2),
        accent: index % 13 === 0,
      }));
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      createPoints();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const driftX = pointer.x * 9;
      const driftY = pointer.y * 6;

      points.forEach((point, index) => {
        const pulse = reducedMotion ? 1 : 0.72 + Math.sin(tick * 0.012 + point.phase) * 0.28;
        const x = point.x + driftX * ((index % 5) / 5);
        const y = point.y + driftY * ((index % 7) / 7);
        context.beginPath();
        context.fillStyle = point.accent
          ? `rgba(242, 201, 76, ${0.52 * pulse})`
          : `rgba(125, 211, 252, ${0.42 * pulse})`;
        context.arc(x, y, point.radius, 0, Math.PI * 2);
        context.fill();

        const next = points[index + 1];
        if (!next || index % 3 !== 0) return;
        const distance = Math.hypot(next.x - point.x, next.y - point.y);
        if (distance >= 240) return;
        context.beginPath();
        context.strokeStyle = "rgba(125, 211, 252, 0.09)";
        context.lineWidth = 0.7;
        context.moveTo(x, y);
        context.lineTo(next.x + driftX * (((index + 1) % 5) / 5), next.y + driftY * (((index + 1) % 7) / 7));
        context.stroke();
      });

      tick += 1;
      if (!reducedMotion) frameId = window.requestAnimationFrame(draw);
    };

    const hero = canvas.closest(".hero-observatory");
    if (hero && !reducedMotion) {
      hero.addEventListener("pointermove", (event) => {
        const bounds = hero.getBoundingClientRect();
        pointer.x = (event.clientX - bounds.left) / bounds.width - 0.5;
        pointer.y = (event.clientY - bounds.top) / bounds.height - 0.5;
      });
      hero.addEventListener("pointerleave", () => {
        pointer.x = 0;
        pointer.y = 0;
      });
    }

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pagehide", () => window.cancelAnimationFrame(frameId), { once: true });
    resize();
    draw();
  }

  function initRevealMotion() {
    const sections = document.querySelectorAll("[data-reveal]");
    if (reducedMotion || !("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    sections.forEach((section) => observer.observe(section));

    const timeline = document.querySelector(".constellation-map");
    if (timeline) {
      const timelineObserver = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        timeline.classList.add("is-tracing");
        timelineObserver.disconnect();
      }, { threshold: 0.28 });
      timelineObserver.observe(timeline);
    }
  }

  function initProductCarousel() {
    document.querySelectorAll("[data-carousel]").forEach((carousel) => {
      const track = carousel.querySelector(".product-track");
      const slides = Array.from(carousel.querySelectorAll(".gallery-frame"));
      const dots = carousel.querySelector(".carousel-dots");
      const count = carousel.querySelector(".carousel-count");
      const previous = carousel.querySelector("[data-carousel-prev]");
      const next = carousel.querySelector("[data-carousel-next]");
      if (!track || !dots || slides.length < 2) return;

      let activeIndex = 0;
      let autoplayId = 0;
      let pointerStart = 0;

      slides.forEach((slide, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.setAttribute("role", "tab");
        dot.setAttribute("aria-label", `${index + 1} / ${slides.length}`);
        dot.addEventListener("click", () => show(index, true));
        dots.appendChild(dot);
      });

      const dotButtons = Array.from(dots.querySelectorAll("button"));

      const restartAutoplay = () => {
        window.clearInterval(autoplayId);
        if (reducedMotion) return;
        autoplayId = window.setInterval(() => show(activeIndex + 1), 5600);
      };

      function show(index, restart = false) {
        activeIndex = (index + slides.length) % slides.length;
        track.style.transform = `translate3d(${-activeIndex * 100}%, 0, 0)`;
        slides.forEach((slide, slideIndex) => {
          const isActive = slideIndex === activeIndex;
          slide.classList.toggle("is-active", isActive);
          slide.setAttribute("aria-hidden", String(!isActive));
        });
        dotButtons.forEach((dot, dotIndex) => dot.setAttribute("aria-selected", String(dotIndex === activeIndex)));
        if (count) count.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
        if (restart) restartAutoplay();
      }

      previous?.addEventListener("click", () => show(activeIndex - 1, true));
      next?.addEventListener("click", () => show(activeIndex + 1, true));
      carousel.addEventListener("pointerenter", () => window.clearInterval(autoplayId));
      carousel.addEventListener("pointerleave", restartAutoplay);
      carousel.addEventListener("focusin", () => window.clearInterval(autoplayId));
      carousel.addEventListener("focusout", restartAutoplay);
      carousel.addEventListener("pointerdown", (event) => { pointerStart = event.clientX; });
      carousel.addEventListener("pointerup", (event) => {
        const distance = event.clientX - pointerStart;
        if (Math.abs(distance) < 48) return;
        show(activeIndex + (distance < 0 ? 1 : -1), true);
      });

      show(0);
      restartAutoplay();
      window.addEventListener("pagehide", () => window.clearInterval(autoplayId), { once: true });
    });
  }

  async function initHeroDataForge() {
    const canvas = document.querySelector(".hero-forge-canvas");
    const host = canvas?.closest(".hero-data-forge");
    if (!canvas || !host) return;

    let THREE;
    try {
      THREE = await loadThree();
    } catch (_error) {
      host.classList.add("forge-fallback");
      return;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch (_error) {
      host.classList.add("forge-fallback");
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06101d, 0.038);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const factory = new THREE.Group();
    scene.add(factory);

    const colors = {
      cyan: 0x38bdf8,
      teal: 0x18c6a3,
      gold: 0xf2c94c,
      ink: 0x091728,
      steel: 0x36566f,
      white: 0xdce7f5,
    };
    const animated = [];
    const particles = [];
    const coreNodes = [];

    scene.add(new THREE.HemisphereLight(0x8bdcff, 0x06101d, 1.15));
    const keyLight = new THREE.PointLight(colors.cyan, 4.2, 18);
    keyLight.position.set(1.6, 3.5, 4.5);
    scene.add(keyLight);
    const warmLight = new THREE.PointLight(colors.gold, 2.6, 14);
    warmLight.position.set(-3.2, 1.5, 2.5);
    scene.add(warmLight);

    const grid = new THREE.GridHelper(14, 28, colors.steel, colors.steel);
    grid.position.y = -1.72;
    grid.material.transparent = true;
    grid.material.opacity = 0.17;
    factory.add(grid);

    const chassisMaterial = new THREE.MeshStandardMaterial({
      color: colors.ink,
      metalness: 0.82,
      roughness: 0.3,
      transparent: true,
      opacity: 0.94,
    });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.34, 2.65), chassisMaterial);
    chassis.position.set(-0.15, -1.54, 0);
    factory.add(chassis);
    const chassisEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(chassis.geometry),
      new THREE.LineBasicMaterial({ color: colors.steel, transparent: true, opacity: 0.72 })
    );
    chassisEdges.position.copy(chassis.position);
    factory.add(chassisEdges);

    [-0.62, 0.62].forEach((z) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.08, 0.09), new THREE.MeshStandardMaterial({ color: colors.steel, metalness: 0.9, roughness: 0.24 }));
      rail.position.set(-0.3, -1.26, z);
      factory.add(rail);
    });
    for (let index = 0; index < 13; index += 1) {
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 1.42), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? colors.cyan : colors.steel, transparent: true, opacity: index % 4 === 0 ? 0.55 : 0.36 }));
      sleeper.position.set(-4.85 + index * 0.76, -1.22, 0);
      factory.add(sleeper);
    }

    const bridgePosts = [-3.05, 0.68, 3.45];
    bridgePosts.forEach((x) => {
      [-0.95, 0.95].forEach((z) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.15, 0.07), chassisMaterial);
        post.position.set(x, -0.27, z);
        factory.add(post);
      });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.98), new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.48 }));
      beam.position.set(x, 0.79, 0);
      factory.add(beam);
    });
    const overheadRail = new THREE.Mesh(new THREE.BoxGeometry(6.55, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: colors.gold, transparent: true, opacity: 0.44 }));
    overheadRail.position.set(0.2, 0.79, 0.9);
    factory.add(overheadRail);

    [-4.55, -4.05, -3.55].forEach((x, column) => {
      const height = 0.72 + column * 0.22;
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.32, height, 16),
        new THREE.MeshStandardMaterial({ color: column === 1 ? colors.gold : colors.cyan, emissive: column === 1 ? 0x3a2b06 : 0x082b3c, metalness: 0.55, roughness: 0.3 })
      );
      tower.position.set(x, -1.48 + height / 2, 0.05 + (column - 1) * 0.22);
      factory.add(tower);
      for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.33 + ringIndex * 0.025, 0.012, 6, 32),
          new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.36 })
        );
        ring.position.copy(tower.position);
        ring.position.y = -1.35 + ringIndex * 0.28;
        ring.rotation.x = Math.PI / 2;
        factory.add(ring);
        animated.push({ object: ring, type: "ring", speed: 0.004 + ringIndex * 0.001 });
      }
    });

    [-2.35, -0.35].forEach((x, stationIndex) => {
      const frameGeometry = new THREE.BoxGeometry(1.2, 1.62, 1.05);
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(1.14, 1.56, 0.98),
        new THREE.MeshStandardMaterial({ color: colors.ink, emissive: stationIndex ? 0x031b1a : 0x1e1804, metalness: 0.76, roughness: 0.32, transparent: true, opacity: 0.72 })
      );
      cabinet.position.set(x, -0.56, stationIndex ? -0.08 : 0.08);
      factory.add(cabinet);
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(frameGeometry),
        new THREE.LineBasicMaterial({ color: stationIndex ? colors.teal : colors.gold, transparent: true, opacity: 0.62 })
      );
      frame.position.set(x, -0.56, stationIndex ? -0.08 : 0.08);
      factory.add(frame);
      for (let ventIndex = 0; ventIndex < 5; ventIndex += 1) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.018, 0.02), new THREE.MeshBasicMaterial({ color: stationIndex ? colors.teal : colors.gold, transparent: true, opacity: 0.5 }));
        vent.position.set(x, -1.05 + ventIndex * 0.16, 0.59);
        factory.add(vent);
      }
      const rotor = new THREE.Mesh(
        new THREE.TorusGeometry(0.43, 0.065, 10, 48),
        new THREE.MeshStandardMaterial({ color: stationIndex ? colors.teal : colors.gold, emissive: stationIndex ? 0x064437 : 0x3b2d06, metalness: 0.5, roughness: 0.25 })
      );
      rotor.position.copy(frame.position);
      rotor.rotation.set(Math.PI / 2, 0.3, stationIndex ? 0.5 : -0.4);
      factory.add(rotor);
      animated.push({ object: rotor, type: "rotor", speed: stationIndex ? -0.009 : 0.008 });
    });

    const brain = new THREE.Group();
    brain.position.set(2.05, -0.25, 0);
    factory.add(brain);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.82, 2),
      new THREE.MeshStandardMaterial({ color: colors.teal, emissive: 0x07594a, emissiveIntensity: 1.25, metalness: 0.35, roughness: 0.22, transparent: true, opacity: 0.74 })
    );
    brain.add(core);
    const coreWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.02, 1)),
      new THREE.LineBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.52 })
    );
    brain.add(coreWire);
    animated.push({ object: core, type: "core", speed: 0.003 });
    animated.push({ object: coreWire, type: "wire", speed: -0.002 });

    const neuralPositions = [];
    for (let index = 0; index < 24; index += 1) {
      const phi = Math.acos(1 - 2 * (index + 0.5) / 24);
      const theta = Math.PI * (1 + Math.sqrt(5)) * index;
      const position = new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi),
        Math.cos(phi),
        Math.sin(theta) * Math.sin(phi)
      ).multiplyScalar(1.24);
      neuralPositions.push(position);
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(index % 5 === 0 ? 0.055 : 0.032, 8, 8),
        new THREE.MeshBasicMaterial({ color: index % 5 === 0 ? colors.gold : colors.white, transparent: true, opacity: 0.9 })
      );
      node.position.copy(position);
      node.userData.phase = index * 0.47;
      brain.add(node);
      coreNodes.push(node);
    }
    const neuralLines = [];
    neuralPositions.forEach((position, index) => {
      const next = neuralPositions[(index + 5) % neuralPositions.length];
      neuralLines.push(position, next);
    });
    const neuralGeometry = new THREE.BufferGeometry().setFromPoints(neuralLines);
    brain.add(new THREE.LineSegments(neuralGeometry, new THREE.LineBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.16 })));
    [1.42, 1.7].forEach((radius, index) => {
      const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.018, 8, 96),
        new THREE.MeshBasicMaterial({ color: index ? colors.gold : colors.cyan, transparent: true, opacity: index ? 0.28 : 0.42 })
      );
      orbit.rotation.set(1.15 - index * 0.35, 0.45 + index * 0.5, 0.18);
      brain.add(orbit);
      animated.push({ object: orbit, type: "orbit", speed: index ? -0.003 : 0.004 });
    });

    const outputRack = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.72, 2.05, 0.82)),
      new THREE.LineBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.42 })
    );
    outputRack.position.set(4.32, -0.33, 0.02);
    factory.add(outputRack);
    [0.52, 0, -0.52].forEach((y, index) => {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(1.18 - index * 0.12, 0.36, 0.08),
        new THREE.MeshStandardMaterial({ color: index === 0 ? colors.teal : colors.cyan, emissive: index === 0 ? 0x07483c : 0x082d40, metalness: 0.6, roughness: 0.28 })
      );
      slab.position.set(4.35, y - 0.35, -0.08 + index * 0.12);
      slab.rotation.y = -0.18;
      factory.add(slab);
      animated.push({ object: slab, type: "output", speed: 0.7 + index * 0.18, baseY: slab.position.y, phase: index * 1.3 });
    });

    const curves = [
      new THREE.CatmullRomCurve3([new THREE.Vector3(-5.15, -0.72, 0.48), new THREE.Vector3(-2.35, -0.55, 0.22), new THREE.Vector3(-0.35, -0.58, 0.05), new THREE.Vector3(2.05, -0.22, 0), new THREE.Vector3(4.35, -0.35, 0)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(-5.05, -1.08, -0.38), new THREE.Vector3(-2.35, -0.9, -0.34), new THREE.Vector3(-0.35, -0.92, -0.25), new THREE.Vector3(2.05, -0.5, -0.3), new THREE.Vector3(4.35, -0.82, 0.16)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(-4.85, 0.1, 0.08), new THREE.Vector3(-2.35, 0.02, 0.12), new THREE.Vector3(-0.35, -0.02, 0.18), new THREE.Vector3(2.05, 0.22, 0.25), new THREE.Vector3(4.35, 0.15, -0.08)]),
    ];
    curves.forEach((curve, curveIndex) => {
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 96, 0.018, 5, false),
        new THREE.MeshBasicMaterial({ color: curveIndex === 2 ? colors.gold : colors.cyan, transparent: true, opacity: curveIndex === 2 ? 0.28 : 0.34 })
      );
      factory.add(tube);
      for (let index = 0; index < 12; index += 1) {
        const particle = new THREE.Mesh(
          new THREE.SphereGeometry(index % 4 === 0 ? 0.055 : 0.032, 8, 8),
          new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? colors.gold : colors.teal, transparent: true, opacity: 0.9 })
        );
        particle.userData = { curve, offset: index / 12 + curveIndex * 0.11, speed: 0.055 + curveIndex * 0.012 };
        factory.add(particle);
        particles.push(particle);
      }
    });

    let frameId = 0;
    let visible = true;
    let time = 0;
    const pointer = { x: 0, y: 0 };

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      if (width < 620) {
        camera.position.set(1.4, 4.6, 13.8);
        factory.scale.setScalar(0.9);
      } else {
        camera.position.set(1.4, 4.2, 11.4);
        factory.scale.setScalar(1);
      }
      camera.lookAt(0, -0.45, 0);
      camera.updateProjectionMatrix();
      delete canvas.dataset.pixelCheck;
    };

    const render = () => {
      if (!visible) return;
      if (!reducedMotion) time += 0.016;
      factory.rotation.y += (pointer.x * 0.12 - factory.rotation.y) * 0.035;
      factory.rotation.x += (-pointer.y * 0.055 - factory.rotation.x) * 0.035;
      animated.forEach((item) => {
        if (item.type === "ring" || item.type === "rotor" || item.type === "orbit") item.object.rotation.z += reducedMotion ? 0 : item.speed;
        if (item.type === "core" || item.type === "wire") item.object.rotation.y += reducedMotion ? 0 : item.speed;
        if (item.type === "output") item.object.position.y = item.baseY + Math.sin(time * item.speed + item.phase) * 0.035;
      });
      const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 1.7) * 0.055;
      brain.scale.setScalar(pulse);
      coreNodes.forEach((node) => { node.material.opacity = reducedMotion ? 0.82 : 0.55 + Math.sin(time * 2.2 + node.userData.phase) * 0.35; });
      particles.forEach((particle) => {
        const progress = (time * particle.userData.speed + particle.userData.offset) % 1;
        particle.position.copy(particle.userData.curve.getPointAt(progress));
      });
      renderer.render(scene, camera);
      if (!canvas.dataset.pixelCheck) {
        const gl = renderer.getContext();
        const sampleWidth = Math.min(256, gl.drawingBufferWidth);
        const sampleHeight = Math.min(256, gl.drawingBufferHeight);
        const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
        gl.readPixels(0, 0, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let nonBlank = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) nonBlank += 1;
        canvas.dataset.pixelCheck = String(nonBlank);
      }
      if (!reducedMotion) frameId = window.requestAnimationFrame(render);
    };

    host.addEventListener("pointermove", (event) => {
      const bounds = host.getBoundingClientRect();
      pointer.x = (event.clientX - bounds.left) / bounds.width - 0.5;
      pointer.y = (event.clientY - bounds.top) / bounds.height - 0.5;
    });
    host.addEventListener("pointerleave", () => { pointer.x = 0; pointer.y = 0; });
    const observer = new IntersectionObserver((entries) => {
      const nextVisible = entries[0].isIntersecting;
      if (nextVisible === visible) return;
      visible = nextVisible;
      if (visible) render();
      else window.cancelAnimationFrame(frameId);
    }, { threshold: 0.02 });
    observer.observe(host);
    new ResizeObserver(resize).observe(host);
    window.addEventListener("pagehide", () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      factory.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
      renderer.dispose();
    }, { once: true });
    resize();
    render();
  }

  async function initThreeScenes() {
    let THREE;
    try {
      THREE = await loadThree();
    } catch (_error) {
      return;
    }

    document.querySelectorAll(".section-3d").forEach((canvas) => {
      const host = canvas.parentElement;
      if (!host) return;

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
      } catch (_error) {
        canvas.hidden = true;
        return;
      }

      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 2.3, 10.5);
      camera.lookAt(0, 0, 0);
      const group = new THREE.Group();
      scene.add(group);

      const cyan = 0x38bdf8;
      const teal = 0x18c6a3;
      const gold = 0xf2c94c;
      const muted = 0x2b4b68;
      const movingPoints = [];
      const rotatingObjects = [];
      const meteors = [];
      const computeBars = [];
      const screenScanners = [];
      const sceneType = canvas.dataset.scene;

      const addLine = (points, color, opacity = 0.45) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
        group.add(line);
        return line;
      };

      if (sceneType === "pipeline") {
        group.position.y = 0.54;
        const buildBook = (x, facing) => {
          const book = new THREE.Group();
          book.position.set(x, -0.58, 0.08);
          book.rotation.y = facing * 0.16;
          [-1, 1].forEach((side) => {
            const cover = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.065, 1.35), new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.48 }));
            cover.position.set(side * 0.53, 0, 0);
            cover.rotation.z = side * -0.2;
            book.add(cover);
            const page = new THREE.Mesh(new THREE.BoxGeometry(1, 0.09, 1.25), new THREE.MeshBasicMaterial({ color: 0xdce7f5, transparent: true, opacity: 0.17 }));
            page.position.set(side * 0.5, 0.09, 0);
            page.rotation.z = side * -0.2;
            book.add(page);
            const pageEdges = new THREE.LineSegments(new THREE.EdgesGeometry(page.geometry), new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.44 }));
            pageEdges.position.copy(page.position);
            pageEdges.rotation.copy(page.rotation);
            book.add(pageEdges);
          });
          const spine = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 1.44), new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.8 }));
          book.add(spine);
          group.add(book);
        };
        buildBook(-3.9, 1);
        buildBook(3.9, -1);

        const computer = new THREE.Group();
        computer.position.set(0, -0.05, 0);
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.72, 0.18), new THREE.MeshBasicMaterial({ color: 0x071522, transparent: true, opacity: 0.94 }));
        computer.add(monitor);
        const monitorEdges = new THREE.LineSegments(new THREE.EdgesGeometry(monitor.geometry), new THREE.LineBasicMaterial({ color: teal, transparent: true, opacity: 0.78 }));
        computer.add(monitorEdges);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.34, 1.36), new THREE.MeshBasicMaterial({ color: 0x08263a, transparent: true, opacity: 0.82 }));
        screen.position.z = 0.095;
        computer.add(screen);
        const trendPoints = [
          new THREE.Vector3(-1.02, 0.24, 0.125), new THREE.Vector3(-0.72, 0.42, 0.125),
          new THREE.Vector3(-0.43, 0.3, 0.125), new THREE.Vector3(-0.12, 0.58, 0.125),
          new THREE.Vector3(0.18, 0.47, 0.125), new THREE.Vector3(0.48, 0.66, 0.125),
        ];
        computer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(trendPoints), new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.82 })));
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 4; column += 1) {
            const cell = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshBasicMaterial({ color: (row + column) % 3 === 0 ? teal : cyan, transparent: true, opacity: 0.28 + (row + column) * 0.045 }));
            cell.position.set(0.62 + column * 0.14, 0.58 - row * 0.13, 0.126);
            computer.add(cell);
          }
        }
        const scanner = new THREE.Mesh(new THREE.PlaneGeometry(2.18, 0.025), new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.66 }));
        scanner.position.set(0, 0.58, 0.13);
        computer.add(scanner);
        screenScanners.push(scanner);
        for (let index = 0; index < 11; index += 1) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.025), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? gold : cyan, transparent: true, opacity: 0.72 }));
          bar.position.set(-1.02 + index * 0.205, -0.38, 0.12);
          bar.userData.phase = index * 0.61;
          bar.userData.baseY = bar.position.y;
          computer.add(bar);
          computeBars.push(bar);
        }
        const processor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), new THREE.MeshBasicMaterial({ color: teal, wireframe: true, transparent: true, opacity: 0.82 }));
        processor.position.set(0, 0.32, 0.14);
        computer.add(processor);
        rotatingObjects.push(Object.assign(processor, { userData: { speed: 0.004 } }));
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), new THREE.MeshBasicMaterial({ color: muted, transparent: true, opacity: 0.8 }));
        stand.position.y = -1.14;
        computer.add(stand);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.72), new THREE.MeshBasicMaterial({ color: muted, transparent: true, opacity: 0.76 }));
        base.position.y = -1.49;
        computer.add(base);
        group.add(computer);

        const knowledgeCurves = [];
        [-1, 1].forEach((side) => {
          for (let lane = 0; lane < 3; lane += 1) {
            const curve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(side * 3.45, -0.2 + lane * 0.12, (lane - 1) * 0.22),
              new THREE.Vector3(side * 2.7, 0.8 + lane * 0.28, (lane - 1) * 0.28),
              new THREE.Vector3(side * 1.65, 1.35 - lane * 0.12, (lane - 1) * 0.2),
              new THREE.Vector3(side * 1.12, 0.36 + lane * 0.1, 0.08),
            ]);
            knowledgeCurves.push(curve);
            const tube = new THREE.Mesh(
              new THREE.TubeGeometry(curve, 54, 0.009 + lane * 0.002, 4, false),
              new THREE.MeshBasicMaterial({ color: side < 0 ? gold : teal, transparent: true, opacity: 0.16 + lane * 0.07 })
            );
            group.add(tube);
          }
        });
        for (let index = 0; index < 42; index += 1) {
          const isPage = index % 7 === 0;
          const point = new THREE.Mesh(
            isPage ? new THREE.BoxGeometry(0.12, 0.018, 0.075) : new THREE.SphereGeometry(index % 6 === 0 ? 0.052 : 0.027, 8, 8),
            new THREE.MeshBasicMaterial({ color: index % 2 ? gold : teal, transparent: true, opacity: 0.84 })
          );
          point.userData.offset = (index % 14) / 14;
          point.userData.kind = "bookToComputer";
          point.userData.curve = knowledgeCurves[index % knowledgeCurves.length];
          point.userData.isPage = isPage;
          point.userData.phase = index * 0.83;
          group.add(point);
          movingPoints.push(point);
        }
        const grid = new THREE.GridHelper(13, 13, muted, muted);
        grid.position.y = -1.65;
        grid.material.transparent = true;
        grid.material.opacity = 0.13;
        group.add(grid);
      } else if (sceneType === "delivery") {
        group.position.y = 0.12;
        const shellMaterial = new THREE.MeshBasicMaterial({ color: 0x081a2a, transparent: true, opacity: 0.92 });
        const edgeMaterial = (color, opacity = 0.62) => new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const conveyorBase = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.3, 1.6), new THREE.MeshBasicMaterial({ color: 0x07111d, transparent: true, opacity: 0.96 }));
        conveyorBase.position.set(0, -1.05, 0);
        group.add(conveyorBase);
        const belt = new THREE.Mesh(new THREE.BoxGeometry(11.45, 0.08, 0.94), new THREE.MeshBasicMaterial({ color: 0x10263a, transparent: true, opacity: 0.9 }));
        belt.position.set(0, -0.82, 0);
        group.add(belt);
        [-5.2, -3.9, -2.6, -1.3, 0, 1.3, 2.6, 3.9, 5.2].forEach((x, index) => {
          const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.12, 12), new THREE.MeshBasicMaterial({ color: index % 2 ? muted : cyan, transparent: true, opacity: 0.54 }));
          roller.position.set(x, -0.74, 0);
          roller.rotation.z = Math.PI / 2;
          group.add(roller);
          rotatingObjects.push(Object.assign(roller, { userData: { speed: index % 2 ? -0.012 : 0.012 } }));
        });
        addLine([[-5.8, -0.7, -0.6], [5.8, -0.7, -0.6]], cyan, 0.38);
        addLine([[-5.8, -0.7, 0.6], [5.8, -0.7, 0.6]], cyan, 0.38);
        const addOutlinedBox = (size, position, color = cyan) => {
          const box = new THREE.Mesh(new THREE.BoxGeometry(...size), shellMaterial.clone());
          box.position.set(...position);
          group.add(box);
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), edgeMaterial(color));
          edges.position.copy(box.position);
          group.add(edges);
          return box;
        };
        const intakeTank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.8, 18), new THREE.MeshBasicMaterial({ color: 0x0a3047, transparent: true, opacity: 0.66 }));
        intakeTank.position.set(-5.45, -0.04, 0);
        group.add(intakeTank);
        const intakeWire = new THREE.LineSegments(new THREE.EdgesGeometry(intakeTank.geometry), edgeMaterial(cyan, 0.64));
        intakeWire.position.copy(intakeTank.position);
        group.add(intakeWire);
        const intakeRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.028, 8, 44), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.78 }));
        intakeRing.position.set(-5.45, -0.12, 0);
        intakeRing.rotation.x = Math.PI / 2;
        group.add(intakeRing);
        rotatingObjects.push(Object.assign(intakeRing, { userData: { speed: 0.008 } }));

        addOutlinedBox([2.45, 1.65, 1.35], [-4.25, 0.05, 0], cyan);
        addOutlinedBox([2.78, 0.18, 1.72], [-4.25, -0.92, 0], muted);
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 2), new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.58 }));
        core.position.set(-4.68, 0.12, 0.2);
        group.add(core);
        const coreWire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.7, 1)), edgeMaterial(cyan, 0.7));
        coreWire.position.copy(core.position);
        group.add(coreWire);
        rotatingObjects.push(Object.assign(core, { userData: { speed: 0.005 } }), Object.assign(coreWire, { userData: { speed: -0.003 } }));
        const logicRack = addOutlinedBox([0.7, 1.02, 0.82], [-3.63, 0.08, 0.08], gold);
        for (let index = 0; index < 4; index += 1) {
          const wafer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.64), new THREE.MeshBasicMaterial({ color: index % 2 ? cyan : gold, transparent: true, opacity: 0.36 }));
          wafer.position.set(-3.63, -0.25 + index * 0.22, 0.12);
          group.add(wafer);
        }
        const logicRotor = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.75 }));
        logicRotor.position.set(-3.63, 0.08, 0.52);
        group.add(logicRotor);
        rotatingObjects.push(Object.assign(logicRotor, { userData: { speed: 0.009 } }));
        void logicRack;

        for (let index = 0; index < 3; index += 1) {
          const dataBox = addOutlinedBox([0.76, 0.45, 0.8], [-1.45, -0.46 + index * 0.49, 0.02], index === 2 ? teal : cyan);
          dataBox.material.opacity = 0.58;
        }
        const dataHalo = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.018, 6, 64), new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.4 }));
        dataHalo.position.set(-1.45, -0.02, 0);
        dataHalo.rotation.x = Math.PI / 2;
        group.add(dataHalo);
        rotatingObjects.push(Object.assign(dataHalo, { userData: { speed: 0.004 } }));

        const cloudGroup = new THREE.Group();
        cloudGroup.position.set(1.65, 0.1, 0);
        [[-0.48, -0.08, 0.42], [0, 0.2, 0.58], [0.5, -0.05, 0.4], [0, -0.25, 0.68]].forEach(([x, y, scale], index) => {
          const cloudNode = new THREE.Mesh(new THREE.SphereGeometry(scale, 18, 18), new THREE.MeshBasicMaterial({ color: index === 1 ? teal : cyan, transparent: true, opacity: 0.18 + index * 0.07 }));
          cloudNode.position.set(x, y, 0);
          cloudGroup.add(cloudNode);
          const nodeWire = new THREE.LineSegments(new THREE.EdgesGeometry(cloudNode.geometry), edgeMaterial(index === 1 ? teal : cyan, 0.32));
          nodeWire.position.copy(cloudNode.position);
          cloudGroup.add(nodeWire);
        });
        group.add(cloudGroup);
        rotatingObjects.push(Object.assign(cloudGroup, { userData: { speed: 0.0018 } }));

        const gatewayRack = addOutlinedBox([1.2, 1.78, 0.72], [2.7, 0, 0], teal);
        gatewayRack.material.opacity = 0.52;
        for (let index = 0; index < 5; index += 1) {
          const gatewaySlot = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: index % 2 ? cyan : teal, transparent: true, opacity: 0.62 }));
          gatewaySlot.position.set(2.7, -0.52 + index * 0.24, 0.39);
          group.add(gatewaySlot);
        }

        addOutlinedBox([2.18, 1.38, 0.18], [4.72, 0.16, 0], teal);
        const terminalScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 1.04), new THREE.MeshBasicMaterial({ color: 0x09273a, transparent: true, opacity: 0.86 }));
        terminalScreen.position.set(4.72, 0.16, 0.1);
        group.add(terminalScreen);
        for (let index = 0; index < 7; index += 1) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.54, 0.025), new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? gold : cyan, transparent: true, opacity: 0.68 }));
          bar.position.set(4.14 + index * 0.19, -0.05, 0.13);
          bar.userData.phase = index * 0.76;
          bar.userData.baseY = bar.position.y;
          group.add(bar);
          computeBars.push(bar);
        }
        const terminalScan = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.025), new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.6 }));
        terminalScan.position.set(4.72, 0.62, 0.13);
        group.add(terminalScan);
        screenScanners.push(terminalScan);
        addOutlinedBox([0.16, 0.55, 0.16], [4.72, -0.78, 0], muted);
        addOutlinedBox([1.08, 0.12, 0.68], [4.72, -1.08, 0], muted);

        const deliveryCurves = [-0.23, 0, 0.23].map((depth, lane) => {
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-3.02, 0.15 + lane * 0.08, depth),
            new THREE.Vector3(-2.35, 0.65 - lane * 0.12, depth),
            new THREE.Vector3(-1.45, 0.36 + lane * 0.1, depth),
            new THREE.Vector3(0.1, 0.82 - lane * 0.13, depth),
            new THREE.Vector3(1.65, 0.35 + lane * 0.08, depth),
            new THREE.Vector3(2.7, 0.44 - lane * 0.08, depth),
            new THREE.Vector3(3.64, 0.3 + lane * 0.05, depth),
          ]);
          group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.012, 5, false), new THREE.MeshBasicMaterial({ color: lane === 1 ? gold : teal, transparent: true, opacity: 0.26 })));
          return curve;
        });
        for (let index = 0; index < 33; index += 1) {
          const packet = new THREE.Mesh(
            index % 8 === 0 ? new THREE.BoxGeometry(0.13, 0.055, 0.09) : new THREE.SphereGeometry(index % 5 === 0 ? 0.052 : 0.028, 8, 8),
            new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? gold : (index % 2 ? cyan : teal), transparent: true, opacity: 0.9 })
          );
          packet.userData.offset = index / 33;
          packet.userData.kind = "delivery";
          packet.userData.curve = deliveryCurves[index % deliveryCurves.length];
          group.add(packet);
          movingPoints.push(packet);
        }
        const floor = new THREE.GridHelper(14, 18, muted, muted);
        floor.position.y = -1.18;
        floor.material.transparent = true;
        floor.material.opacity = 0.12;
        group.add(floor);
      } else if (sceneType === "orbit") {
        group.position.y = 0.5;
        const core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.52, 2),
          new THREE.MeshBasicMaterial({ color: teal, transparent: true, opacity: 0.78 })
        );
        group.add(core);
        const coreWire = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.78, 1)),
          new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.52 })
        );
        group.add(coreWire);
        rotatingObjects.push(Object.assign(core, { userData: { speed: 0.0035 } }));
        rotatingObjects.push(Object.assign(coreWire, { userData: { speed: -0.0025 } }));

        const orbitRadii = [1.35, 1.95, 2.62, 3.32, 4.02, 4.72];
        orbitRadii.forEach((radius, index) => {
          const pivot = new THREE.Group();
          pivot.rotation.x = 0.04 + index * 0.045;
          pivot.rotation.z = (index - 2.5) * 0.035;
          pivot.userData.speed = 0.0013 + index * 0.00045;
          const orbit = new THREE.Mesh(
            new THREE.TorusGeometry(radius, index === 4 ? 0.018 : 0.01, 5, 128),
            new THREE.MeshBasicMaterial({ color: index === 4 ? teal : (index % 3 === 0 ? gold : cyan), transparent: true, opacity: index === 4 ? 0.55 : 0.2 })
          );
          orbit.rotation.x = Math.PI / 2;
          pivot.add(orbit);
          const planet = new THREE.Mesh(
            new THREE.SphereGeometry(index === 4 ? 0.19 : 0.105 + index * 0.012, 18, 18),
            new THREE.MeshBasicMaterial({ color: index === 4 ? teal : (index % 2 ? gold : cyan), transparent: true, opacity: 0.9 })
          );
          planet.position.x = radius;
          pivot.add(planet);
          const halo = new THREE.Mesh(
            new THREE.TorusGeometry(index === 4 ? 0.29 : 0.18, 0.012, 6, 36),
            new THREE.MeshBasicMaterial({ color: index === 4 ? teal : cyan, transparent: true, opacity: 0.48 })
          );
          halo.position.copy(planet.position);
          halo.rotation.x = 1.05 + index * 0.1;
          pivot.add(halo);
          pivot.rotation.y = index * 0.92;
          group.add(pivot);
          rotatingObjects.push(pivot);
        });

        const starPositions = [];
        for (let index = 0; index < 110; index += 1) {
          const angle = index * 2.399;
          const radius = 1.1 + ((index * 47) % 100) / 100 * 4.8;
          starPositions.push(Math.cos(angle) * radius, ((index * 31) % 100) / 100 * 1.6 - 0.8, Math.sin(angle) * radius);
        }
        const stars = new THREE.BufferGeometry();
        stars.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
        group.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x9bdcff, size: 0.025, transparent: true, opacity: 0.48 })));
        [0.03, 0.27, 0.51, 0.73, 0.91].forEach((offset, index) => {
          const meteor = new THREE.Group();
          const direction = index % 2 ? -1 : 1;
          const trailMaterial = new THREE.LineBasicMaterial({ color: index % 3 === 0 ? gold : cyan, transparent: true, opacity: 0 });
          const trail = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-direction * (0.6 + index * 0.12), 0.24 + index * 0.035, 0)]),
            trailMaterial
          );
          const headMaterial = new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? gold : cyan, transparent: true, opacity: 0 });
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.035 + index * 0.004, 7, 7), headMaterial);
          meteor.add(trail, head);
          meteor.userData = { offset, direction, speed: 0.09 + index * 0.017, trailMaterial, headMaterial, depth: -0.8 + index * 0.37 };
          meteor.visible = false;
          group.add(meteor);
          meteors.push(meteor);
        });
      } else {
        group.position.y = 0;
        const segmentsU = 180;
        const segmentsV = 22;
        const positions = [];
        const indices = [];
        const radius = 3.05;
        const halfWidth = 0.72;
        for (let uIndex = 0; uIndex <= segmentsU; uIndex += 1) {
          const u = uIndex / segmentsU * Math.PI * 2;
          for (let vIndex = 0; vIndex <= segmentsV; vIndex += 1) {
            const v = (vIndex / segmentsV * 2 - 1) * halfWidth;
            positions.push(
              (radius + v * Math.cos(u / 2)) * Math.cos(u),
              (radius + v * Math.cos(u / 2)) * Math.sin(u),
              v * Math.sin(u / 2)
            );
          }
        }
        for (let uIndex = 0; uIndex < segmentsU; uIndex += 1) {
          for (let vIndex = 0; vIndex < segmentsV; vIndex += 1) {
            const a = uIndex * (segmentsV + 1) + vIndex;
            const b = a + segmentsV + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
        const mobiusGeometry = new THREE.BufferGeometry();
        mobiusGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        mobiusGeometry.setIndex(indices);
        mobiusGeometry.computeVertexNormals();
        const mobius = new THREE.Mesh(
          mobiusGeometry,
          new THREE.MeshBasicMaterial({ color: teal, side: THREE.DoubleSide, transparent: true, opacity: 0.24 })
        );
        mobius.rotation.x = 1.05;
        mobius.rotation.z = -0.2;
        group.add(mobius);
        const wire = new THREE.Mesh(
          mobiusGeometry,
          new THREE.MeshBasicMaterial({ color: cyan, side: THREE.DoubleSide, wireframe: true, transparent: true, opacity: 0.13 })
        );
        wire.rotation.copy(mobius.rotation);
        group.add(wire);
        mobius.userData.speed = 0.00045;
        wire.userData.speed = -0.00028;
        rotatingObjects.push(mobius, wire);

        const centerLine = [];
        for (let index = 0; index <= 180; index += 1) {
          const u = index / 180 * Math.PI * 2;
          centerLine.push(new THREE.Vector3(radius * Math.cos(u), radius * Math.sin(u), 0));
        }
        const trace = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(centerLine),
          new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.72 })
        );
        trace.rotation.copy(mobius.rotation);
        group.add(trace);
        for (let index = 0; index < 22; index += 1) {
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(index % 5 === 0 ? 0.07 : 0.04, 8, 8),
            new THREE.MeshBasicMaterial({ color: index % 5 === 0 ? gold : cyan, transparent: true, opacity: 0.88 })
          );
          point.userData.offset = index / 22;
          point.userData.kind = "mobius";
          group.add(point);
          movingPoints.push(point);
        }
      }

      let width = 1;
      let height = 1;
      let frameId = 0;
      let visible = true;
      let time = 0;
      const pointer = { x: 0, y: 0 };

      const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        width = Math.max(1, Math.round(bounds.width));
        height = Math.max(1, Math.round(bounds.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = sceneType === "orbit" ? (width < 620 ? 13.8 : 10.8) : (sceneType === "delivery" ? (width < 620 ? 10.8 : 6.8) : (width < 620 ? 12.8 : 10.5));
        camera.position.y = sceneType === "orbit" ? 5.1 : (sceneType === "mobius" ? 1.7 : (sceneType === "delivery" ? 2.25 : (width < 620 ? 1.9 : 2.3)));
        camera.lookAt(0, 0, 0);
        group.scale.setScalar(sceneType === "orbit" && width < 620 ? 0.82 : (sceneType === "mobius" ? (width < 620 ? 0.68 : 0.76) : (sceneType === "delivery" ? (width < 620 ? 0.82 : 1.12) : (width < 620 ? 1.08 : 1))));
        camera.updateProjectionMatrix();
        delete canvas.dataset.pixelCheck;
      };

      const render = () => {
        if (!visible) return;
        time += reducedMotion ? 0 : 0.008;
        group.rotation.y += (pointer.x * 0.11 - group.rotation.y) * 0.035;
        group.rotation.x += (-pointer.y * 0.06 - group.rotation.x) * 0.035;
        rotatingObjects.forEach((object, index) => {
          object.rotation.y += reducedMotion ? 0 : (object.userData.speed ?? (0.0025 + index * 0.0004));
          if (sceneType === "pipeline") object.rotation.z += reducedMotion ? 0 : 0.0007;
        });
        computeBars.forEach((bar) => {
          const value = reducedMotion ? 0.72 : 0.28 + (Math.sin(time * 3.4 + bar.userData.phase) + 1) * 0.34;
          bar.scale.y = value;
          bar.position.y = bar.userData.baseY + (value - 1) * 0.25;
        });
        screenScanners.forEach((scanner, index) => {
          scanner.position.y = 0.58 - ((time * 0.55 + index * 0.3) % 1) * 1.12;
          scanner.material.opacity = reducedMotion ? 0.45 : 0.28 + (Math.sin(time * 4 + index) + 1) * 0.2;
        });
        movingPoints.forEach((point) => {
          const progress = (time * 0.18 + point.userData.offset) % 1;
          if (point.userData.kind === "bookToComputer") {
            point.position.copy(point.userData.curve.getPointAt(progress));
            if (point.userData.isPage) {
              point.rotation.set(0.15 + progress * 0.4, progress * Math.PI * 2, progress * 0.7);
            }
            point.material.opacity = Math.sin(progress * Math.PI) * 0.84;
          } else if (point.userData.kind === "mobius") {
            const u = progress * Math.PI * 2;
            const v = Math.sin(progress * Math.PI * 6) * 0.34;
            point.position.set(
              (3.05 + v * Math.cos(u / 2)) * Math.cos(u),
              (3.05 + v * Math.cos(u / 2)) * Math.sin(u),
              v * Math.sin(u / 2)
            );
            point.position.applyEuler(new THREE.Euler(1.05, 0, -0.2));
          } else {
            point.position.x = -4.4 + progress * 8.8;
            point.position.y = 0.4 + Math.sin(progress * Math.PI * 4) * 0.08;
            point.position.z = Math.sin(progress * Math.PI * 2) * 0.24;
          }
        });
        meteors.forEach((meteor) => {
          const cycle = (time * meteor.userData.speed + meteor.userData.offset) % 1;
          const active = cycle < 0.13;
          meteor.visible = active;
          if (!active) return;
          const progress = cycle / 0.13;
          const direction = meteor.userData.direction;
          meteor.position.set(
            direction > 0 ? -5.8 + progress * 11.6 : 5.8 - progress * 11.6,
            3.1 - progress * (3.9 + meteor.userData.speed * 5),
            meteor.userData.depth
          );
          const opacity = Math.sin(progress * Math.PI);
          meteor.userData.trailMaterial.opacity = opacity * 0.64;
          meteor.userData.headMaterial.opacity = opacity;
        });
        renderer.render(scene, camera);
        if (!canvas.dataset.pixelCheck) {
          const gl = renderer.getContext();
          const sampleWidth = Math.min(256, gl.drawingBufferWidth);
          const sampleHeight = Math.min(256, gl.drawingBufferHeight);
          const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
          gl.readPixels(
            Math.max(0, Math.floor((gl.drawingBufferWidth - sampleWidth) / 2)),
            Math.max(0, Math.floor((gl.drawingBufferHeight - sampleHeight) / 2)),
            sampleWidth,
            sampleHeight,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
          );
          let nonBlank = 0;
          for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) nonBlank += 1;
          canvas.dataset.pixelCheck = String(nonBlank);
        }
        if (!reducedMotion) frameId = window.requestAnimationFrame(render);
      };

      host.addEventListener("pointermove", (event) => {
        const bounds = host.getBoundingClientRect();
        pointer.x = (event.clientX - bounds.left) / bounds.width - 0.5;
        pointer.y = (event.clientY - bounds.top) / bounds.height - 0.5;
      });
      host.addEventListener("pointerleave", () => { pointer.x = 0; pointer.y = 0; });

      const observer = new IntersectionObserver((entries) => {
        const nextVisible = entries[0].isIntersecting;
        if (nextVisible === visible) return;
        visible = nextVisible;
        if (visible) render();
        else window.cancelAnimationFrame(frameId);
      }, { threshold: 0.04 });
      observer.observe(host);
      new ResizeObserver(resize).observe(host);
      window.addEventListener("pagehide", () => {
        observer.disconnect();
        window.cancelAnimationFrame(frameId);
        renderer.dispose();
      }, { once: true });
      resize();
      render();
    });
  }

  function initGsapMotion() {
    if (reducedMotion || !window.gsap) return;
    const gsap = window.gsap;
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

    gsap.from(".hero-content > *", {
      opacity: 0,
      y: 20,
      duration: 0.7,
      stagger: 0.09,
      ease: "power3.out",
    });
    gsap.from(".hero-data-forge", {
      opacity: 0,
      x: 32,
      duration: 1.1,
      delay: 0.2,
      ease: "power3.out",
    });

    if (!window.ScrollTrigger) return;
    gsap.from(".system-core", {
      opacity: 0,
      scale: 0.82,
      duration: 0.8,
      ease: "back.out(1.5)",
      scrollTrigger: { trigger: ".system-map", start: "top 74%", once: true },
    });
    gsap.from(".system-node", {
      opacity: 0,
      y: 18,
      scale: 0.96,
      duration: 0.62,
      stagger: 0.1,
      ease: "power3.out",
      scrollTrigger: { trigger: ".system-map", start: "top 72%", once: true },
    });
    gsap.from(".story-step", {
      opacity: 0,
      y: 24,
      duration: 0.55,
      stagger: 0.08,
      ease: "power2.out",
      scrollTrigger: { trigger: ".constellation-map", start: "top 72%", once: true },
    });
    gsap.from(".loop-core", {
      opacity: 0,
      scale: 0.75,
      duration: 0.8,
      ease: "back.out(1.5)",
      scrollTrigger: { trigger: ".logic-loop", start: "top 74%", once: true },
    });
    gsap.from(".logic-loop .method-orbit li", {
      opacity: 0,
      y: 16,
      duration: 0.58,
      stagger: 0.12,
      ease: "power2.out",
      scrollTrigger: { trigger: ".logic-loop", start: "top 70%", once: true },
    });
    gsap.from(".gallery-frame", {
      opacity: 0,
      y: 24,
      duration: 0.65,
      stagger: 0.12,
      ease: "power2.out",
      scrollTrigger: { trigger: ".product-gallery", start: "top 78%", once: true },
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.toggle("reduced-motion", reducedMotion);
    if (window.lucide) window.lucide.createIcons();
    initStellarField();
    initHeroDataForge();
    initThreeScenes();
    initProductCarousel();
    initRevealMotion();
    initGsapMotion();
  });
})();
