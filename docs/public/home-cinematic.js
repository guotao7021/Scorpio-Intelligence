(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  async function initThreeScenes() {
    let THREE = window.THREE;
    if (!THREE) {
      try {
        THREE = await import("./vendor/three.module.min.js");
      } catch (_error) {
        return;
      }
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

      const addLine = (points, color, opacity = 0.45) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
        group.add(line);
        return line;
      };

      if (canvas.dataset.scene === "pipeline") {
        group.position.y = 0.75;
        const positions = [-4.2, -1.4, 1.4, 4.2];
        addLine(positions.map((x) => [x, 0.4, 0]), cyan, 0.52);
        positions.forEach((x, index) => {
          const geometry = new THREE.BoxGeometry(0.82, 0.82, 0.82);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: index === 3 ? teal : gold, transparent: true, opacity: 0.62 })
          );
          edges.position.set(x, 0.4, index % 2 ? -0.28 : 0.28);
          edges.rotation.set(0.45, 0.55, 0.12);
          rotatingObjects.push(edges);
          group.add(edges);
        });

        for (let index = 0; index < 18; index += 1) {
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(index % 6 === 0 ? 0.065 : 0.035, 8, 8),
            new THREE.MeshBasicMaterial({ color: index % 6 === 0 ? gold : teal, transparent: true, opacity: 0.78 })
          );
          point.userData.offset = index / 18;
          group.add(point);
          movingPoints.push(point);
        }
        const grid = new THREE.GridHelper(13, 13, muted, muted);
        grid.position.y = -1.65;
        grid.material.transparent = true;
        grid.material.opacity = 0.13;
        group.add(grid);
      } else {
        group.position.y = 1.25;
        const positions = [-4.1, -1.37, 1.37, 4.1];
        addLine(positions.map((x, index) => [x, 0.7 - index * 0.16, -index * 0.25]), teal, 0.42);
        positions.forEach((x, index) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.54, 0.035, 8, 44),
            new THREE.MeshBasicMaterial({ color: index === 3 ? teal : gold, wireframe: false, transparent: true, opacity: 0.62 })
          );
          ring.position.set(x, 0.7 - index * 0.16, -index * 0.25);
          ring.rotation.set(1.05, 0.2 + index * 0.16, 0.15);
          rotatingObjects.push(ring);
          group.add(ring);
        });
        const decisionFrame = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(8.8, 0.75, 0.3)),
          new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.28 })
        );
        decisionFrame.position.set(0, -1.05, -0.6);
        group.add(decisionFrame);
        for (let index = 0; index < 12; index += 1) {
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 8, 8),
            new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? gold : cyan, transparent: true, opacity: 0.8 })
          );
          point.userData.offset = index / 12;
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
        const bounds = host.getBoundingClientRect();
        width = Math.max(1, Math.round(bounds.width));
        height = Math.max(1, Math.round(bounds.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = width < 620 ? 12.8 : 10.5;
        camera.position.y = width < 620 ? 1.9 : 2.3;
        camera.lookAt(0, 0, 0);
        group.scale.setScalar(width < 620 ? 1.08 : 1);
        camera.updateProjectionMatrix();
        delete canvas.dataset.pixelCheck;
      };

      const render = () => {
        if (!visible) return;
        time += reducedMotion ? 0 : 0.008;
        group.rotation.y += (pointer.x * 0.11 - group.rotation.y) * 0.035;
        group.rotation.x += (-pointer.y * 0.06 - group.rotation.x) * 0.035;
        rotatingObjects.forEach((object, index) => {
          object.rotation.y += reducedMotion ? 0 : 0.0025 + index * 0.0004;
          object.rotation.z += reducedMotion ? 0 : 0.0012;
        });
        movingPoints.forEach((point) => {
          const progress = (time * 0.18 + point.userData.offset) % 1;
          point.position.x = -4.4 + progress * 8.8;
          point.position.y = canvas.dataset.scene === "pipeline" ? 0.4 + Math.sin(progress * Math.PI * 4) * 0.08 : 0.74 - progress * 0.52 + Math.sin(progress * Math.PI * 4) * 0.07;
          point.position.z = canvas.dataset.scene === "pipeline" ? Math.sin(progress * Math.PI * 2) * 0.24 : -progress;
        });
        renderer.render(scene, camera);
        if (!canvas.dataset.pixelCheck) {
          const gl = renderer.getContext();
          const sampleWidth = Math.min(128, gl.drawingBufferWidth);
          const sampleHeight = Math.min(128, gl.drawingBufferHeight);
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
    gsap.from(".hero-workbench", {
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
    initThreeScenes();
    initProductCarousel();
    initRevealMotion();
    initGsapMotion();
  });
})();
