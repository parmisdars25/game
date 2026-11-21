/**
 * موتور بوم نقاشی زنده (Canvas Engine - نسخه ۲)
 * - ابعاد منطقی دقیق 4:3 (800x600) هماهنگ با کادر نمایش برای جلوگیری از هرگونه کشیدگی
 *   و تضمین ضخامت کاملاً یکسان در خطوط افقی و عمودی (رفع کامل حالت قلم خوشنویسی)
 * - تطبیق خودکار سایز نمایشی با ResizeObserver به عنوان پشتیبان برای همه مرورگرهای موبایل
 * - مختصات نسبی (۰ تا ۱)، نرم‌سازی بزیه، سطل رنگ سریع، Undo و همگام‌سازی زنده
 */

import { GAME_CONFIG } from './config.js';

const CANVAS_W = 800;
const CANVAS_H = 600; // نسبت دقیق 4:3
const ASPECT_RATIO = CANVAS_W / CANVAS_H;
const BG_COLOR = '#FFFFFF';
const STREAM_INTERVAL_MS = 45;
const MAX_HISTORY_ACTIONS = 200;

export class DrawingCanvas {
  constructor(canvasEl, { onEmit } = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.onEmit = typeof onEmit === 'function' ? onEmit : () => {};

    // تنظیم ابعاد داخلی ثابت بوم روی نسبت دقیق ۴:۳
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;

    this.interactive = false;
    this.tool = 'pen'; // 'pen' | 'eraser' | 'bucket'
    this.color = GAME_CONFIG.PALETTE[0].hex;
    this.sizeRatio = GAME_CONFIG.BRUSH_SIZES[1].ratio;

    this.isDrawing = false;
    this.activePointerId = null;
    this.currentStroke = null;
    this.pendingPoints = [];
    this.lastStreamTime = 0;

    this.history = [];
    this.remoteStrokes = new Map();

    this._bindEvents();
    this._setupAspectLock();
    this._fillWhite();
  }

