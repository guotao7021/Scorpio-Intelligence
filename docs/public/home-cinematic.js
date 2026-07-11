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
    initRevealMotion();
    initGsapMotion();
  });
})();
