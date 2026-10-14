// SEE UR DATA motion layer: lightweight, dependency-free and privacy-preserving.
// No network requests, tracking, or interaction with submitted email values.
const canvas = document.getElementById("cyber-canvas");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const smallScreen = window.matchMedia("(max-width: 640px)");

if (canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (ctx) {
    let width = 0;
    let height = 0;
    let dpr = 1;
    let points = [];
    let raf = 0;
    let lastFrame = 0;
    let running = false;

    function seedPoints() {
      const target = Math.min(smallScreen.matches ? 28 : 54, Math.max(16, Math.floor((width * height) / 26000)));
      points = Array.from({ length: target }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: i % 7 === 0 ? 1.7 : 1.05,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedPoints();
      if (reducedMotion.matches) draw(0, true);
    }

    function draw(time, still = false) {
      ctx.clearRect(0, 0, width, height);
      const connection = smallScreen.matches ? 105 : 145;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        if (!still) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -8) p.x = width + 8;
          if (p.x > width + 8) p.x = -8;
          if (p.y < -8) p.y = height + 8;
          if (p.y > height + 8) p.y = -8;
        }
        const shimmer = still ? 0.45 : 0.3 + ((Math.sin(time * 0.0006 + p.phase) + 1) * 0.18);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61, 214, 245, ${shimmer})`;
        ctx.fill();
        for (let j = i + 1; j < points.length; j += 1) {
          const q = points[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connection) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(61, 214, 245, ${(1 - dist / connection) * 0.105})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }
    }

    function tick(time = 0) {
      if (!running || document.hidden) return;
      if (time - lastFrame > (smallScreen.matches ? 42 : 30)) {
        draw(time);
        lastFrame = time;
      }
      raf = window.requestAnimationFrame(tick);
    }

    function start() {
      if (reducedMotion.matches || document.hidden || running) return;
      running = true;
      raf = window.requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }
    function motionPreferenceChanged() {
      stop();
      if (reducedMotion.matches) draw(0, true);
      else start();
    }

    resize();
    if (reducedMotion.matches) draw(0, true);
    else start();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
    reducedMotion.addEventListener?.("change", motionPreferenceChanged);
    smallScreen.addEventListener?.("change", resize);
  }
}

// Reveal content only when motion is allowed. Content stays visible without JS.
if (!reducedMotion.matches && "IntersectionObserver" in window) {
  const candidates = document.querySelectorAll(
    ".section, .site-footer .wrap, .outcome, .principles li, .doc h1, .doc h2, .doc .callout, .doc table, .hero-eyebrow, .hero h1, .hero .lede, .console"
  );
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -28px 0px" });
  for (const element of candidates) {
    element.classList.add("motion-reveal");
    observer.observe(element);
  }
}

// Pointer glow follows the pointer only on fine-pointer devices; no custom cursor.
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !reducedMotion.matches) {
  for (const card of document.querySelectorAll(".console, .outcome, .breach-card, .callout")) {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      card.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    }, { passive: true });
  }
}