  /**
   * قفل دقیق نسبت 4:3 روی ابعاد نمایشی (CSS px) در تمام گوشی‌ها و مرورگرها
   * باعث می‌شود پیکسل‌های افقی و عمودی همیشه دقیقاً مربعی بمانند
   */
  _setupAspectLock() {
    const parent = this.canvas.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.fitToStage());
      this._resizeObserver.observe(parent);
    }
    window.addEventListener('resize', () => this.fitToStage());
    this.fitToStage();
  }

  fitToStage() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    if (pw <= 0 || ph <= 0) return;

    let displayW = pw;
    let displayH = displayW / ASPECT_RATIO;

    if (displayH > ph) {
      displayH = ph;
      displayW = displayH * ASPECT_RATIO;
    }

    this.canvas.style.width = `${Math.floor(displayW)}px`;
    this.canvas.style.height = `${Math.floor(displayH)}px`;
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this._handlePointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._handlePointerMove(e));
    window.addEventListener('pointerup', (e) => this._handlePointerUp(e));
    window.addEventListener('pointercancel', (e) => this._handlePointerUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setInteractive(enabled) {
    this.interactive = Boolean(enabled);
    this.canvas.classList.toggle('readonly', !this.interactive);
    if (!this.interactive && this.isDrawing) {
      this._finishLocalStroke();
    }
  }

  setTool(tool) {
    if (['pen', 'eraser', 'bucket'].includes(tool)) {
      this.tool = tool;
    }
  }

  setColor(hex) {
    this.color = hex;
    if (this.tool === 'eraser') {
      this.tool = 'pen';
    }
  }

  setSizeRatio(ratio) {
    this.sizeRatio = ratio;
  }

  _getNormalizedPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return [0, 0];
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  }

  _handlePointerDown(e) {
    if (!this.interactive) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();
    const pt = this._getNormalizedPoint(e);

    if (this.tool === 'bucket') {
      const action = {
        id: this._makeActionId(),
        type: 'fill',
        x: pt[0],
        y: pt[1],
        color: this.color,
      };
      this._applyFill(action.x, action.y, action.color);
      this._pushHistory(action);
      this.onEmit({ type: 'fill', action });
      return;
    }

    this.isDrawing = true;
    this.activePointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const strokeColor = this.tool === 'eraser' ? BG_COLOR : this.color;
    const strokeRatio = this.tool === 'eraser' ? this.sizeRatio * 1.45 : this.sizeRatio;

    this.currentStroke = {
      id: this._makeActionId(),
      type: 'stroke',
      color: strokeColor,
      sizeRatio: strokeRatio,
      points: [pt],
    };
    this.pendingPoints = [pt];
    this.lastStreamTime = performance.now();

    this._drawDot(pt, strokeColor, strokeRatio);

    this.onEmit({
      type: 'stroke_chunk',
      id: this.currentStroke.id,
      color: strokeColor,
      sizeRatio: strokeRatio,
      points: [pt],
      isStart: true,
    });
  }

  _handlePointerMove(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    e.preventDefault();
    const pt = this._getNormalizedPoint(e);
    const pts = this.currentStroke.points;
    const prev = pts[pts.length - 1];

    const dx = (pt[0] - prev[0]) * CANVAS_W;
    const dy = (pt[1] - prev[1]) * CANVAS_H;
    if (dx * dx + dy * dy < 3.5) return;

    pts.push(pt);
    this.pendingPoints.push(pt);

    this._drawLatestSegment(pts, this.currentStroke.color, this.currentStroke.sizeRatio);

    const now = performance.now();
    if (now - this.lastStreamTime >= STREAM_INTERVAL_MS || this.pendingPoints.length >= 6) {
      this._flushPendingPoints();
    }
  }

  _handlePointerUp(e) {
    if (!this.isDrawing) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    this._finishLocalStroke();
  }

  _flushPendingPoints() {
    if (!this.currentStroke || this.pendingPoints.length === 0) return;
    this.onEmit({
      type: 'stroke_chunk',
      id: this.currentStroke.id,
      color: this.currentStroke.color,
      sizeRatio: this.currentStroke.sizeRatio,
      points: this.pendingPoints,
      isStart: false,
    });
    this.pendingPoints = [];
    this.lastStreamTime = performance.now();
  }

  _finishLocalStroke() {
    if (!this.currentStroke) {
      this.isDrawing = false;
      this.activePointerId = null;
      return;
    }

    this._flushPendingPoints();
    const finished = this.currentStroke;
    this._pushHistory(finished);

    this.onEmit({
      type: 'stroke_end',
      id: finished.id,
    });

    this.currentStroke = null;
    this.pendingPoints = [];
    this.isDrawing = false;
    this.activePointerId = null;
  }

  undo(broadcast = true) {
    if (this.history.length === 0) return false;
    const removed = this.history.pop();
    this._redrawAll();
    if (broadcast) {
      this.onEmit({ type: 'undo', actionId: removed.id });
    }
    return true;
  }

  clear(broadcast = true) {
    this.history = [];
    this.remoteStrokes.clear();
    this.currentStroke = null;
    this.pendingPoints = [];
    this.isDrawing = false;
    this._fillWhite();
    if (broadcast) {
      this.onEmit({ type: 'clear' });
    }
  }

  getHistory() {
    return this.history;
  }

  loadHistory(actions = []) {
    if (!Array.isArray(actions)) return;
    this.history = actions.slice(-MAX_HISTORY_ACTIONS);
    this.remoteStrokes.clear();
    this._redrawAll();
  }

  applyRemoteEvent(event) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'stroke_chunk': {
        let stroke = this.remoteStrokes.get(event.id);
        if (!stroke || event.isStart) {
          stroke = {
            id: event.id,
            type: 'stroke',
            color: event.color,
            sizeRatio: event.sizeRatio,
            points: [],
          };
          this.remoteStrokes.set(event.id, stroke);
        }

        const incoming = Array.isArray(event.points) ? event.points : [];
        for (const pt of incoming) {
          stroke.points.push(pt);
          if (stroke.points.length === 1) {
            this._drawDot(pt, stroke.color, stroke.sizeRatio);
          } else {
            this._drawLatestSegment(stroke.points, stroke.color, stroke.sizeRatio);
          }
        }
        break;
      }

      case 'stroke_end': {
        const stroke = this.remoteStrokes.get(event.id);
        if (stroke) {
          this.remoteStrokes.delete(event.id);
          this._pushHistory(stroke);
        }
        break;
      }

      case 'fill': {
        const action = event.action;
        if (!action) return;
        this._applyFill(action.x, action.y, action.color);
        this._pushHistory(action);
        break;
      }

      case 'undo': {
        if (event.actionId) {
          const idx = this.history.findIndex((a) => a.id === event.actionId);
          if (idx !== -1) {
            this.history.splice(idx, 1);
          } else if (this.history.length > 0) {
            this.history.pop();
          }
        } else if (this.history.length > 0) {
          this.history.pop();
        }
        this._redrawAll();
        break;
      }

      case 'clear': {
        this.clear(false);
        break;
      }

      case 'sync_state': {
        this.loadHistory(event.history || []);
        break;
      }

      default:
        break;
    }
  }

  _pushHistory(action) {
    this.history.push(action);
    if (this.history.length > MAX_HISTORY_ACTIONS) {
      this.history.shift();
    }
  }

  _makeActionId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  _fillWhite() {
    this.ctx.save();
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    this.ctx.restore();
  }

  _drawDot(pt, color, sizeRatio) {
    const x = pt[0] * CANVAS_W;
    const y = pt[1] * CANVAS_H;
    const radius = Math.max(1.5, (sizeRatio * CANVAS_W) / 2);

    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  _drawLatestSegment(points, color, sizeRatio) {
    const len = points.length;
    if (len < 2) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, sizeRatio * CANVAS_W);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    if (len === 2) {
      ctx.moveTo(points[0][0] * CANVAS_W, points[0][1] * CANVAS_H);
      ctx.lineTo(points[1][0] * CANVAS_W, points[1][1] * CANVAS_H);
    } else {
      const p0 = points[len - 3];
      const p1 = points[len - 2];
      const p2 = points[len - 1];
      const mid1x = ((p0[0] + p1[0]) / 2) * CANVAS_W;
      const mid1y = ((p0[1] + p1[1]) / 2) * CANVAS_H;
      const mid2x = ((p1[0] + p2[0]) / 2) * CANVAS_W;
      const mid2y = ((p1[1] + p2[1]) / 2) * CANVAS_H;

      ctx.moveTo(mid1x, mid1y);
      ctx.quadraticCurveTo(p1[0] * CANVAS_W, p1[1] * CANVAS_H, mid2x, mid2y);
    }

    ctx.stroke();
    ctx.restore();
  }

  _drawFullStroke(stroke) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;

    if (pts.length === 1) {
      this._drawDot(pts[0], stroke.color, stroke.sizeRatio);
      return;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(2, stroke.sizeRatio * CANVAS_W);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * CANVAS_W, pts[0][1] * CANVAS_H);

    for (let i = 1; i < pts.length - 1; i++) {
      const midX = ((pts[i][0] + pts[i + 1][0]) / 2) * CANVAS_W;
      const midY = ((pts[i][1] + pts[i + 1][1]) / 2) * CANVAS_H;
      ctx.quadraticCurveTo(pts[i][0] * CANVAS_W, pts[i][1] * CANVAS_H, midX, midY);
    }

    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * CANVAS_W, last[1] * CANVAS_H);
    ctx.stroke();
    ctx.restore();
  }

  _redrawAll() {
    this._fillWhite();
    for (const action of this.history) {
      if (action.type === 'stroke') {
        this._drawFullStroke(action);
      } else if (action.type === 'fill') {
        this._applyFill(action.x, action.y, action.color);
      }
    }
  }

  _applyFill(normX, normY, hexColor) {
    const startX = Math.max(0, Math.min(CANVAS_W - 1, Math.floor(normX * CANVAS_W)));
    const startY = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(normY * CANVAS_H)));

    const fillRgb = this._hexToRgb(hexColor);
    const imageData = this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = imageData.data;

    const startOffset = (startY * CANVAS_W + startX) * 4;
    const targetR = data[startOffset];
    const targetG = data[startOffset + 1];
    const targetB = data[startOffset + 2];

    if (
      Math.abs(targetR - fillRgb[0]) < 8 &&
      Math.abs(targetG - fillRgb[1]) < 8 &&
      Math.abs(targetB - fillRgb[2]) < 8
    ) {
      return;
    }

    const tolerance = 38;
    const visited = new Uint8Array(CANVAS_W * CANVAS_H);
    const stack = [startX, startY];

    const matchesTarget = (idx) => {
      const off = idx * 4;
      return (
        Math.abs(data[off] - targetR) <= tolerance &&
        Math.abs(data[off + 1] - targetG) <= tolerance &&
        Math.abs(data[off + 2] - targetB) <= tolerance
      );
    };

    const setPixel = (idx) => {
      const off = idx * 4;
      data[off] = fillRgb[0];
      data[off + 1] = fillRgb[1];
      data[off + 2] = fillRgb[2];
      data[off + 3] = 255;
      visited[idx] = 1;
    };

    while (stack.length > 0) {
      const y = stack.pop();
      let x = stack.pop();

      const rowStart = y * CANVAS_W;
      let idx = rowStart + x;
      if (visited[idx] || !matchesTarget(idx)) continue;

      while (x > 0 && !visited[rowStart + x - 1] && matchesTarget(rowStart + x - 1)) {
        x--;
      }

      let spanAbove = false;
      let spanBelow = false;

      while (x < CANVAS_W) {
        idx = rowStart + x;
        if (visited[idx] || !matchesTarget(idx)) break;

        setPixel(idx);

        if (y > 0) {
          const upIdx = idx - CANVAS_W;
          const upMatch = !visited[upIdx] && matchesTarget(upIdx);
          if (!spanAbove && upMatch) {
            stack.push(x, y - 1);
            spanAbove = true;
          } else if (spanAbove && !upMatch) {
            spanAbove = false;
          }
        }

        if (y < CANVAS_H - 1) {
          const downIdx = idx + CANVAS_W;
          const downMatch = !visited[downIdx] && matchesTarget(downIdx);
          if (!spanBelow && downMatch) {
            stack.push(x, y + 1);
            spanBelow = true;
          } else if (spanBelow && !downMatch) {
            spanBelow = false;
          }
        }

        x++;
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  _hexToRgb(hex) {
    const clean = String(hex || '#000000').replace('#', '');
    const num = parseInt(
      clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean,
      16
    );
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
}
