/* =============================================================================
   Conversa campaign landing page — Alpine.js components
   Plain JS. No framework runtime. Loaded with <script defer>.

   Vendor (pinned, vendored under /public/vendor/):
     - Alpine.js  3.14.9  (jsdelivr: @3.14.9/dist/cdn.min.js)
     - Motion One 10.18.0 (jsdelivr: @10.18.0/dist/motion.min.js)

   Components registered on the `alpine:init` event:
     nav · chatDemo · tabs · cases · accordion · leadForm ·
     partnerCalc · partnerForm
   ============================================================================= */

/* -----------------------------------------------------------------------------
   ODOO_LEAD_ENDPOINT
   -----------------------------------------------------------------------------
   Public Odoo lead endpoint (Odoo 19 controller, JSON POST, CORS allowed from
   conversa-bot.github.io and conversa-bot.com). The hostname sits behind
   Cloudflare Access until it is opened; while unreachable every submit fails
   and the form falls back to a prefilled WhatsApp link so no lead is lost.
   --------------------------------------------------------------------------- */
const ODOO_LEAD_ENDPOINT = "https://erp.conversa-bot.com/conversa/lead";

/* -----------------------------------------------------------------------------
   ODOO_PARTNER_ENDPOINT
   -----------------------------------------------------------------------------
   Public Odoo partner-signup endpoint (same Odoo 19 controller family as the
   lead endpoint above, JSON POST). Used only by the partnerForm component on
   the partner landing page (/partner/). Same fallback contract: on any failure
   the form shows a prefilled WhatsApp link so no partner signup is lost.
   --------------------------------------------------------------------------- */
const ODOO_PARTNER_ENDPOINT = "https://erp.conversa-bot.com/conversa/partner";

const LEAD_SEND_TIMEOUT_MS = 8000;
const LEAD_FALLBACK_WA_NUMBER = "6281807177764";

const prefersReducedMotion = () =>
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -----------------------------------------------------------------------------
   nav — mobile menu
   --------------------------------------------------------------------------- */
function nav() {
  return {
    open: false,
    toggle() {
      this.open = !this.open;
    },
    close() {
      this.open = false;
    },
  };
}

/* -----------------------------------------------------------------------------
   chatDemo — animated, multi-scenario chat (clinic / retail / manufacturing /
   service desk / umroh travel / influencer). The scenarios (transcript,
   business name, channel, caption)
   live in a JSON <script> per page; this component only plays them.
   - scenario buttons switch the active scenario
   - bubbles appear in sequence with a typing indicator before bot replies
   - AUTO-ROTATION: after a transcript finishes, it waits ~2.5s and advances to
     the next scenario (loops). Manual selection stops auto for that moment but
     rotation resumes after the selected scenario completes. Paused while the
     hero is off-screen (IntersectionObserver) or the tab is hidden.
   - prefers-reduced-motion: full transcript shown instantly; scenarios rotate
     on a long interval (8s) with no message-by-message animation.
   - the chat box has a fixed height in the markup: switching never shifts layout
   --------------------------------------------------------------------------- */
const SCENARIO_ROTATE_PAUSE_MS = 2500;
const SCENARIO_ROTATE_REDUCED_MS = 8000;

