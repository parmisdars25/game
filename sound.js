/**
 * موتور افکت‌های صوتی سبک (با Web Audio API بدون نیاز به فایل صوتی اضافه)
 * و موتور انیمیشن کاغذ رنگی (Confetti) برای لحظات برنده شدن و پایان بازی
 */

const STORAGE_MUTE_KEY = 'bekesh_sound_muted';

class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(STORAGE_MUTE_KEY) === 'true';
  }

  /**
   * فعال‌سازی AudioContext در اولین تعامل کاربر (الزامی در موبایل و iOS)
   */
  unlock() {
    if (this.muted) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  isMuted() {
    return this.muted;
  }

  setMuted(value) {
    this.muted = Boolean(value);
    localStorage.setItem(STORAGE_MUTE_KEY, String(this.muted));
  }

  toggleMute() {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.unlock();
      this.playClick();
    }
    return this.muted;
  }

  /**
   * پخش یک نت کوتاه سینت‌سایزری
   */
  _tone(freq, duration = 0.12, type = 'sine', volume = 0.14, delay = 0) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {
      // نادیده گرفتن خطاهای احتمالی مرورگر در حالت بی‌صدا
    }
  }

  playClick() {
    this._tone(520, 0.055, 'triangle', 0.08);
  }

  playJoin() {
    this._tone(440, 0.09, 'sine', 0.1, 0);
    this._tone(660, 0.12, 'sine', 0.1, 0.07);
  }

  playCountdown(step) {
    const freq = step <= 1 ? 740 : 520;
    this._tone(freq, 0.14, 'triangle', 0.14);
  }

  playGameStart() {
    this._tone(523.25, 0.12, 'triangle', 0.15, 0);
    this._tone(659.25, 0.12, 'triangle', 0.15, 0.1);
    this._tone(783.99, 0.12, 'triangle', 0.15, 0.2);
    this._tone(1046.5, 0.28, 'triangle', 0.18, 0.3);
  }

  playTurnStart() {
    this._tone(587.33, 0.1, 'sine', 0.12, 0);
    this._tone(880, 0.16, 'sine', 0.14, 0.09);
  }

  playCorrect() {
    this._tone(587.33, 0.1, 'triangle', 0.16, 0);
    this._tone(783.99, 0.11, 'triangle', 0.16, 0.08);
    this._tone(1174.66, 0.24, 'sine', 0.18, 0.16);
  }

  playClose() {
    this._tone(493.88, 0.09, 'sine', 0.12, 0);
    this._tone(554.37, 0.12, 'sine', 0.12, 0.09);
  }

  playTick(urgent = false) {
    this._tone(urgent ? 920 : 680, 0.045, 'square', urgent ? 0.075 : 0.045);
  }

  playRoundEnd() {
    this._tone(659.25, 0.14, 'triangle', 0.14, 0);
    this._tone(523.25, 0.14, 'triangle', 0.14, 0.12);
    this._tone(392.0, 0.26, 'triangle', 0.15, 0.24);
  }

  playGameOver() {
    const notes = [
      { f: 523.25, d: 0.14, t: 0.00 },
      { f: 659.25, d: 0.14, t: 0.12 },
      { f: 783.99, d: 0.14, t: 0.24 },
      { f: 1046.5, d: 0.18, t: 0.36 },
      { f: 783.99, d: 0.12, t: 0.54 },
      { f: 1046.5, d: 0.42, t: 0.66 },
    ];
    for (const n of notes) {
      this._tone(n.f, n.d, 'triangle', 0.18, n.t);
    }
  }
}

class ConfettiEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.rafId = null;
    this.colors = [
      '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B',
      '#EF4444', '#EC4899', '#8B5CF6', '#FACC15',
    ];
    this._waveTimers = [];
  }

  _ensureCanvas() {
    if (!this.canvas) {
      this.canvas = document.getElementById('confetti-canvas');
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
      }
    }
    if (!this.canvas || !this.ctx) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return true;
  }

  /**
   * پرتاب یک موج کاغذ رنگی سبک (مناسب حدس درست یا پایان بازی)
   */
  burst({ count = 75, originY = 0.25 } = {}) {
    if (!this._ensureCanvas()) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 8;
      this.particles.push({
        x: w * (0.2 + Math.random() * 0.6),
        y: h * originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4.5,
        size: 6 + Math.random() * 6,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 14,
        gravity: 0.19 + Math.random() * 0.08,
        drag: 0.985,
        alpha: 1,
        shape: Math.random() > 0.35 ? 'rect' : 'circle',
      });
    }

    if (!this.rafId) {
      this._loop();
    }
  }

  /**
   * جشن چندموجی مخصوص صفحه قهرمانی و پایان بازی
   */
  celebrate() {
    this.stop();
    this.burst({ count: 95, originY: 0.22 });
    this._waveTimers.push(setTimeout(() => this.burst({ count: 75, originY: 0.3 }), 450));
    this._waveTimers.push(setTimeout(() => this.burst({ count: 75, originY: 0.2 }), 950));
  }

  stop() {
    for (const id of this._waveTimers) clearTimeout(id);
    this._waveTimers = [];
    this.particles = [];
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  _loop() {
    if (!this._ensureCanvas()) {
      this.rafId = null;
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.clearRect(0, 0, w, h);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      if (p.y > h * 0.72) {
        p.alpha -= 0.025;
      }

      if (p.alpha <= 0 || p.y > h + 40) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate((p.rotation * Math.PI) / 180);
      this.ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        this.ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      } else {
        this.ctx.beginPath();
        this.ctx.arc(0, 0, p.size * 0.38, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    if (this.particles.length > 0) {
      this.rafId = requestAnimationFrame(() => this._loop());
    } else {
      this.rafId = null;
    }
  }
}

export const sound = new SoundManager();
export const confetti = new ConfettiEngine();
