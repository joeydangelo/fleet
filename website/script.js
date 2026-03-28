/* ================================================================
   Fleet Landing Page — Script
   Lenis smooth scroll + GSAP scroll reveals + Osmo media setup
   ================================================================ */

// --- Lenis Smooth Scroll + GSAP ScrollTrigger ---

gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);

// --- Nav scroll state ---

const nav = document.querySelector('.nav');

lenis.on('scroll', ({ scroll }) => {
  if (scroll > 40) {
    nav.classList.add('nav--scrolled');
  } else {
    nav.classList.remove('nav--scrolled');
  }
});

// --- Scroll Reveal Animations ---

document.querySelectorAll('[data-reveal]').forEach((el) => {
  gsap.fromTo(
    el,
    { opacity: 0, y: 24 },
    {
      opacity: 1,
      y: 0,
      duration: 0.7,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        once: true,
        onEnter: () => el.classList.add('is-visible'),
      },
    },
  );
});

// --- Copy Button ---

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('install-block__copy--copied');
      const svg = btn.querySelector('svg');
      const original = svg.innerHTML;
      svg.innerHTML =
        '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2"/>';
      setTimeout(() => {
        btn.classList.remove('install-block__copy--copied');
        svg.innerHTML = original;
      }, 1500);
    });
  });
});

// --- Osmo Media Setup (Autoplay / Viewport) ---

function initMediaSetup() {
  const mediaElements = document.querySelectorAll('[data-media-init]');
  if (!mediaElements.length) return;

  const viewportOffset = 0.1;
  const rootMarginValue = viewportOffset * 100;

  initMediaSetup._cleanup?.forEach((fn) => fn());
  const cleanupFns = [];

  mediaElements.forEach((mediaEl) => {
    const video = mediaEl.querySelector('[data-media-video-src]');
    if (!video) return;

    let isInView = false;
    let hasLoaded = false;
    let shouldBePlaying = false;

    const setStatus = (status) => {
      mediaEl.dataset.mediaStatus = status;
    };

    const addCleanup = (fn) => cleanupFns.push(fn);
    const on = (target, event, handler) => {
      target.addEventListener(event, handler);
      addCleanup(() => target.removeEventListener(event, handler));
    };

    const playAttempt = () => {
      video
        .play()
        .then(() => {
          if (shouldBePlaying) setStatus('playing');
        })
        .catch(() => {});
    };

    const loadVideo = () => {
      if (hasLoaded) return;
      const src = video.dataset.mediaVideoSrc;
      if (!src) return;
      video.muted = true;
      video.playsInline = true;
      video.src = src;
      video.load();
      hasLoaded = true;
    };

    const playVideo = () => {
      if (!isInView || document.hidden) return;
      shouldBePlaying = true;
      loadVideo();
      setStatus(video.readyState < 3 ? 'loading' : 'playing');
      playAttempt();
    };

    const pauseVideo = () => {
      shouldBePlaying = false;
      video.pause();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target !== mediaEl) return;
          isInView = entry.isIntersecting;
          if (isInView) {
            playVideo();
          } else if (!video.paused || shouldBePlaying) {
            setStatus('paused');
            pauseVideo();
          }
        });
      },
      {
        rootMargin: `${rootMarginValue}% 0px ${rootMarginValue}% 0px`,
        threshold: 0,
      },
    );

    observer.observe(mediaEl);

    on(video, 'playing', () => {
      if (shouldBePlaying) setStatus('playing');
    });
    on(video, 'waiting', () => {
      if (shouldBePlaying) setStatus('loading');
    });
    on(video, 'canplay', () => {
      if (shouldBePlaying && isInView && !document.hidden) playAttempt();
    });
    on(video, 'ended', () => {
      if (!shouldBePlaying || !isInView) return;
      video.currentTime = 0;
      playAttempt();
    });

    on(document, 'visibilitychange', () => {
      if (document.hidden) {
        if (!video.paused || shouldBePlaying) {
          setStatus('paused');
          pauseVideo();
        }
      } else if (isInView) {
        playVideo();
      }
    });

    addCleanup(() => observer.disconnect());
    addCleanup(() => {
      shouldBePlaying = false;
      video.pause();
    });
  });

  initMediaSetup._cleanup = cleanupFns;
}

// --- GitHub Star Count ---

function fetchStarCount() {
  const el = document.getElementById('starCount');
  if (!el) return;

  fetch('https://api.github.com/repos/joeydangelo/fleet')
    .then((r) => r.json())
    .then((data) => {
      if (data.stargazers_count != null) {
        const count = data.stargazers_count;
        el.textContent = count >= 1000 ? (count / 1000).toFixed(1) + 'k' : count;
      }
    })
    .catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  initMediaSetup();
  fetchStarCount();
});
