(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) window.lucide.createIcons();
    document.documentElement.classList.toggle("reduced-motion", reducedMotion);

    const revealItems = document.querySelectorAll("[data-reveal]");
    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.01 });
    revealItems.forEach((item) => observer.observe(item));

    const hero = document.querySelector(".hero-observatory");
    if (hero) {
      hero.addEventListener("pointermove", (event) => {
        const bounds = hero.getBoundingClientRect();
        hero.style.setProperty("--pointer-x", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 8}px`);
        hero.style.setProperty("--pointer-y", `${((event.clientY - bounds.top) / bounds.height - 0.5) * 8}px`);
      });
      hero.addEventListener("pointerleave", () => {
        hero.style.setProperty("--pointer-x", "0px");
        hero.style.setProperty("--pointer-y", "0px");
      });
    }

    if (window.gsap && window.ScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);
      const story = document.querySelector(".constellation-map");
      const storySteps = document.querySelectorAll(".story-step");
      if (story && storySteps.length) {
        window.gsap.fromTo(storySteps,
          { opacity: 0, y: 18 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.09,
            ease: "power2.out",
            scrollTrigger: { trigger: story, start: "top 72%", once: true },
          },
        );
        window.gsap.to(".constellation-core img", {
          rotation: 360,
          duration: 22,
          ease: "none",
          repeat: -1,
        });
      }
    }
  });
})();
