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
      const theme = localStorage.getItem(this.keys.theme);
      const animations = localStorage.getItem(this.keys.animations);
      const bg = localStorage.getItem(this.keys.bg);

      if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
      if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

      if (animations === 'disabled') {
        document.documentElement.classList.add('animations-disabled');
        state.isAnimationsDisabled = true;
      }

      if (bg === 'disabled') {
        document.documentElement.classList.add('bg-disabled');
      }
    },

    toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem(this.keys.theme, newTheme);
      localStorage.setItem('theme', newTheme);
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
      document.documentElement.classList.remove('animations-disabled', 'bg-disabled');
      state.isAnimationsDisabled = false;
      localStorage.removeItem(this.keys.theme);
      localStorage.removeItem('theme');
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
    init() {
      const elements = Array.from(document.querySelectorAll('.stat-value'));
      if (!elements.length) return;

      elements.forEach(el => this.animate(el));
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
        const current = val * progress;

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
      // Rule: No innerHTML. Use while loop.
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }

      const loans = [
        { biz: 'Nexus BioHealth', amt: '142,500', rate: '5.2', term: '24' },
        { biz: 'SolarStream Energy', amt: '98,000', rate: '4.8', term: '18' },
        { biz: 'Veritas Logistics', amt: '215,000', rate: '6.5', term: '36' }
      ];

      loans.forEach(data => {
        const card = document.createElement('article');
        card.className = 'loan-card';

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
        btn.className = 'btn-secondary fund-btn';
        btn.textContent = 'Fund Loan';
        card.appendChild(btn);

        this.container.appendChild(card);
      });

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

    // Ordered Init
    modules.Preferences.init();
    modules.Toast.init();
    modules.Navigation.init();
    modules.Stats.init();
    modules.BorrowForm.init();
    modules.LoanSystem.init();
    modules.UIController.init();

    state.isInitialized = true;
  });

})();

const toggleBtn = document.getElementById("themeToggle");
const icon = document.getElementById("themeIcon");

// Load saved theme
const savedTheme = localStorage.getItem("theme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
  icon.textContent = savedTheme === "dark" ? "🌙" : "☀️";
}

toggleBtn.addEventListener("click", () => {
  const currentTheme =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";

  const newTheme = currentTheme === "dark" ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);

  icon.textContent = newTheme === "dark" ? "🌙" : "☀️";

  toggleBtn.classList.add("rotate");

  setTimeout(() => {
    toggleBtn.classList.remove("rotate");
  }, 400);
});