function chatDemo() {
  return {
    scenarios: [],
    active: 0, // index of the active scenario
    activeScenario: null, // the active scenario object
    count: 0, // how many messages of the active scenario are visible
    typing: false, // show a typing indicator before the next bot bubble
    playing: false,
    played: false,
    reduced: false,
    _observer: null,
    _epoch: 0, // bumps on every (re)start; stale playback loops abort on it
    _rotateTimer: null, // pending advance-to-next-scenario timeout
    _inView: false,
    _docVisible: true,
    _autoSuppressed: false, // a manual selection paused auto-rotation temporarily

    get messages() {
      return this.activeScenario ? this.activeScenario.messages : [];
    },

    init() {
      // Scenarios are provided per-language via a JSON <script> in each page.
      const node = document.getElementById("chat-demo-data");
      if (node) {
        try {
          const data = JSON.parse(node.textContent);
          this.scenarios = Array.isArray(data) ? data : [];
        } catch (e) {
          this.scenarios = [];
        }
      }
      this.activeScenario =
        this.scenarios[0] || {
          id: "",
          channel: "",
          business: "",
          caption: "",
          messages: [],
        };

      this.reduced = prefersReducedMotion();

      document.addEventListener(
        "visibilitychange",
        () => {
          this._docVisible = document.visibilityState === "visible";
          this._updateRotation();
        },
        { passive: true }
      );

      if (this.reduced) {
        // Respect the user's setting: no animation, show everything now.
        this.count = this.messages.length;
        this.typing = false;
        this.played = true;
      }

      const root = this.$el;
      if ("IntersectionObserver" in window && root) {
        this._observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              this._inView = entry.isIntersecting;
              if (entry.isIntersecting && !this.played) {
                this.played = true;
                this._observer.disconnect();
                this.play();
              }
              this._updateRotation();
            });
          },
          { threshold: 0.35 }
        );
        this._observer.observe(root);
      } else {
        // No observer support: just play.
        this.played = true;
        this._inView = true;
        this.play();
      }
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const box = this.$refs.chatbox;
        if (box) box.scrollTop = box.scrollHeight;
      });
    },

    isScenarioActive(i) {
      return this.active === i;
    },

    // Switch scenario, reset the phone and replay the new transcript.
    // Manual selection: rotation resumes after this scenario finishes.
    selectScenario(i) {
      const next = this.scenarios[i];
      if (!next || i === this.active) return;
      this.active = i;
      this.activeScenario = next;
      this._autoSuppressed = true;
      this._clearRotateTimer();
      if (this.reduced) {
        // Reduced motion: swap to the full new transcript immediately.
        this.count = this.messages.length;
        this.typing = false;
        this._scheduleRotation();
        return;
      }
      this.restart();
    },

    focusScenario(i) {
      this.selectScenario(i);
      const el = document.getElementById("demo-tab-" + this.active);
      if (el) el.focus();
    },

    onScenarioKeydown(event) {
      const total = this.scenarios.length;
      if (!total) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.focusScenario((this.active + 1) % total);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.focusScenario((this.active - 1 + total) % total);
      }
    },

    restart() {
      // Invalidate any in-flight playback, then start fresh for the active
      // scenario. Used by scenario switching.
      this._epoch++;
      this.count = 0;
      this.typing = false;
      this.playing = false;
      // Reset the scroll position so the new transcript starts from the top.
      this.$nextTick(() => {
        const box = this.$refs.chatbox;
        if (box) box.scrollTop = 0;
        this.play();
      });
    },

    // Replay was removed from the UI (round-2 feedback). Scenario switching
    // still restarts playback via selectScenario() -> restart().
    /* --- Auto-rotation -------------------------------------------------- */

    _clearRotateTimer() {
      if (this._rotateTimer) {
        clearTimeout(this._rotateTimer);
        this._rotateTimer = null;
      }
    },

    // After the active transcript completes, schedule the next scenario.
    _scheduleRotation() {
      this._clearRotateTimer();
      if (this.scenarios.length < 2) return;
      const delay = this.reduced
        ? SCENARIO_ROTATE_REDUCED_MS
        : SCENARIO_ROTATE_PAUSE_MS;
      this._rotateTimer = setTimeout(() => {
        this._rotateTimer = null;
        if (!this._canRotate()) return;
        const next = (this.active + 1) % this.scenarios.length;
        this.active = next;
        this.activeScenario = this.scenarios[next];
        this._autoSuppressed = false;
        if (this.reduced) {
          this.count = this.messages.length;
          this.typing = false;
          this._scheduleRotation();
        } else {
          this.restart();
        }
      }, delay);
    },

    _canRotate() {
      return this._inView && this._docVisible && !document.hidden;
    },

    // Pause while off-screen or hidden; resume when both conditions clear.
    _updateRotation() {
      if (this._rotateTimer && !this._canRotate()) {
        this._clearRotateTimer();
        this._rotationPaused = true;
      }
      if (this._rotationPaused && this._canRotate() && this.played) {
        this._rotationPaused = false;
        this._scheduleRotation();
      }
      // First sight (e.g. reduced motion, where playback is instant).
      if (!this._rotateTimer && this.played && !this.playing && this._canRotate()) {
        this._scheduleRotation();
      }
    },

    async play() {
      this._epoch++;
      const epoch = this._epoch;
      this.playing = true;

      const msgs = this.messages;
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];

        // A bot reply is preceded by a short typing indicator.
        if (msg.from === "bot") {
          this.typing = true;
          await sleep(750);
          if (epoch !== this._epoch) return; // a newer playback took over
          if (this.reduced) {
            this.count = this.messages.length;
            this.typing = false;
            this.playing = false;
            return;
          }
          this.typing = false;
        }

        if (epoch !== this._epoch) return; // a newer playback took over
        this.count = i + 1;
        // Keep the newest bubble in view as the transcript grows.
        if (!this.reduced) this.scrollToBottom();
        await sleep(msg.from === "bot" ? 650 : 500);
        if (epoch !== this._epoch) return;
      }

      this.typing = false;
      this.playing = false;
      // Transcript finished: schedule the next scenario (auto-rotation).
      this._scheduleRotation();
    },

    visible() {
      return this.messages.slice(0, this.count);
    },
  };
}

