/**
 * FlowCredit | Revenue-Based Lending
 * Architect-grade Production Script
 * 
 * DESIGN PRINCIPLES:
 * - Module-based architecture with cached DOM references.
 * - Unified event delegation (one click, one keydown listener).
 * - Performance optimized: cached layout metrics, rAF ticking.
 * - Zero JS timing: CSS-driven UI lifecycle.
 * - Memory leak prevention: No duplicated global listeners.
 */
(function () {
  'use strict';

  // --- Internal State & Registry ---
  const state = {
    isAnimationsDisabled: false,
    activeSection: null,
    navOffsets: new Map(), // sectionId -> { top, height }
    isScrolling: false,
    isInitialized: false
  };

  const modules = {};

  // --- Utilities ---
  const rAF = (fn) => window.requestAnimationFrame(fn);

  // --- Preferences Module ---
  modules.Preferences = {
    keys: {
      theme: 'flow_theme',
      animations: 'flow_animations',
      bg: 'flow_bg'
    },

    init() {
      this.apply();
    },

    apply() {
      const theme = localStorage.getItem(this.keys.theme) || 'dark';
      const animations = localStorage.getItem(this.keys.animations);
      const bg = localStorage.getItem(this.keys.bg);

      document.documentElement.setAttribute('data-theme', theme);
      this.updateIcon(theme);

      if (animations === 'disabled') {
        document.documentElement.classList.add('animations-disabled');
        state.isAnimationsDisabled = true;
      }

      if (bg === 'disabled') {
        document.documentElement.classList.add('bg-disabled');
      }
    },

    toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(this.keys.theme, next);
      this.updateIcon(next);
      this.animateToggle();
    },

    updateIcon(theme) {
      const btn = document.getElementById('themeToggle');
      if (btn) {
        btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      }
    },

    animateToggle() {
      const btn = document.getElementById('themeToggle');
      if (btn) {
        btn.classList.add('rotate-icon');
        setTimeout(() => {
          btn.classList.remove('rotate-icon');
        }, 400);
      }
    },

    toggleAnimations() {
      state.isAnimationsDisabled = document.documentElement.classList.toggle('animations-disabled');
      localStorage.setItem(this.keys.animations, state.isAnimationsDisabled ? 'disabled' : 'enabled');
    },

    toggleBg() {
      const isBgDisabled = document.documentElement.classList.toggle('bg-disabled');
      localStorage.setItem(this.keys.bg, isBgDisabled ? 'disabled' : 'enabled');
    },

    reset() {
      document.documentElement.removeAttribute('data-theme');
      state.isAnimationsDisabled = false;
      localStorage.removeItem(this.keys.theme);
      localStorage.removeItem(this.keys.animations);
      localStorage.removeItem(this.keys.bg);
    }
  };

  // --- Toast Module ---
  modules.Toast = {
    container: null,

    init() {
      this.container = document.getElementById('toastContainer');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toastContainer';
        document.body.appendChild(this.container);
      }

      // Single listener for all toast lifecycle ends
      this.container.addEventListener('animationend', (e) => {
        const toast = e.target;

        if (toast.classList.contains('toast-show')) {
          toast.classList.remove('toast-show');
          toast.classList.add('toast-exit');
          return;
        }

        if (toast.classList.contains('toast-exit')) {
          toast.remove();
        }
      });
    },

    show(message, type = 'info') {
      if (!this.container) this.init();

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      this.container.appendChild(toast);

      rAF(() => {
        toast.classList.add('toast-show');
      });
    }
  };

  // --- Navigation Module ---
  modules.Navigation = {
    links: [],
    sections: [],
    navbarHeight: 72,

    init() {
      this.links = Array.from(document.querySelectorAll('[data-section]'));
      this.sections = this.links.reduce((acc, link) => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          const el = document.getElementById(href.substring(1));
          if (el) acc.push(el);
        }
        return acc;
      }, []);

      this.cacheMetrics();
      this.initScrollTracking();
    },

    cacheMetrics() {
      state.navOffsets.clear();
      this.sections.forEach(section => {
        state.navOffsets.set(section.id, {
          top: section.offsetTop,
          height: section.offsetHeight
        });
      });
    },

    initScrollTracking() {
      window.addEventListener('scroll', () => {
        if (!state.isScrolling) {
          rAF(() => {
            this.updateActive();
            state.isScrolling = false;
          });
          state.isScrolling = true;
        }
      }, { passive: true });
    },

    updateActive() {
      const scrollY = window.scrollY + this.navbarHeight + 15;
      let currentId = null;

      // Use cached Map for O(1) retrieval per section iteration
      for (const [id, metrics] of state.navOffsets) {
        if (scrollY >= metrics.top && scrollY < metrics.top + metrics.height) {
          currentId = id;
          break;
        }
      }

      if (currentId !== state.activeSection) {
        state.activeSection = currentId;
        this.links.forEach(link => {
          const target = link.getAttribute('href').substring(1);
          link.classList.toggle('active', target === currentId);
        });
      }
    },

    scrollTo(id) {
      const metrics = state.navOffsets.get(id);
      if (!metrics) return;

      window.scrollTo({
        top: metrics.top - this.navbarHeight,
        behavior: state.isAnimationsDisabled ? 'auto' : 'smooth'
      });
    }
  };

  // --- Stats Module ---
  modules.Stats = {
    animated: new WeakSet(),

    init() {
      const elements = Array.from(document.querySelectorAll('.stat-value'));
      if (!elements.length) return;

      // Trigger counter only when stat section is visible
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const statCards = entry.target.querySelectorAll('.stat-value');
            statCards.forEach(el => {
              if (!this.animated.has(el)) {
                this.animated.add(el);
                this.animate(el);
              }
            });
          }
        });
      }, { threshold: 0.3 });

      const statsSection = document.getElementById('stats');
      if (statsSection) observer.observe(statsSection);
    },

    animate(el) {
      const originalText = el.textContent;
      let numericPart = '';
      let prefix = '';
      let suffix = '';
      let charFound = false;
      let precision = 0;
      let isDecimal = false;

      // Rule: No Regex. Manual character iteration.
      for (let i = 0; i < originalText.length; i++) {
        const c = originalText[i];
        if ((c >= '0' && c <= '9') || c === '.') {
          charFound = true;
          numericPart += c;
          if (c === '.') isDecimal = true;
          else if (isDecimal) precision++;
        } else if (c === ',') {
          // Manual comma removal
        } else {
          if (!charFound) prefix += c;
          else suffix += c;
        }
      }

      const val = parseFloat(numericPart) || 0;
      if (val === 0 || state.isAnimationsDisabled) {
        el.textContent = originalText;
        return;
      }

      let start = null;
      const duration = 1600;

      const step = (now) => {
        if (!start) start = now;
        const progress = Math.min((now - start) / duration, 1);
        // Ease-out quad
        const eased = 1 - (1 - progress) * (1 - progress);
        const current = val * eased;

        // Build numeric string manually (toFixed for precision)
        el.textContent = `${prefix}${current.toFixed(precision)}${suffix}`;

        if (progress < 1) {
          rAF(step);
        } else {
          // Restore EXACT original text
          el.textContent = originalText;
        }
      };

      rAF(step);
    }
  };

  // --- Loan Context Module ---
  modules.LoanSystem = {
    container: null,

    init() {
      this.container = document.getElementById('loanContainer');
      if (!this.container) return;
      this.render();
    },

    render(notify = false) {
      // Wipe existing cards cleanly (no innerHTML)
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }

      const loans = [
        { biz: 'Nexus BioHealth', amt: '142,500', rate: '5.2', term: '24' },
        { biz: 'SolarStream Energy', amt: '98,000', rate: '4.8', term: '18' },
        { biz: 'Veritas Logistics', amt: '215,000', rate: '6.5', term: '36' }
      ];

      // Force browser reflow before inserting new cards so
      // CSS @keyframes cardEntrance always replays on refresh
      const frag = document.createDocumentFragment();

      loans.forEach((data, idx) => {
        const card = document.createElement('article');
        card.className = 'loan-card';
        // Override nth-child delay precisely (belt-and-suspenders)
        card.style.animationDelay = `${idx * 0.09}s`;

        const h3 = document.createElement('h3');
        h3.textContent = data.biz;
        card.appendChild(h3);

        const meta = document.createElement('div');
        meta.className = 'loan-meta';

        const details = [
          `Amount: $${data.amt}`,
          `Share: ${data.rate}%`,
          `Duration: ${data.term}m`
        ];

        details.forEach(txt => {
          const s = document.createElement('span');
          s.textContent = txt;
          meta.appendChild(s);
        });

        card.appendChild(meta);

        const btn = document.createElement('button');
        // fund-btn gives premium gradient + glow; no btn-secondary needed
        btn.className = 'fund-btn';
        btn.textContent = 'Fund Loan';
        btn.setAttribute('type', 'button');
        card.appendChild(btn);

        frag.appendChild(card);
      });

      // Single DOM mutation – insert all cards together
      this.container.appendChild(frag);

      if (notify) {
        modules.Toast.show('Loan marketplace refreshed from chain', 'info');
      }
    }
  };

  // --- Form Module ---
  modules.BorrowForm = {
    form: null,
    inputs: {},

    init() {
      this.form = document.getElementById('borrowForm');
      if (!this.form) return;

      this.inputs = {
        amount: document.getElementById('loanAmount'),
        share: document.getElementById('revenueShare'),
        duration: document.getElementById('duration')
      };
    },

    validate() {
      if (!this.form || !this.inputs.amount || !this.inputs.share || !this.inputs.duration) {
        return false;
      }

      // Remove existing .form-error elements before validation
      const existing = this.form.querySelectorAll('.form-error');
      existing.forEach(e => e.remove());

      let valid = true;

      const amtVal = parseFloat(this.inputs.amount.value);
      if (isNaN(amtVal) || amtVal < 1000) {
        this.setError(this.inputs.amount, 'Min funding: $1,000');
        valid = false;
      }

      const shareVal = parseFloat(this.inputs.share.value);
      if (isNaN(shareVal) || shareVal < 1 || shareVal > 30) {
        this.setError(this.inputs.share, 'Range: 1% - 30%');
        valid = false;
      }

      const durVal = parseInt(this.inputs.duration.value, 10);
      if (isNaN(durVal) || durVal < 3 || durVal > 60) {
        this.setError(this.inputs.duration, 'Range: 3 - 60 mo');
        valid = false;
      }

      return valid;
    },

    setError(input, msg) {
      const group = input && input.closest('.form-group');
      if (!group) return;

      const err = document.createElement('span');
      err.className = 'form-error';
      err.textContent = msg;
      group.appendChild(err);
    },

    handleSubmit() {
      if (this.validate()) {
        modules.Toast.show('Liquidity request broadcasted', 'success');
        this.form.reset();
      }
    }
  };

  // --- Scroll Reveal Module ---
  modules.ScrollReveal = {
    observer: null,

    init() {
      if (!('IntersectionObserver' in window)) {
        // Fallback: reveal everything immediately
        document.querySelectorAll('.scroll-reveal, .scroll-reveal-stagger').forEach(el => {
          el.classList.add('revealed');
        });
        return;
      }

      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            this.observer.unobserve(entry.target); // fire once
          }
        });
      }, { threshold: 0.12 });

      document.querySelectorAll('.scroll-reveal, .scroll-reveal-stagger').forEach(el => {
        this.observer.observe(el);
      });
    }
  };

  // --- UI Orchestrator (Unified Event Handling) ---
  modules.UIController = {
    els: {},

    init() {
      this.els = {
        mobileMenu: document.getElementById('mobileMenu'),
        settings: document.getElementById('settingsPanel')
      };

      this.bindGlobalEvents();
    },

    bindGlobalEvents() {
      // Unified Click Handler
      document.addEventListener('click', (e) => {
        const id = e.target.id;
        const classes = e.target.classList;

        // Panel Toggles
        if (id === 'mobileMenuToggle') { if (this.els.mobileMenu) this.els.mobileMenu.classList.add('open'); return; }
        if (id === 'closeMobileMenu') { if (this.els.mobileMenu) this.els.mobileMenu.classList.remove('open'); return; }
        if (id === 'settingsToggle') { if (this.els.settings) this.els.settings.classList.add('open'); return; }
        if (id === 'closeSettings') { if (this.els.settings) this.els.settings.classList.remove('open'); return; }

        // Core Actions
        if (id === 'createLoan') {
          e.preventDefault();
          modules.BorrowForm.handleSubmit();
          return;
        }

        if (id === 'refreshLoans') {
          modules.LoanSystem.render(true);
          return;
        }

        if (classes.contains('fund-btn')) {
          modules.Toast.show('Collateral locks initiated', 'success');
          return;
        }

        // Navigation (Delegation)
        const navLink = e.target.closest('[data-section]');
        if (navLink) {
          e.preventDefault();
          const targetSection = navLink.getAttribute('href').substring(1);
          modules.Navigation.scrollTo(targetSection);
          if (this.els.mobileMenu) this.els.mobileMenu.classList.remove('open');
          return;
        }

        // Theme / Preferences
        if (id === 'themeToggle') { modules.Preferences.toggleTheme(); return; }
        if (id === 'toggleAnimations') { modules.Preferences.toggleAnimations(); return; }
        if (id === 'toggleBackgroundEffects') { modules.Preferences.toggleBg(); return; }
        if (id === 'resetPreferences') { modules.Preferences.reset(); return; }

        // Secondary Nav / Buttons
        if (id === 'launchApp') { modules.Navigation.scrollTo('borrowSection'); return; }
        if (id === 'learnMore') { modules.Navigation.scrollTo('platform'); return; }
        if (id === 'connectWallet' || id === 'mobileConnectWallet') {
          modules.Toast.show('Web3 provider connection initiated', 'info');
          return;
        }

        // Outside Click Handling
        if (this.els.mobileMenu && this.els.mobileMenu.classList.contains('open') &&
          !this.els.mobileMenu.contains(e.target) && id !== 'mobileMenuToggle') {
          this.els.mobileMenu.classList.remove('open');
        }

        if (this.els.settings && this.els.settings.classList.contains('open') &&
          !this.els.settings.contains(e.target) && id !== 'settingsToggle') {
          this.els.settings.classList.remove('open');
        }
      });

      // Unified Keydown Handler
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.els.mobileMenu) this.els.mobileMenu.classList.remove('open');
          if (this.els.settings) this.els.settings.classList.remove('open');
        }
      });

      // Window Events
      window.addEventListener('resize', () => {
        rAF(() => modules.Navigation.cacheMetrics());
      }, { passive: true });
    }
  };

  // --- Bootstrap ---
  document.addEventListener('DOMContentLoaded', () => {
    if (state.isInitialized) return;

    // Add scroll-reveal classes to key sections
    const platform = document.querySelector('.platform-section');
    if (platform) {
      const title = platform.querySelector('.section-title');
      const grid = platform.querySelector('.card-grid');
      if (title) title.classList.add('scroll-reveal');
      if (grid) grid.classList.add('scroll-reveal-stagger');
    }

    const stats = document.querySelector('.stats-section');
    if (stats) {
      const grid = stats.querySelector('.stats-grid');
      if (grid) grid.classList.add('scroll-reveal-stagger');
    }

    const borrow = document.querySelector('.borrow-section');
    if (borrow) {
      const h2 = borrow.querySelector('h2');
      const desc = borrow.querySelector('.section-description');
      const form = borrow.querySelector('.form-card');
      if (h2) h2.classList.add('scroll-reveal');
      if (desc) desc.classList.add('scroll-reveal');
      if (form) form.classList.add('scroll-reveal');
    }

    const analytics = document.querySelector('.analytics-section');
    if (analytics) {
      const h2 = analytics.querySelector('h2');
      const chart = analytics.querySelector('.chart-placeholder');
      const desc = analytics.querySelector('.analytics-description');
      if (h2) h2.classList.add('scroll-reveal');
      if (chart) chart.classList.add('scroll-reveal');
      if (desc) desc.classList.add('scroll-reveal');
    }

    // Ordered Init
    modules.Preferences.init();
    modules.Toast.init();
    modules.Navigation.init();
    modules.Stats.init();
    modules.BorrowForm.init();
    modules.LoanSystem.init();
    modules.UIController.init();
    modules.ScrollReveal.init();

    state.isInitialized = true;
  });

})();