/* -----------------------------------------------------------------------------
   tabs — capability tabs (Answers / Moves leads / Books meetings / Grows sales)
   ArrowLeft / ArrowRight cycle the active tab and move focus to its button.
   --------------------------------------------------------------------------- */
function tabs(initial = 0, total = 4) {
  return {
    active: initial,
    total,
    select(index) {
      this.active = (index + this.total) % this.total;
    },
    focusTab(index) {
      this.select(index);
      const el = document.getElementById("cap-tab-" + this.active);
      if (el) el.focus();
    },
    onKeydown(event) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.focusTab(this.active + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.focusTab(this.active - 1);
      }
    },
    isActive(index) {
      return this.active === index;
    },
  };
}

/* -----------------------------------------------------------------------------
   cases — worked examples (case-studies section), three tabs.
   Same Alpine tab approach as `tabs`: click a tab to make it active, or use
   ArrowLeft / ArrowRight. There is no animation — active state is a class
   toggle only — so prefers-reduced-motion is respected by construction.
   --------------------------------------------------------------------------- */
function cases(initial = 0, total = 3) {
  return {
    active: initial,
    total,
    select(index) {
      this.active = (index + this.total) % this.total;
    },
    focusTab(index) {
      this.select(index);
      const el = document.getElementById("case-tab-" + this.active);
      if (el) el.focus();
    },
    onKeydown(event) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.focusTab(this.active + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.focusTab(this.active - 1);
      }
    },
    isActive(index) {
      return this.active === index;
    },
  };
}

/* -----------------------------------------------------------------------------
   accordion — FAQ, single item open at a time
   --------------------------------------------------------------------------- */
function accordion() {
  return {
    open: null,
    toggle(index) {
      this.open = this.open === index ? null : index;
    },
    isOpen(index) {
      return this.open === index;
    },
  };
}

/* -----------------------------------------------------------------------------
   leadForm — Name + WhatsApp validation, in-page success state,
   POSTs JSON to ODOO_LEAD_ENDPOINT with an 8s AbortController timeout.
   On any failure (network error, timeout, non-2xx) the form still shows the
   success state and adds a WhatsApp fallback link prefilled with the lead
   content, so the lead is never lost.
   --------------------------------------------------------------------------- */
function leadForm() {
  return {
    name: "",
    whatsapp: "",
    businessType: "",
    message: "",
    submitted: false,
    sending: false,
    fallbackUrl: "",
    errors: {},

    validate() {
      const errors = {};
      if (!this.name.trim()) {
        errors.name = true;
      }
      const wa = this.whatsapp.trim();
      // Must contain a usable number (digits), allow +, spaces and dashes.
      if (!wa || !/^[+]?[\d\s-]{6,}$/.test(wa) || (wa.match(/\d/g) || []).length < 6) {
        errors.whatsapp = true;
      }
      this.errors = errors;
      return Object.keys(errors).length === 0;
    },

    pageLang() {
      const lang = (document.documentElement.lang || "").toLowerCase();
      if (lang) return lang;
      return location.pathname.indexOf("/en") === 0 ? "en" : "id";
    },

    buildFallbackUrl() {
      const name = this.name.trim();
      const phone = this.whatsapp.trim();
      const msg = this.message.trim();
      const text =
        this.pageLang() === "en"
          ? `Hi Conversa, I'm ${name}, ${phone}.` + (msg ? ` ${msg}` : "")
          : `Halo Conversa, saya ${name}, ${phone}.` + (msg ? ` ${msg}` : "");
      return `https://wa.me/${LEAD_FALLBACK_WA_NUMBER}?text=${encodeURIComponent(text)}`;
    },

    async submit() {
      if (!this.validate()) return;

      this.sending = true;
      this.fallbackUrl = "";

      const payload = {
        name: this.name.trim(),
        phone: this.whatsapp.trim(),
        whatsapp: this.whatsapp.trim(),
        email: null,
        message: this.message.trim() || null,
        business_type: this.businessType || null,
        source: "campaign-landing",
        page_lang: this.pageLang(),
        page_url: window.location.href,
      };

      let sent = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LEAD_SEND_TIMEOUT_MS);
        const res = await fetch(ODOO_LEAD_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        sent = res.ok; // only treat 2xx as success
      } catch (e) {
        sent = false; // network error, CORS block or 8s timeout
      }

      this.sending = false;

      if (!sent) {
        // Endpoint unreachable: hand the lead to WhatsApp so nothing is lost.
        this.fallbackUrl = this.buildFallbackUrl();
      }

      this.submitted = true;
      // Move focus to the success heading for screen-reader / keyboard users.
      this.$nextTick(() => {
        if (this.$refs.successTitle) this.$refs.successTitle.focus();
      });
    },

    reset() {
      this.name = "";
      this.whatsapp = "";
      this.businessType = "";
      this.message = "";
      this.errors = {};
      this.submitted = false;
      this.sending = false;
      this.fallbackUrl = "";
    },
  };
}

/* -----------------------------------------------------------------------------
   partnerCalc — partner commission calculator (pure client side, no network).
   Counts of Starter / Growth / Pro clients map to the official monthly prices
   (Starter Rp399.000, Growth Rp1.199.000, Pro Rp3.299.000); the commission is
   10% of the monthly payment. Shows commission per month and per 3 months
   (matching the quarterly withdrawal schedule), formatted as Rupiah.
   --------------------------------------------------------------------------- */
const PARTNER_COMMISSION_RATE = 0.1;
const PARTNER_PRICES = {
  starter: 399000,
  growth: 1199000,
  pro: 3299000,
};

function partnerCalc() {
  return {
    starter: 0,
    growth: 1,
    pro: 0,
    rp(value) {
      return (
        "Rp" +
        new Intl.NumberFormat("id-ID").format(Math.round(value))
      );
    },
    get monthly() {
      return (
        this.starter * PARTNER_PRICES.starter +
        this.growth * PARTNER_PRICES.growth +
        this.pro * PARTNER_PRICES.pro
      ) * PARTNER_COMMISSION_RATE;
    },
    get quarterly() {
      return this.monthly * 3;
    },
  };
}

/* -----------------------------------------------------------------------------
   partnerForm — partner signup form on /partner/. Same validation, timeout and
   in-page success state as leadForm, but POSTs JSON to ODOO_PARTNER_ENDPOINT
   with partner_type in the payload and source "partner-landing".
   --------------------------------------------------------------------------- */
function partnerForm() {
  return {
    name: "",
    whatsapp: "",
    email: "",
    partnerType: "",
    message: "",
    submitted: false,
    sending: false,
    fallbackUrl: "",
    errors: {},

    validate() {
      const errors = {};
      if (!this.name.trim()) {
        errors.name = true;
      }
      const wa = this.whatsapp.trim();
      // Must contain a usable number (digits), allow +, spaces and dashes.
      if (!wa || !/^[+]?[\d\s-]{6,}$/.test(wa) || (wa.match(/\d/g) || []).length < 6) {
        errors.whatsapp = true;
      }
      this.errors = errors;
      return Object.keys(errors).length === 0;
    },

    pageLang() {
      const lang = (document.documentElement.lang || "").toLowerCase();
      if (lang) return lang;
      return location.pathname.indexOf("/en") === 0 ? "en" : "id";
    },

    buildFallbackUrl() {
      const name = this.name.trim();
      const phone = this.whatsapp.trim();
      const msg = this.message.trim();
      const text =
        `Halo Conversa, saya ${name} (${phone}), ingin mendaftar jadi mitra pemasaran.` +
        (msg ? ` ${msg}` : "");
      return `https://wa.me/${LEAD_FALLBACK_WA_NUMBER}?text=${encodeURIComponent(text)}`;
    },

    async submit() {
      if (!this.validate()) return;

      this.sending = true;
      this.fallbackUrl = "";

      const payload = {
        name: this.name.trim(),
        phone: this.whatsapp.trim(),
        whatsapp: this.whatsapp.trim(),
        email: this.email.trim() || null,
        partner_type: this.partnerType || null,
        message: this.message.trim() || null,
        source: "partner-landing",
        page_lang: this.pageLang(),
        page_url: window.location.href,
      };

      let sent = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LEAD_SEND_TIMEOUT_MS);
        const res = await fetch(ODOO_PARTNER_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        sent = res.ok; // only treat 2xx as success
      } catch (e) {
        sent = false; // network error, CORS block or 8s timeout
      }

      this.sending = false;

      if (!sent) {
        // Endpoint unreachable: hand the signup to WhatsApp so nothing is lost.
        this.fallbackUrl = this.buildFallbackUrl();
      }

      this.submitted = true;
      // Move focus to the success heading for screen-reader / keyboard users.
      this.$nextTick(() => {
        if (this.$refs.successTitle) this.$refs.successTitle.focus();
      });
    },

    reset() {
      this.name = "";
      this.whatsapp = "";
      this.email = "";
      this.partnerType = "";
      this.message = "";
      this.errors = {};
      this.submitted = false;
      this.sending = false;
      this.fallbackUrl = "";
    },
  };
}

/* Register on alpine:init (Alpine is loaded after this file, with defer). */
document.addEventListener("alpine:init", () => {
  window.Alpine.data("nav", nav);
  window.Alpine.data("chatDemo", chatDemo);
  window.Alpine.data("tabs", tabs);
  window.Alpine.data("cases", cases);
  window.Alpine.data("accordion", accordion);
  window.Alpine.data("leadForm", leadForm);
  window.Alpine.data("partnerCalc", partnerCalc);
  window.Alpine.data("partnerForm", partnerForm);
});
