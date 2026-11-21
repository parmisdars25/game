/**
 * کنترلر اصلی بازی چندنفره «بکش و بگو!» — نسخه ۲
 * بهینه‌شده برای موبایل، وب‌اپ قابل نصب (PWA)، لحن صمیمی و ظاهر مینیمال
 */

import { GAME_CONFIG } from './config.js';
import { pickWordChoices, findCategoryForWord } from './words.js';
import {
  toPersianDigits,
  escapeHtml,
  evaluateGuess,
  containsTargetWord,
  getWordStructure,
  calculateGuesserPoints,
  calculateDrawerPoints,
  generatePlayerId,
  shuffleArray,
  copyToClipboard,
} from './utils.js';
import { sound, confetti } from './sound.js';
import { DrawingCanvas } from './canvas.js';
import { network } from './network.js';

const STORAGE_PROFILE_KEY = 'bekesh_profile';
const SESSION_ROOM_KEY = 'bekesh_active_session';
const PWA_DISMISS_KEY = 'bekesh_pwa_dismissed_at';
const PWA_DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت

// آیکون‌های برداری (SVG) تمیز برای دکمه صدا
const ICON_SOUND_ON =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const ICON_SOUND_OFF =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

// وضعیت مرکزی برنامه
const state = {
  myId: null,
  myName: '',
  myAvatar: GAME_CONFIG.AVATARS[0],
  room: null,
  players: [],
  messages: [],
  localNotices: [],
  onlineIds: new Set(),

  lastStatus: null,
  lastTurnKey: null,
  lastCountdownTick: null,
  lastTimerSec: null,
  roundStartedAtMs: 0,

  hostBusy: false,
  disconnectTimers: new Map(),

  // وضعیت نصب PWA
  deferredInstallPrompt: null,
};

let canvasEngine = null;
let mainTickInterval = null;
let modalResolver = null;

// ============================================================================
// ارجاع به عناصر DOM
// ============================================================================
const $ = (id) => document.getElementById(id);

const els = {
  views: {
    home: $('view-home'),
    lobby: $('view-lobby'),
    game: $('view-game'),
    gameover: $('view-gameover'),
  },
  toastContainer: $('toast-container'),
  soundButtons: () => document.querySelectorAll('.btn-sound-toggle'),

  // پنجره نصب وب‌اپ (PWA)
  pwaModal: $('pwa-install-modal'),
  pwaIosGuide: $('pwa-ios-guide'),
  pwaFallbackGuide: $('pwa-fallback-guide'),
  btnPwaInstall: $('btn-pwa-install'),
  btnPwaDismiss: $('btn-pwa-dismiss'),
  btnOpenPwaPrompt: $('btn-open-pwa-prompt'),

  // صفحه اصلی
  inviteBanner: $('home-invite-banner'),
  inviteCodeText: $('invite-room-code-text'),
  inputPlayerName: $('input-player-name'),
  avatarPicker: $('avatar-picker'),
  homeError: $('home-error'),
  btnCreateRoom: $('btn-create-room'),
  inputRoomCode: $('input-room-code'),
  btnJoinRoom: $('btn-join-room'),

  // لابی
  lobbyRoomCode: $('lobby-room-code'),
  btnCopyCode: $('btn-copy-code'),
  btnCopyLink: $('btn-copy-link'),
  btnLeaveLobby: $('btn-leave-lobby'),
  lobbyPlayerCount: $('lobby-player-count'),
  lobbyPlayersList: $('lobby-players-list'),
  lobbyHostPill: $('lobby-host-pill'),
  lobbySettingsHint: $('lobby-settings-hint'),
  settingMode: $('setting-mode'),
  settingTargetLabel: $('setting-target-label'),
  settingTarget: $('setting-target'),
  settingTime: $('setting-time'),
  settingCategories: $('setting-categories'),
  lobbyStatusText: $('lobby-status-text'),
  btnToggleReady: $('btn-toggle-ready'),
  btnStartGame: $('btn-start-game'),

  // شمارش معکوس
  overlayCountdown: $('overlay-countdown'),
  countdownLabel: $('countdown-label'),
  countdownNumber: $('countdown-number'),

  // اتاق بازی
  gameRoundBadge: $('game-round-badge'),
  gameDrawerBadge: $('game-drawer-badge'),
  gameWordDisplay: $('game-word-display'),
  gameWordMeta: $('game-word-meta'),
  gameTimer: $('game-timer'),
  timerAccelBadge: $('timer-accel-badge'),
  gameTimerValue: $('game-timer-value'),
  btnEndGame: $('btn-end-game'),
  btnLeaveGame: $('btn-leave-game'),
  gamePlayersList: $('game-players-list'),

  drawCanvas: $('draw-canvas'),
  canvasOverlayStatus: $('canvas-overlay-status'),
  canvasStatusAvatar: $('canvas-status-avatar'),
  canvasStatusText: $('canvas-status-text'),
  overlayWordChoice: $('overlay-word-choice'),
  wordChoiceTimer: $('word-choice-timer'),
  wordChoiceButtons: $('word-choice-buttons'),
  overlayRoundEnd: $('overlay-round-end'),
  roundEndReason: $('round-end-reason'),
  roundEndWord: $('round-end-word'),
  roundEndScores: $('round-end-scores'),
  roundEndNextTimer: $('round-end-next-timer'),

  // ابزار نقاشی
  drawerToolbar: $('drawer-toolbar'),
  colorPalette: $('color-palette'),
  toolPen: $('tool-pen'),
  toolBucket: $('tool-bucket'),
  toolEraser: $('tool-eraser'),
  brushSizes: $('brush-sizes'),
  btnUndo: $('btn-undo'),
  btnClear: $('btn-clear'),
  btnSkipTurn: $('btn-skip-turn'),

  // چت
  chatModeIndicator: $('chat-mode-indicator'),
  chatMessages: $('chat-messages'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  btnSendChat: $('btn-send-chat'),

  // پایان بازی
  gameoverSubtitle: $('gameover-subtitle'),
  podiumContainer: $('podium-container'),
  finalLeaderboard: $('final-leaderboard'),
  btnPlayAgain: $('btn-play-again'),
  gameoverWaitHost: $('gameover-wait-host'),
  btnGameoverHome: $('btn-gameover-home'),

  // مودال تایید
  modalConfirm: $('modal-confirm'),
  modalConfirmTitle: $('modal-confirm-title'),
  modalConfirmMessage: $('modal-confirm-message'),
  modalConfirmCancel: $('modal-confirm-cancel'),
  modalConfirmOk: $('modal-confirm-ok'),
};

// ============================================================================
// راه‌اندازی اولیه برنامه و PWA
// ============================================================================
function init() {
  loadSavedProfile();
  buildAvatarPicker();
  buildDrawingToolbar();
  buildCategoryChips();
  setupViewportFix();
  bindUIEvents();
  updateSoundIcons();
  checkInviteLink();
  setupPWAInstall();

  canvasEngine = new DrawingCanvas(els.drawCanvas, {
    onEmit: (payload) => {
      if (isMeDrawer() && state.room?.status === 'playing') {
        network.sendDrawEvent(payload);
      }
    },
  });

  // فعال‌سازی صدا در اولین تعامل کاربر
  const unlockOnce = () => {
    sound.unlock();
    window.removeEventListener('pointerdown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce, { passive: true });

  mainTickInterval = setInterval(onClockTick, 250);
  tryAutoReconnect();
}

// ============================================================================
// سیستم هوشمند نصب وب‌اپ روی گوشی (PWA برای اندروید و آیفون)
// ============================================================================
function isStandalonePWA() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOSDevice() {
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function setupPWAInstall() {
  // ثبت Service Worker سبک برای فعال‌سازی نصب در اندروید و Netlify
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // اگر کاربر همین الان از روی اپلیکیشن نصب‌شده وارد شده، هیچ پیشنهادی نده
  if (isStandalonePWA()) {
    els.btnOpenPwaPrompt.classList.add('hidden');
    return;
  }

  // نمایش آیکون کوچک نصب در گوشه صفحه اول برای دسترسی همیشگی
  els.btnOpenPwaPrompt.classList.remove('hidden');

  // دریافت رویداد نصب خودکار در اندروید / کروم
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    // اگر پنجره نصب همین الان باز است، فوراً دکمه نصب تک‌کلیکی را فعال کن
    if (!els.pwaModal.classList.contains('hidden')) {
      syncPwaModalMode();
    }
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    closePwaModal(false);
    els.btnOpenPwaPrompt.classList.add('hidden');
    showToast('بازی با موفقیت روی گوشیت نصب شد!', 'success');
  });

  // رویدادهای دکمه‌های پنجره نصب
  els.btnOpenPwaPrompt.addEventListener('click', () => {
    sound.playClick();
    openPwaModal();
  });

  els.btnPwaInstall.addEventListener('click', async () => {
    sound.playClick();
    if (!state.deferredInstallPrompt) {
      syncPwaModalMode();
      return;
    }
    try {
      state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        closePwaModal(false);
      } else {
        closePwaModal(true);
      }
    } catch {
      closePwaModal(true);
    }
  });

  els.btnPwaDismiss.addEventListener('click', () => {
    sound.playClick();
    closePwaModal(true);
  });

  els.pwaModal.addEventListener('click', (e) => {
    if (e.target === els.pwaModal) closePwaModal(true);
  });

  // نمایش خودکار پیشنهاد نصب در بدو ورود (اگر اخیراً رد نشده و داخل بازی فعال نیست)
  let dismissedAt = 0;
  try {
    dismissedAt = Number(localStorage.getItem(PWA_DISMISS_KEY) || 0);
  } catch {
    dismissedAt = 0;
  }
  const recentlyDismissed = dismissedAt > 0 && Date.now() - dismissedAt < PWA_DISMISS_COOLDOWN_MS;

  if (!recentlyDismissed) {
    setTimeout(() => {
      if (!state.room && !isStandalonePWA()) {
        openPwaModal();
      }
    }, 650);
  }
}

function syncPwaModalMode() {
  const ios = isIOSDevice();
  const hasNativePrompt = Boolean(state.deferredInstallPrompt);

  if (hasNativePrompt) {
    els.btnPwaInstall.classList.remove('hidden');
    els.pwaIosGuide.classList.add('hidden');
    els.pwaFallbackGuide.classList.add('hidden');
    els.btnPwaDismiss.textContent = 'فعلاً نه، بذار بازی کنم';
  } else if (ios) {
    els.btnPwaInstall.classList.add('hidden');
    els.pwaIosGuide.classList.remove('hidden');
    els.pwaFallbackGuide.classList.add('hidden');
    els.btnPwaDismiss.textContent = 'باشه، بریم بازی';
  } else {
    els.btnPwaInstall.classList.add('hidden');
    els.pwaIosGuide.classList.add('hidden');
    els.pwaFallbackGuide.classList.remove('hidden');
    els.btnPwaDismiss.textContent = 'باشه، بریم بازی';
  }
}

function openPwaModal() {
  syncPwaModalMode();
  els.pwaModal.classList.remove('hidden');
}

function closePwaModal(saveDismiss = true) {
  els.pwaModal.classList.add('hidden');
  if (saveDismiss) {
    try {
      localStorage.setItem(PWA_DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// پروفایل، نشست و تنظیمات موبایل
// ============================================================================
function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.name) state.myName = String(saved.name).slice(0, 16);
      if (saved.avatar && GAME_CONFIG.AVATARS.includes(saved.avatar)) {
        state.myAvatar = saved.avatar;
      }
    }
  } catch {
    // ignore
  }
  els.inputPlayerName.value = state.myName;
}

function saveProfile() {
  try {
    localStorage.setItem(
      STORAGE_PROFILE_KEY,
      JSON.stringify({ name: state.myName, avatar: state.myAvatar })
    );
  } catch {
    // ignore
  }
}

function saveActiveSession(roomCode, playerId) {
  try {
    sessionStorage.setItem(SESSION_ROOM_KEY, JSON.stringify({ roomCode, playerId }));
  } catch {
    // ignore
  }
}

function clearActiveSession() {
  try {
    sessionStorage.removeItem(SESSION_ROOM_KEY);
  } catch {
    // ignore
  }
}

function checkInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code) {
    const clean = code.trim().toUpperCase().slice(0, 6);
    if (clean) {
      els.inputRoomCode.value = clean;
      els.inviteCodeText.textContent = clean;
      els.inviteBanner.classList.remove('hidden');
    }
  }
}

function setupViewportFix() {
  const updateHeight = () => {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);

    if (document.body.classList.contains('in-game')) {
      const isKeyboard = vv ? window.innerHeight - vv.height > 120 : false;
      document.body.classList.toggle('keyboard-open', isKeyboard && !isMeDrawer());
      if (isKeyboard) {
        window.scrollTo(0, 0);
        scrollChatToBottom();
      }
      requestAnimationFrame(() => canvasEngine?.fitToStage());
    } else {
      document.body.classList.remove('keyboard-open');
    }
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateHeight);
    window.visualViewport.addEventListener('scroll', updateHeight);
  }
  window.addEventListener('resize', updateHeight);
  updateHeight();
}

// ============================================================================
// ساخت اجزای پویا (کاراکترها، پالت رنگ، سایز قلم، موضوعات)
// ============================================================================
function buildAvatarPicker() {
  els.avatarPicker.innerHTML = '';
  for (const emoji of GAME_CONFIG.AVATARS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `avatar-option${emoji === state.myAvatar ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(emoji === state.myAvatar));
    btn.addEventListener('click', () => {
      sound.playClick();
      state.myAvatar = emoji;
      for (const el of els.avatarPicker.children) {
        const active = el === btn;
        el.classList.toggle('selected', active);
        el.setAttribute('aria-checked', String(active));
      }
    });
    els.avatarPicker.appendChild(btn);
  }
}

function buildDrawingToolbar() {
  els.colorPalette.innerHTML = '';
  GAME_CONFIG.PALETTE.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `color-swatch${idx === 0 ? ' active' : ''}`;
    btn.style.backgroundColor = c.hex;
    btn.title = c.name;
    btn.dataset.hex = c.hex;
    btn.addEventListener('click', () => {
      sound.playClick();
      canvasEngine?.setColor(c.hex);
      for (const s of els.colorPalette.children) {
        s.classList.toggle('active', s === btn);
      }
      if (canvasEngine?.tool === 'pen') {
        setActiveToolButton('pen');
      }
    });
    els.colorPalette.appendChild(btn);
  });

  els.brushSizes.innerHTML = '';
  GAME_CONFIG.BRUSH_SIZES.forEach((sz, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `size-btn${idx === 1 ? ' active' : ''}`;
    btn.title = sz.label;
    btn.innerHTML = `<span class="size-dot" style="width:${sz.dotPx}px;height:${sz.dotPx}px;"></span>`;
    btn.addEventListener('click', () => {
      sound.playClick();
      canvasEngine?.setSizeRatio(sz.ratio);
      for (const b of els.brushSizes.children) {
        b.classList.toggle('active', b === btn);
      }
    });
    els.brushSizes.appendChild(btn);
  });
}

function buildCategoryChips() {
  els.settingCategories.innerHTML = '';
  for (const cat of GAME_CONFIG.CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip';
    btn.dataset.catId = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => handleCategoryToggle(cat.id));
    els.settingCategories.appendChild(btn);
  }
}

function setActiveToolButton(toolName) {
  [els.toolPen, els.toolBucket, els.toolEraser].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });
}

// ============================================================================
// اتصال رویدادهای رابط کاربری
// ============================================================================
function bindUIEvents() {
  els.soundButtons().forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.toggleMute();
      updateSoundIcons();
    });
  });

  els.btnCreateRoom.addEventListener('click', handleCreateRoom);
  els.btnJoinRoom.addEventListener('click', handleJoinRoom);
  els.inputRoomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
  els.inputPlayerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (els.inputRoomCode.value.trim()) handleJoinRoom();
      else handleCreateRoom();
    }
  });

  els.btnCopyCode.addEventListener('click', async () => {
    if (!state.room) return;
    const ok = await copyToClipboard(state.room.code);
    showToast(ok ? 'کد اتاق کپی شد، بفرست برای بچه‌ها!' : 'نتونستم کپی کنم', ok ? 'success' : 'warning');
  });

  els.btnCopyLink.addEventListener('click', async () => {
    if (!state.room) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${state.room.code}`;
    const ok = await copyToClipboard(url);
    showToast(ok ? 'لینک دعوت کپی شد! بفرست تو گروه که بیان' : 'نتونستم کپی کنم', ok ? 'success' : 'warning');
  });

  els.btnLeaveLobby.addEventListener('click', () => confirmAndLeaveRoom());
  els.btnToggleReady.addEventListener('click', handleToggleReady);
  els.btnStartGame.addEventListener('click', handleStartGame);

  els.settingMode.addEventListener('change', () => {
    const mode = els.settingMode.value;
    populateTargetSelect(mode, mode === 'rounds' ? 3 : 50);
    handleSettingsUpdate();
  });
  els.settingTarget.addEventListener('change', handleSettingsUpdate);
  els.settingTime.addEventListener('change', handleSettingsUpdate);

  els.btnLeaveGame.addEventListener('click', () => confirmAndLeaveRoom());
  els.btnEndGame.addEventListener('click', handleHostEndGame);

  [els.toolPen, els.toolBucket, els.toolEraser].forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.playClick();
      canvasEngine?.setTool(btn.dataset.tool);
      setActiveToolButton(btn.dataset.tool);
    });
  });

  els.btnUndo.addEventListener('click', () => {
    if (!isMeDrawer() || state.room?.status !== 'playing') return;
    sound.playClick();
    canvasEngine?.undo(true);
  });

  els.btnClear.addEventListener('click', () => {
    if (!isMeDrawer() || state.room?.status !== 'playing') return;
    sound.playClick();
    canvasEngine?.clear(true);
  });

  els.btnSkipTurn.addEventListener('click', handleSkipTurn);
  els.chatForm.addEventListener('submit', handleChatSubmit);

  els.btnPlayAgain.addEventListener('click', handlePlayAgain);
  els.btnGameoverHome.addEventListener('click', () => leaveRoomCleanly());

  els.modalConfirmCancel.addEventListener('click', () => closeConfirmModal(false));
  els.modalConfirmOk.addEventListener('click', () => closeConfirmModal(true));
  els.modalConfirm.addEventListener('click', (e) => {
    if (e.target === els.modalConfirm) closeConfirmModal(false);
  });
}

// ============================================================================
// توابع کمکی وضعیت
// ============================================================================
function getMe() {
  return state.players.find((p) => p.id === state.myId) || null;
}

function isMeHost() {
  return Boolean(state.room && state.myId && state.room.host_id === state.myId);
}

function isMeDrawer() {
  return Boolean(state.room && state.myId && state.room.current_drawer_id === state.myId);
}

function getDrawerPlayer() {
  if (!state.room?.current_drawer_id) return null;
  return state.players.find((p) => p.id === state.room.current_drawer_id) || null;
}

function getSettings() {
  return {
    ...GAME_CONFIG.DEFAULT_SETTINGS,
    ...(state.room?.settings || {}),
  };
}

function getRemainingSeconds() {
  if (!state.room?.round_end_at) return 0;
  const endMs = new Date(state.room.round_end_at).getTime();
  return Math.max(0, Math.ceil((endMs - network.getServerNowMs()) / 1000));
}

function canSeeWinnersChat() {
  if (!state.room || state.room.status !== 'playing') return true;
  if (isMeDrawer()) return true;
  return Boolean(getMe()?.has_guessed);
}

function switchView(viewName) {
  Object.entries(els.views).forEach(([key, el]) => {
    el.classList.toggle('active', key === viewName);
  });

  const inGame = viewName === 'game';
  document.body.classList.toggle('in-game', inGame);
  if (inGame) {
    requestAnimationFrame(() => canvasEngine?.fitToStage());
  } else {
    document.body.classList.remove('keyboard-open', 'is-drawer-mode');
  }
  if (viewName !== 'gameover') {
    confetti.stop();
  }
}

function updateSoundIcons() {
  const svg = sound.isMuted() ? ICON_SOUND_OFF : ICON_SOUND_ON;
  els.soundButtons().forEach((btn) => {
    const span = btn.querySelector('.sound-icon');
    if (span) span.innerHTML = svg;
  });
}

function showHomeError(msg) {
  if (!msg) {
    els.homeError.classList.add('hidden');
    els.homeError.textContent = '';
    return;
  }
  els.homeError.textContent = msg;
  els.homeError.classList.remove('hidden');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast${type !== 'info' ? ` toast-${type}` : ''}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 3000);
}

function openConfirmModal(title, message, okText = 'آره، انجام بده') {
  els.modalConfirmTitle.textContent = title;
  els.modalConfirmMessage.textContent = message;
  els.modalConfirmOk.textContent = okText;
  els.modalConfirm.classList.remove('hidden');

  return new Promise((resolve) => {
    modalResolver = resolve;
  });
}

function closeConfirmModal(result) {
  els.modalConfirm.classList.add('hidden');
  if (modalResolver) {
    const res = modalResolver;
    modalResolver = null;
    res(result);
  }
}

// ============================================================================
// ورود، ساخت اتاق و بازیابی نشست
// ============================================================================
function validatePlayerName() {
  const name = els.inputPlayerName.value.trim();
  if (name.length < 2) {
    showHomeError('حداقل یه اسم ۲ حرفی بنویس تا بشناسیمت!');
    els.inputPlayerName.focus();
    return null;
  }
  showHomeError('');
  state.myName = name;
  saveProfile();
  return name;
}

async function handleCreateRoom() {
  sound.unlock();
  const name = validatePlayerName();
  if (!name) return;

  setHomeButtonsLoading(true);
  try {
    state.myId = generatePlayerId();
    const { room, player } = await network.createRoom({
      id: state.myId,
      name: state.myName,
      avatar: state.myAvatar,
    });

    await enterRoomSession(room.code, room, [player], []);
    sound.playJoin();
  } catch (err) {
    showHomeError(err.message || 'الان نشد اتاق بسازیم، اینترنتت رو یه چک کن.');
  } finally {
    setHomeButtonsLoading(false);
  }
}

async function handleJoinRoom() {
  sound.unlock();
  const name = validatePlayerName();
  if (!name) return;

  const code = els.inputRoomCode.value.trim().toUpperCase();
  if (code.length < 4) {
    showHomeError('کد اتاق درست نیست، یه بار دیگه چکش کن.');
    els.inputRoomCode.focus();
    return;
  }

  setHomeButtonsLoading(true);
  try {
    state.myId = generatePlayerId();
    const { room, players } = await network.joinRoom(code, {
      id: state.myId,
      name: state.myName,
      avatar: state.myAvatar,
    });

    const full = await network.fetchRoomState(room.code);
    await enterRoomSession(room.code, full.room || room, full.players || players, full.messages || []);
    sound.playJoin();

    if (room.status !== 'lobby') {
      network.sendMessage(room.code, {
        text: `${state.myName} وسط بازی وارد جمع شد!`,
        type: 'system',
      }).catch(() => {});
    }
  } catch (err) {
    showHomeError(err.message || 'نتونستی وارد اتاق بشی، کد رو دوباره چک کن.');
  } finally {
    setHomeButtonsLoading(false);
  }
}

async function tryAutoReconnect() {
  try {
    const raw = sessionStorage.getItem(SESSION_ROOM_KEY);
    if (!raw) return;
    const { roomCode, playerId } = JSON.parse(raw);
    if (!roomCode || !playerId) return;

    const data = await network.fetchRoomState(roomCode);
    const exists = data.room && data.players.some((p) => p.id === playerId);
    if (!exists) {
      clearActiveSession();
      return;
    }

    const me = data.players.find((p) => p.id === playerId);
    state.myId = playerId;
    state.myName = me.name;
    state.myAvatar = me.avatar;

    await enterRoomSession(roomCode, data.room, data.players, data.messages);
    showToast('برگشتی سر جات تو اتاق!', 'success');
  } catch {
    clearActiveSession();
  }
}

function setHomeButtonsLoading(loading) {
  els.btnCreateRoom.disabled = loading;
  els.btnJoinRoom.disabled = loading;
}

async function enterRoomSession(roomCode, room, players, messages) {
  closePwaModal(false);
  state.room = room;
  state.players = sortPlayersByJoin(players);
  state.messages = messages || [];
  state.localNotices = [];
  state.lastStatus = null;
  state.lastTurnKey = null;
  state.hostBusy = false;

  saveActiveSession(roomCode, state.myId);

  if (window.location.search.includes('room=')) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  network.subscribeToRoom(
    roomCode,
    { id: state.myId, name: state.myName },
    {
      onSubscribed: async () => {
        try {
          const fresh = await network.fetchRoomState(roomCode);
          if (fresh.room) {
            state.room = fresh.room;
            state.players = sortPlayersByJoin(fresh.players);
            state.messages = fresh.messages;
            renderAll();
            if (state.room.status === 'playing' && !isMeDrawer()) {
              network.sendDrawEvent({ type: 'sync_request', requesterId: state.myId });
            }
          }
        } catch {
          // ignore
        }
      },
      onRoomUpdate: (updatedRoom) => {
        state.room = updatedRoom;
        renderAll();
        evaluateHostResponsibilities();
      },
      onRoomDeleted: () => {
        showToast('اتاق بسته شد.', 'warning');
        leaveRoomCleanly(true);
      },
      onPlayersChange: (payload) => {
        handlePlayerRealtimePayload(payload);
      },
      onNewMessage: (msg) => {
        if (!state.messages.some((m) => m.id === msg.id)) {
          state.messages.push(msg);
          if (msg.type === 'correct') {
            sound.playCorrect();
          }
          renderChat();
        }
      },
      onDrawEvent: (payload) => {
        handleRemoteDrawEvent(payload);
      },
      onPresenceSync: (onlineIds) => {
        state.onlineIds = new Set(onlineIds);
        for (const id of onlineIds) {
          if (state.disconnectTimers.has(id)) {
            clearTimeout(state.disconnectTimers.get(id));
            state.disconnectTimers.delete(id);
          }
        }
      },
      onPresenceLeave: (leftPlayerId) => {
        scheduleDisconnectCleanup(leftPlayerId);
      },
      onConnectionIssue: () => {
        showToast('نت یه کم ضعیف شد، داریم دوباره وصل می‌شیم...', 'warning');
      },
    }
  );

  renderAll();
}

function handlePlayerRealtimePayload(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;

  if (eventType === 'INSERT' && newRow) {
    const idx = state.players.findIndex((p) => p.id === newRow.id);
    if (idx === -1) {
      state.players.push(newRow);
      if (newRow.id !== state.myId) sound.playJoin();
    } else {
      state.players[idx] = newRow;
    }
  } else if (eventType === 'UPDATE' && newRow) {
    const idx = state.players.findIndex((p) => p.id === newRow.id);
    if (idx !== -1) state.players[idx] = newRow;
    else state.players.push(newRow);
  } else if (eventType === 'DELETE' && oldRow) {
    state.players = state.players.filter((p) => p.id !== oldRow.id);
    if (oldRow.id === state.myId) {
      leaveRoomCleanly(true);
      return;
    }
  }

  state.players = sortPlayersByJoin(state.players);
  renderAll();
  evaluateHostResponsibilities();
}

function handleRemoteDrawEvent(payload) {
  if (!payload || !payload.type) return;

  if (payload.type === 'sync_request') {
    if (isMeDrawer() && state.room?.status === 'playing') {
      network.sendDrawEvent({
        type: 'sync_state',
        targetId: payload.requesterId,
        history: canvasEngine.getHistory(),
      });
    }
    return;
  }

  if (payload.type === 'sync_state' && payload.targetId && payload.targetId !== state.myId) {
    return;
  }

  canvasEngine?.applyRemoteEvent(payload);
}

function scheduleDisconnectCleanup(leftPlayerId) {
  if (!state.room || leftPlayerId === state.myId) return;
  if (state.disconnectTimers.has(leftPlayerId)) return;

  const timerId = setTimeout(async () => {
    state.disconnectTimers.delete(leftPlayerId);
    if (!state.room || state.onlineIds.has(leftPlayerId)) return;

    const targetPlayer = state.players.find((p) => p.id === leftPlayerId);
    if (!targetPlayer) return;

    const remainingOnline = state.players.filter(
      (p) => p.id !== leftPlayerId && (state.onlineIds.has(p.id) || p.id === state.myId)
    );
    const leader = remainingOnline[0];
    if (!leader || leader.id !== state.myId) return;

    try {
      if (state.room.host_id === leftPlayerId) {
        await network.updateRoom(state.room.code, { host_id: state.myId });
        await network.sendMessage(state.room.code, {
          text: `${state.myName} شد میزبان جدید اتاق.`,
          type: 'system',
        });
      }

      await network.removePlayer(leftPlayerId);
      await network.sendMessage(state.room.code, {
        text: `${targetPlayer.name} نتش قطع شد و از اتاق رفت.`,
        type: 'system',
      });
    } catch {
      // ignore
    }
  }, 7000);

  state.disconnectTimers.set(leftPlayerId, timerId);
}

function sortPlayersByJoin(list) {
  return [...(list || [])].sort((a, b) => {
    const tA = new Date(a.joined_at || 0).getTime();
    const tB = new Date(b.joined_at || 0).getTime();
    if (tA !== tB) return tA - tB;
    return String(a.id).localeCompare(String(b.id));
  });
}

// ============================================================================
// خروج تمیز از اتاق و انتقال میزبانی
// ============================================================================
async function confirmAndLeaveRoom() {
  const ok = await openConfirmModal(
    'بری بیرون؟',
    'مطمئنی می‌خوای جمع رو ترک کنی و از اتاق بری بیرون؟',
    'آره، میرم'
  );
  if (ok) {
    await leaveRoomCleanly(false);
  }
}

async function leaveRoomCleanly(skipDbCleanup = false) {
  for (const t of state.disconnectTimers.values()) clearTimeout(t);
  state.disconnectTimers.clear();

  const room = state.room;
  const myId = state.myId;
  const myName = state.myName;
  const others = state.players.filter((p) => p.id !== myId);

  clearActiveSession();
  await network.unsubscribe();

  if (!skipDbCleanup && room && myId) {
    try {
      if (others.length === 0) {
        await network.deleteRoom(room.code);
      } else {
        if (room.host_id === myId) {
          const nextHost = others[0];
          await network.updateRoom(room.code, { host_id: nextHost.id });
          await network.sendMessage(room.code, {
            text: `${nextHost.name} شد میزبان جدید اتاق.`,
            type: 'system',
          });
        }
        await network.removePlayer(myId);
        await network.sendMessage(room.code, {
          text: `${myName} از اتاق رفت بیرون.`,
          type: 'system',
        });
      }
    } catch {
      // ignore
    }
  }

  state.room = null;
  state.players = [];
  state.messages = [];
  state.localNotices = [];
  state.lastStatus = null;
  state.lastTurnKey = null;
  els.overlayCountdown.classList.add('hidden');
  canvasEngine?.clear(false);
  switchView('home');
}

// ============================================================================
// عملیات لابی
// ============================================================================
function populateTargetSelect(mode, selectedValue) {
  const options = mode === 'score' ? GAME_CONFIG.SCORE_OPTIONS : GAME_CONFIG.ROUND_OPTIONS;
  els.settingTargetLabel.textContent = mode === 'score' ? 'سقف امتیاز برنده' : 'تعداد دور چرخش';

  if (els.settingTarget.dataset.mode !== mode) {
    els.settingTarget.dataset.mode = mode;
    els.settingTarget.innerHTML = '';
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = String(opt.value);
      el.textContent = opt.label;
      els.settingTarget.appendChild(el);
    }
  }
  els.settingTarget.value = String(selectedValue);
}

async function handleSettingsUpdate() {
  if (!isMeHost() || !state.room || state.room.status !== 'lobby') return;
  const current = getSettings();
  const nextSettings = {
    ...current,
    mode: els.settingMode.value,
    targetValue: Number(els.settingTarget.value),
    roundTime: Number(els.settingTime.value),
  };

  try {
    await network.updateRoom(state.room.code, { settings: nextSettings });
  } catch {
    showToast('تنظیمات ذخیره نشد، دوباره امتحان کن.', 'danger');
  }
}

async function handleCategoryToggle(catId) {
  if (!isMeHost() || !state.room || state.room.status !== 'lobby') return;
  sound.playClick();

  const current = getSettings();
  let cats = Array.isArray(current.categories) ? [...current.categories] : ['all'];

  if (catId === 'all') {
    cats = ['all'];
  } else {
    cats = cats.filter((c) => c !== 'all');
    if (cats.includes(catId)) {
      cats = cats.filter((c) => c !== catId);
    } else {
      cats.push(catId);
    }
    if (cats.length === 0) cats = ['all'];
  }

  try {
    await network.updateRoom(state.room.code, {
      settings: { ...current, categories: cats },
    });
  } catch {
    showToast('تغییر موضوع ثبت نشد.', 'danger');
  }
}

async function handleToggleReady() {
  const me = getMe();
  if (!me || !state.room || state.room.status !== 'lobby') return;
  sound.playClick();

  try {
    await network.updatePlayer(me.id, { is_ready: !me.is_ready });
  } catch {
    showToast('وضعیت آمادگی ثبت نشد.', 'danger');
  }
}

async function handleStartGame() {
  if (!isMeHost() || !state.room || state.room.status !== 'lobby') return;

  if (state.players.length < GAME_CONFIG.MIN_PLAYERS) {
    showToast('تکی که حال نمیده! حداقل ۲ نفر باید باشید.', 'warning');
    return;
  }

  const allReady = state.players.every((p) => p.is_ready);
  if (!allReady) {
    showToast('صبر کن همه دکمه «آماده‌ام» رو بزنن.', 'warning');
    return;
  }

  try {
    await network.clearMessages(state.room.code);
    await network.resetAllPlayersForTurn(state.room.code);
    await Promise.all(
      state.players.map((p) =>
        network.updatePlayer(p.id, { score: 0, round_score: 0, has_guessed: false, guess_order: 0 })
      )
    );

    const turnOrder = shuffleArray(state.players.map((p) => p.id));
    const countdownEnd = new Date(
      network.getServerNowMs() + (GAME_CONFIG.COUNTDOWN_SECONDS + 0.5) * 1000
    ).toISOString();

    await network.updateRoom(state.room.code, {
      status: 'countdown',
      current_round: 1,
      turn_order: turnOrder,
      current_drawer_index: 0,
      current_drawer_id: turnOrder[0],
      word_choices: [],
      current_word: null,
      used_words: [],
      round_summary: null,
      timer_accelerated: false,
      round_end_at: countdownEnd,
    });
  } catch (err) {
    showToast(`شروع بازی به مشکل خورد: ${err.message}`, 'danger');
  }
}

// ============================================================================
// چرخه گیم‌پلی و تایمر
// ============================================================================
function onClockTick() {
  if (!state.room) return;
  const status = state.room.status;

  if (status === 'countdown') {
    const rem = getRemainingSeconds();
    const displayNum = Math.max(1, Math.min(GAME_CONFIG.COUNTDOWN_SECONDS, rem));
    els.countdownNumber.textContent = toPersianDigits(displayNum);

    if (state.lastCountdownTick !== displayNum) {
      state.lastCountdownTick = displayNum;
      els.countdownNumber.style.animation = 'none';
      void els.countdownNumber.offsetWidth;
      els.countdownNumber.style.animation = '';
      sound.playCountdown(displayNum);
    }

    if (rem <= 0 && isMeHost()) {
      hostBeginTurn(state.room.current_round, 0, state.room.turn_order);
    }
    return;
  }

  if (status === 'choosing') {
    const rem = getRemainingSeconds();
    els.wordChoiceTimer.textContent = toPersianDigits(rem);
    els.gameTimerValue.textContent = toPersianDigits(rem);

    if (rem <= 0 && isMeHost()) {
      const choices = Array.isArray(state.room.word_choices) ? state.room.word_choices : [];
      const fallbackWord = choices[0]?.word || 'خورشید';
      selectWordAndStartDrawing(fallbackWord);
    }
    return;
  }

  if (status === 'playing') {
    const rem = getRemainingSeconds();
    els.gameTimerValue.textContent = toPersianDigits(rem);
    els.gameTimer.classList.toggle('timer-danger', rem <= 10);
    els.gameTimer.classList.toggle('timer-accelerated', Boolean(state.room.timer_accelerated) && rem > 10);
    els.timerAccelBadge.classList.toggle('hidden', !state.room.timer_accelerated);

    if (rem !== state.lastTimerSec) {
      state.lastTimerSec = rem;
      if (rem > 0 && rem <= 10) {
        sound.playTick(rem <= 5);
      }
    }

    if (rem <= 0 && isMeHost()) {
      hostEndCurrentRound('وقت این دور تموم شد!');
    }
    return;
  }

  if (status === 'round_end') {
    const rem = getRemainingSeconds();
    els.roundEndNextTimer.textContent =
      rem > 0
        ? `نوبت بعدی تا ${toPersianDigits(rem)} ثانیه دیگه...`
        : 'داریم می‌ریم سراغ نفر بعدی...';

    if (rem <= 0 && isMeHost()) {
      hostAdvanceAfterRoundEnd();
    }
  }
}

async function evaluateHostResponsibilities() {
  if (!isMeHost() || !state.room || state.hostBusy) return;

  const status = state.room.status;
  if (!['choosing', 'playing', 'round_end'].includes(status)) return;

  if (state.players.length < GAME_CONFIG.MIN_PLAYERS) {
    await hostFinishGame('تعداد بچه‌ها به کمتر از ۲ نفر رسید.');
    return;
  }

  const drawerExists = state.players.some((p) => p.id === state.room.current_drawer_id);
  if ((status === 'choosing' || status === 'playing') && !drawerExists) {
    await hostEndCurrentRound('نقاش وسط کار گذاشت و رفت!');
    return;
  }

  if (status === 'playing') {
    const guessers = state.players.filter((p) => p.id !== state.room.current_drawer_id);
    const guessedCount = guessers.filter((p) => p.has_guessed).length;

    if (guessers.length > 0 && guessedCount === guessers.length) {
      await hostEndCurrentRound('ایول! همه درست حدس زدن!');
      return;
    }

    if (guessedCount >= 1 && !state.room.timer_accelerated) {
      const rem = getRemainingSeconds();
      if (rem > GAME_CONFIG.ACCELERATE_TARGET_MAX) {
        const acceleratedSec = Math.max(
          GAME_CONFIG.ACCELERATE_MIN_REMAINING,
          Math.min(GAME_CONFIG.ACCELERATE_TARGET_MAX, Math.round(rem / 2))
        );
        const newEndAt = new Date(network.getServerNowMs() + acceleratedSec * 1000).toISOString();
        try {
          await network.updateRoom(state.room.code, {
            timer_accelerated: true,
            round_end_at: newEndAt,
          });
          await network.sendMessage(state.room.code, {
            text: `بجنبین! اولین نفر حدس زد، فقط ${toPersianDigits(acceleratedSec)} ثانیه وقت مونده.`,
            type: 'system',
          });
        } catch {
          // ignore
        }
      }
    }
  }
}

async function hostBeginTurn(roundNum, drawerIdx, turnOrder) {
  if (!isMeHost() || !state.room || state.hostBusy) return;
  state.hostBusy = true;

  try {
    const settings = getSettings();
    const activeIds = new Set(state.players.map((p) => p.id));
    let cleanOrder = (Array.isArray(turnOrder) ? turnOrder : []).filter((id) => activeIds.has(id));

    for (const p of state.players) {
      if (!cleanOrder.includes(p.id)) {
        cleanOrder.push(p.id);
      }
    }

    if (cleanOrder.length < GAME_CONFIG.MIN_PLAYERS) {
      await hostFinishGame('تعداد بازیکنان کافی نیست.');
      return;
    }

    let nextIdx = drawerIdx;
    let nextRound = roundNum;

    if (nextIdx >= cleanOrder.length) {
      nextIdx = 0;
      nextRound += 1;
      if (settings.mode === 'rounds' && nextRound > settings.targetValue) {
        await hostFinishGame('همه دورها تموم شد! ببینیم کی قهرمان شد');
        return;
      }
    }

    const drawerId = cleanOrder[nextIdx];
    const usedWords = Array.isArray(state.room.used_words) ? state.room.used_words : [];
    const choices = pickWordChoices(settings.categories, usedWords, 3);

    await network.resetAllPlayersForTurn(state.room.code);
    network.sendDrawEvent({ type: 'clear' });
    canvasEngine.clear(false);

    const choiceEndAt = new Date(
      network.getServerNowMs() + GAME_CONFIG.WORD_CHOICE_SECONDS * 1000
    ).toISOString();

    await network.updateRoom(state.room.code, {
      status: 'choosing',
      current_round: nextRound,
      turn_order: cleanOrder,
      current_drawer_index: nextIdx,
      current_drawer_id: drawerId,
      word_choices: choices,
      current_word: null,
      timer_accelerated: false,
      round_summary: null,
      round_end_at: choiceEndAt,
    });
  } catch (err) {
    showToast(`خطا در شروع نوبت: ${err.message}`, 'danger');
  } finally {
    state.hostBusy = false;
  }
}

async function selectWordAndStartDrawing(word) {
  if (!state.room || state.room.status !== 'choosing') return;
  if (!isMeDrawer() && !isMeHost()) return;
  if (state.hostBusy) return;

  state.hostBusy = true;
  try {
    const settings = getSettings();
    const used = Array.isArray(state.room.used_words) ? [...state.room.used_words] : [];
    if (!used.includes(word)) used.push(word);

    const roundEndAt = new Date(
      network.getServerNowMs() + settings.roundTime * 1000
    ).toISOString();

    canvasEngine.clear(true);

    await network.updateRoom(state.room.code, {
      status: 'playing',
      current_word: word,
      word_choices: [],
      used_words: used,
      timer_accelerated: false,
      round_end_at: roundEndAt,
    });

    const drawer = getDrawerPlayer();
    await network.sendMessage(state.room.code, {
      text: `نوبت ${drawer ? drawer.name : 'نقاش'} شد! ببینیم چی می‌کشه...`,
      type: 'system',
    });
  } catch (err) {
    showToast(`انتخاب کلمه ثبت نشد: ${err.message}`, 'danger');
  } finally {
    state.hostBusy = false;
  }
}

async function handleSkipTurn() {
  if (!isMeDrawer() || state.room?.status !== 'playing') return;
  const ok = await openConfirmModal(
    'نوبتت رو رد کنی؟',
    'اگه نوبتت رو رد کنی امتیازی از این دور نمی‌گیری و می‌ره برای نفر بعدی.',
    'آره، رد کن'
  );
  if (!ok) return;

  try {
    if (isMeHost()) {
      await hostEndCurrentRound(`${state.myName} بی‌خیال کشیدن شد و نوبتش رو رد کرد!`);
    } else {
      await network.sendMessage(state.room.code, {
        text: `${state.myName} نوبتش رو رد کرد.`,
        type: 'system',
      });
      await network.updateRoom(state.room.code, {
        round_end_at: new Date(network.getServerNowMs() - 1000).toISOString(),
      });
    }
  } catch {
    showToast('خطا در رد کردن نوبت.', 'danger');
  }
}

async function hostEndCurrentRound(reason) {
  if (!isMeHost() || !state.room || state.hostBusy) return;
  if (state.room.status === 'round_end' || state.room.status === 'finished') return;

  state.hostBusy = true;
  try {
    const drawer = getDrawerPlayer();
    const guessers = state.players.filter((p) => p.id !== state.room.current_drawer_id);
    const correctCount = guessers.filter((p) => p.has_guessed).length;
    const drawerPoints = calculateDrawerPoints(correctCount);

    if (drawer && drawerPoints > 0) {
      await network.updatePlayer(drawer.id, {
        score: (drawer.score || 0) + drawerPoints,
        round_score: drawerPoints,
      });
    }

    const summaryScores = state.players
      .map((p) => {
        const delta = p.id === drawer?.id ? drawerPoints : (p.round_score || 0);
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          delta,
          isDrawer: p.id === drawer?.id,
        };
      })
      .sort((a, b) => b.delta - a.delta);

    const endOverlayAt = new Date(
      network.getServerNowMs() + GAME_CONFIG.ROUND_END_SECONDS * 1000
    ).toISOString();

    await network.updateRoom(state.room.code, {
      status: 'round_end',
      round_summary: {
        reason,
        word: state.room.current_word || '---',
        scores: summaryScores,
      },
      round_end_at: endOverlayAt,
    });
  } catch (err) {
    showToast(`خطا در پایان راند: ${err.message}`, 'danger');
  } finally {
    state.hostBusy = false;
  }
}

async function hostAdvanceAfterRoundEnd() {
  if (!isMeHost() || !state.room || state.hostBusy) return;

  const settings = getSettings();

  if (settings.mode === 'score') {
    const winner = state.players.find((p) => (p.score || 0) >= settings.targetValue);
    if (winner) {
      await hostFinishGame(`${winner.name} با ${toPersianDigits(settings.targetValue)} امتیاز بازی رو برد!`);
      return;
    }
  }

  const activeIds = new Set(state.players.map((p) => p.id));
  const prevDrawerStillIn = activeIds.has(state.room.current_drawer_id);
  const currentIdx = state.room.current_drawer_index || 0;
  const nextIndex = prevDrawerStillIn ? currentIdx + 1 : currentIdx;
  await hostBeginTurn(state.room.current_round || 1, nextIndex, state.room.turn_order);
}

async function hostFinishGame(reasonText = 'بازی تموم شد!') {
  if (!isMeHost() || !state.room) return;
  try {
    await network.updateRoom(state.room.code, {
      status: 'finished',
      round_summary: { reason: reasonText },
      round_end_at: null,
    });
  } catch {
    // ignore
  }
}

async function handleHostEndGame() {
  if (!isMeHost() || !state.room) return;
  const ok = await openConfirmModal(
    'بازی رو ببندیم؟',
    'می‌خوای بازی همین الان تموم شه و بریم سراغ سکوهای قهرمانی؟',
    'آره، تمومش کن'
  );
  if (ok) {
    await hostFinishGame('میزبان بازی رو بست.');
  }
}

async function handlePlayAgain() {
  if (!isMeHost() || !state.room) return;
  try {
    await network.clearMessages(state.room.code);
    await network.resetAllPlayersForLobby(state.room.code);
    canvasEngine.clear(true);
    await network.updateRoom(state.room.code, {
      status: 'lobby',
      current_round: 1,
      turn_order: [],
      current_drawer_index: 0,
      current_drawer_id: null,
      word_choices: [],
      current_word: null,
      used_words: [],
      round_summary: null,
      timer_accelerated: false,
      round_end_at: null,
    });
  } catch (err) {
    showToast(`بازگشت به لابی انجام نشد: ${err.message}`, 'danger');
  }
}

// ============================================================================
// چت ۴-لایه هوشمند و ضداسپویل
// ============================================================================
async function handleChatSubmit(e) {
  e.preventDefault();
  if (!state.room) return;

  const rawText = els.chatInput.value.trim();
  if (!rawText) return;
  els.chatInput.value = '';

  const me = getMe();
  if (!me) return;

  const status = state.room.status;
  const targetWord = state.room.current_word;

  if (status !== 'playing' || !targetWord) {
    await network.sendMessage(state.room.code, {
      senderId: me.id,
      senderName: me.name,
      text: rawText,
      type: 'guess',
    }).catch(() => {});
    return;
  }

  // چت مخفی برنده‌ها و نقاش (ضد لو رفتن کلمه)
  if (isMeDrawer() || me.has_guessed) {
    if (containsTargetWord(rawText, targetWord)) {
      sound.playClose();
      showToast('هیس! نمی‌تونی خود کلمه رو تو چت لو بدی', 'warning');
      return;
    }

    await network.sendMessage(state.room.code, {
      senderId: me.id,
      senderName: me.name,
      text: rawText,
      type: 'winners',
    }).catch(() => {});
    return;
  }

  const verdict = evaluateGuess(rawText, targetWord);

  // حدس کاملاً درست (متن حدس اصلاً ارسال نمی‌شود)
  if (verdict === 'exact') {
    const alreadyGuessedCount = state.players.filter(
      (p) => p.id !== state.room.current_drawer_id && p.has_guessed
    ).length;
    const guessOrder = alreadyGuessedCount + 1;
    const settings = getSettings();
    const rem = getRemainingSeconds();
    const earned = calculateGuesserPoints(guessOrder, rem, settings.roundTime);

    sound.playCorrect();
    confetti.burst({ count: 38, originY: 0.3 });

    try {
      await network.updatePlayer(me.id, {
        has_guessed: true,
        guess_order: guessOrder,
        round_score: earned,
        score: (me.score || 0) + earned,
      });

      await network.sendMessage(state.room.code, {
        senderId: me.id,
        senderName: me.name,
        text: `${me.name} درست حدس زد! (+${toPersianDigits(earned)} امتیاز)`,
        type: 'correct',
      });
    } catch {
      showToast('خطا در ثبت امتیازت.', 'danger');
    }
    return;
  }

  // فقط ۱ حرف اختلاف (خصوصی برای خود بازیکن)
  if (verdict === 'close') {
    sound.playClose();
    state.localNotices.push({
      id: `local_${Date.now()}_${Math.random()}`,
      text: `«${rawText}» خیلی نزدیک بودی! فقط ۱ حرفش فرق داره.`,
      createdAt: Date.now(),
    });
    renderChat();
    return;
  }

  // حدس غلط (نمایش عادی برای همه)
  await network.sendMessage(state.room.code, {
    senderId: me.id,
    senderName: me.name,
    text: rawText,
    type: 'guess',
  }).catch(() => {});
}

// ============================================================================
// رندر کامل رابط کاربری
// ============================================================================
function renderAll() {
  if (!state.room) {
    switchView('home');
    return;
  }

  const status = state.room.status;
  const statusChanged = state.lastStatus !== status;
  const turnKey = `${state.room.current_round}_${state.room.current_drawer_index}_${status}`;
  const turnChanged = state.lastTurnKey !== turnKey;

  state.lastStatus = status;
  state.lastTurnKey = turnKey;

  if (statusChanged) {
    if (status === 'choosing' && state.lastCountdownTick !== null) {
      sound.playGameStart();
      state.lastCountdownTick = null;
    } else if (status === 'playing') {
      state.roundStartedAtMs = network.getServerNowMs();
      state.localNotices = [];
      state.lastTimerSec = null;
      sound.playTurnStart();
    } else if (status === 'round_end') {
      sound.playRoundEnd();
    } else if (status === 'finished') {
      sound.playGameOver();
      confetti.celebrate();
    }
  } else if (turnChanged && status === 'choosing') {
    state.localNotices = [];
    canvasEngine?.clear(false);
  }

  els.overlayCountdown.classList.toggle('hidden', status !== 'countdown');

  if (status === 'lobby' || status === 'countdown') {
    switchView('lobby');
    renderLobby();
    return;
  }

  if (status === 'finished') {
    switchView('gameover');
    renderGameOver();
    return;
  }

  switchView('game');
  renderGameView();
}

function renderLobby() {
  const room = state.room;
  const me = getMe();
  const host = isMeHost();
  const settings = getSettings();

  els.lobbyRoomCode.textContent = room.code;
  els.lobbyPlayerCount.textContent = `${toPersianDigits(state.players.length)} / ${toPersianDigits(GAME_CONFIG.MAX_PLAYERS)}`;
  els.lobbyHostPill.classList.toggle('hidden', !host);
  els.lobbySettingsHint.classList.toggle('hidden', host);

  els.lobbyPlayersList.innerHTML = state.players
    .map((p) => {
      const isHost = p.id === room.host_id;
      const isMe = p.id === state.myId;
      return `
        <li class="lobby-player-item ${isMe ? 'is-me' : ''} ${p.is_ready ? 'is-ready' : ''}">
          <div class="player-info">
            <span class="player-avatar">${escapeHtml(p.avatar)}</span>
            <span class="player-name">${escapeHtml(p.name)}${isMe ? ' (خودت)' : ''}</span>
          </div>
          <div class="player-tags">
            ${isHost ? '<span class="badge badge-amber">میزبان</span>' : ''}
            <span class="ready-pill ${p.is_ready ? 'ready' : 'waiting'}">
              ${p.is_ready ? 'آماده' : 'منتظر'}
            </span>
          </div>
        </li>
      `;
    })
    .join('');

  els.settingMode.value = settings.mode;
  populateTargetSelect(settings.mode, settings.targetValue);
  els.settingTime.value = String(settings.roundTime);

  els.settingMode.disabled = !host;
  els.settingTarget.disabled = !host;
  els.settingTime.disabled = !host;

  const selectedCats = Array.isArray(settings.categories) ? settings.categories : ['all'];
  for (const chip of els.settingCategories.children) {
    const id = chip.dataset.catId;
    chip.classList.toggle('active', selectedCats.includes(id));
    chip.disabled = !host;
  }

  if (me) {
    els.btnToggleReady.textContent = me.is_ready ? 'دست نگه دار' : 'آماده‌ام';
    els.btnToggleReady.className = `btn btn-lg ${me.is_ready ? 'btn-secondary' : 'btn-success'}`;
  }

  const readyCount = state.players.filter((p) => p.is_ready).length;
  const enoughPlayers = state.players.length >= GAME_CONFIG.MIN_PLAYERS;
  const allReady = enoughPlayers && readyCount === state.players.length;

  els.btnStartGame.classList.toggle('hidden', !host);
  els.btnStartGame.disabled = !allReady;

  if (!enoughPlayers) {
    els.lobbyStatusText.textContent = 'لینک دعوت رو بفرست برای رفقا، حداقل ۲ نفر باید باشید.';
  } else if (!allReady) {
    els.lobbyStatusText.textContent = `${toPersianDigits(readyCount)} از ${toPersianDigits(state.players.length)} نفر آماده شدن...`;
  } else {
    els.lobbyStatusText.textContent = host
      ? 'همه پایه‌ان! دکمه «بزن بریم» رو بزن تا شروع شه.'
      : 'همه آماده‌ان! منتظریم میزبان استارت بزنه...';
  }
}

function renderGameView() {
  const room = state.room;
  const settings = getSettings();
  const drawer = getDrawerPlayer();
  const meDrawer = isMeDrawer();
  const host = isMeHost();

  document.body.classList.toggle('is-drawer-mode', meDrawer && room.status === 'playing');

  if (settings.mode === 'rounds') {
    els.gameRoundBadge.textContent = `دور ${toPersianDigits(room.current_round)} از ${toPersianDigits(settings.targetValue)}`;
  } else {
    els.gameRoundBadge.textContent = `هدف: ${toPersianDigits(settings.targetValue)} امتیاز`;
  }

  els.gameDrawerBadge.textContent = drawer ? `نقاش: ${drawer.name}` : 'نقاش: ...';
  els.btnEndGame.classList.toggle('hidden', !host);

  renderWordHeader(room, meDrawer);

  const canDraw = meDrawer && room.status === 'playing';
  canvasEngine?.setInteractive(canDraw);
  els.drawerToolbar.classList.toggle('hidden', !canDraw);

  renderCanvasOverlays(room, drawer, meDrawer);
  renderGamePlayers(room);
  renderChat();

  requestAnimationFrame(() => canvasEngine?.fitToStage());
}

function renderWordHeader(room, meDrawer) {
  els.gameWordDisplay.innerHTML = '';

  if (room.status === 'choosing') {
    els.gameWordDisplay.innerHTML = '<span class="word-waiting">در حال انتخاب کلمه...</span>';
    els.gameWordMeta.classList.add('hidden');
    return;
  }

  if (!room.current_word) {
    els.gameWordDisplay.innerHTML = '<span class="word-waiting">آماده باش...</span>';
    els.gameWordMeta.classList.add('hidden');
    return;
  }

  const me = getMe();
  const revealWord = meDrawer || room.status === 'round_end' || Boolean(me?.has_guessed);

  if (revealWord) {
    const cat = findCategoryForWord(room.current_word);
    els.gameWordDisplay.innerHTML = `<span class="word-drawer-pill">${escapeHtml(room.current_word)}</span>`;
    if (cat) {
      els.gameWordMeta.textContent = `موضوع: ${cat}`;
      els.gameWordMeta.classList.remove('hidden');
    } else {
      els.gameWordMeta.classList.add('hidden');
    }
    return;
  }

  const structure = getWordStructure(room.current_word);
  structure.parts.forEach((part, idx) => {
    const group = document.createElement('span');
    group.className = 'word-group';
    const len = Array.from(part).length;
    for (let i = 0; i < len; i++) {
      const slot = document.createElement('span');
      slot.className = 'letter-slot';
      group.appendChild(slot);
    }
    els.gameWordDisplay.appendChild(group);

    if (idx < structure.parts.length - 1) {
      const space = document.createElement('span');
      space.className = 'word-space';
      els.gameWordDisplay.appendChild(space);
    }
  });

  els.gameWordMeta.textContent = structure.metaText;
  els.gameWordMeta.classList.remove('hidden');
}

function renderCanvasOverlays(room, drawer, meDrawer) {
  const isChoosing = room.status === 'choosing';
  const isRoundEnd = room.status === 'round_end';

  const showChoiceModal = isChoosing && meDrawer;
  els.overlayWordChoice.classList.toggle('hidden', !showChoiceModal);

  if (showChoiceModal) {
    const choices = Array.isArray(room.word_choices) ? room.word_choices : [];
    const currentSignature = choices.map((c) => c.word).join('|');
    if (els.wordChoiceButtons.dataset.sig !== currentSignature) {
      els.wordChoiceButtons.dataset.sig = currentSignature;
      els.wordChoiceButtons.innerHTML = '';
      for (const item of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'word-choice-btn';
        btn.innerHTML = `
          <span class="word-choice-text">${escapeHtml(item.word)}</span>
          <span class="word-choice-cat">${escapeHtml(item.categoryLabel || '')}</span>
        `;
        btn.addEventListener('click', () => {
          sound.playClick();
          selectWordAndStartDrawing(item.word);
        });
        els.wordChoiceButtons.appendChild(btn);
      }
    }
  } else {
    els.wordChoiceButtons.dataset.sig = '';
  }

  const showWaitingStatus = isChoosing && !meDrawer;
  els.canvasOverlayStatus.classList.toggle('hidden', !showWaitingStatus);
  if (showWaitingStatus) {
    els.canvasStatusAvatar.textContent = drawer?.avatar || '';
    els.canvasStatusText.textContent = `${drawer?.name || 'نقاش'} داره کلمه‌ش رو انتخاب می‌کنه...`;
  }

  els.overlayRoundEnd.classList.toggle('hidden', !isRoundEnd);
  if (isRoundEnd && room.round_summary) {
    els.roundEndReason.textContent = room.round_summary.reason || 'این دور تموم شد!';
    els.roundEndWord.textContent = room.round_summary.word || room.current_word || '---';

    const scores = Array.isArray(room.round_summary.scores) ? room.round_summary.scores : [];
    els.roundEndScores.innerHTML = scores
      .map(
        (s) => `
          <li class="round-score-row">
            <span>${escapeHtml(s.avatar)} ${escapeHtml(s.name)} ${s.isDrawer ? '(نقاش)' : ''}</span>
            <span class="round-score-delta ${s.delta > 0 ? '' : 'zero'}">
              ${s.delta > 0 ? `+${toPersianDigits(s.delta)}` : '۰'}
            </span>
          </li>
        `
      )
      .join('');
  }
}

function renderGamePlayers(room) {
  const sorted = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));

  els.gamePlayersList.innerHTML = sorted
    .map((p, index) => {
      const isDrawer = p.id === room.current_drawer_id;
      const guessed = Boolean(p.has_guessed);
      const statusBadge = isDrawer
        ? '<span class="gp-status status-drawer">نقاش</span>'
        : guessed
          ? '<span class="gp-status status-guessed">حدس زد</span>'
          : '';

      return `
        <li class="game-player-card ${isDrawer ? 'is-drawer' : ''} ${guessed ? 'has-guessed' : ''}">
          <span class="gp-rank">#${toPersianDigits(index + 1)}</span>
          <span class="gp-avatar">${escapeHtml(p.avatar)}</span>
          <div class="gp-meta">
            <span class="gp-name">${escapeHtml(p.name)}</span>
            <span class="gp-score">${toPersianDigits(p.score || 0)} امتیاز</span>
          </div>
          ${statusBadge}
        </li>
      `;
    })
    .join('');
}

function renderChat() {
  const me = getMe();
  const meDrawer = isMeDrawer();
  const isPlaying = state.room?.status === 'playing';
  const showWinners = canSeeWinnersChat();

  if (isPlaying && (meDrawer || me?.has_guessed)) {
    els.chatModeIndicator.textContent = 'چت مخفی برنده‌ها';
    els.chatModeIndicator.classList.add('mode-winners');
    els.chatInput.placeholder = meDrawer
      ? 'پیام به کسایی که درست حدس زدن...'
      : 'ایول! پیام مخفی به نقاش و برنده‌ها...';
  } else {
    els.chatModeIndicator.textContent = 'حدس بزن!';
    els.chatModeIndicator.classList.remove('mode-winners');
    els.chatInput.placeholder = 'حدست رو اینجا بنویس...';
  }

  const combined = [];

  for (const m of state.messages) {
    if (m.type === 'winners' && !showWinners) {
      continue;
    }
    combined.push({
      ts: new Date(m.created_at || 0).getTime(),
      kind: m.type || 'guess',
      senderName: m.sender_name,
      text: m.text,
    });
  }

  for (const n of state.localNotices) {
    combined.push({
      ts: n.createdAt,
      kind: 'close',
      senderName: null,
      text: n.text,
    });
  }

  combined.sort((a, b) => a.ts - b.ts);

  const wasNearBottom =
    els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight < 65;

  els.chatMessages.innerHTML = combined
    .map((item) => {
      if (item.kind === 'correct') {
        return `<div class="chat-msg msg-correct">${escapeHtml(item.text)}</div>`;
      }
      if (item.kind === 'close') {
        return `<div class="chat-msg msg-close">${escapeHtml(item.text)}</div>`;
      }
      if (item.kind === 'system') {
        return `<div class="chat-msg msg-system">${escapeHtml(item.text)}</div>`;
      }
      if (item.kind === 'winners') {
        return `<div class="chat-msg msg-winners"><span class="chat-msg-sender">[مخفی] ${escapeHtml(item.senderName || '')}:</span>${escapeHtml(item.text)}</div>`;
      }
      return `<div class="chat-msg"><span class="chat-msg-sender">${escapeHtml(item.senderName || '')}:</span>${escapeHtml(item.text)}</div>`;
    })
    .join('');

  if (wasNearBottom || combined.length <= 5) {
    scrollChatToBottom();
  }
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  });
}

function renderGameOver() {
  const sorted = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const host = isMeHost();

  els.gameoverSubtitle.textContent = state.room?.round_summary?.reason || 'ببینیم کی از همه بهتر بود';

  const podiumOrder = [
    { rank: 2, player: sorted[1], label: '۲' },
    { rank: 1, player: sorted[0], label: '۱' },
    { rank: 3, player: sorted[2], label: '۳' },
  ].filter((slot) => Boolean(slot.player));

  els.podiumContainer.innerHTML = podiumOrder
    .map(
      (s) => `
        <div class="podium-slot podium-rank-${s.rank}">
          <div class="podium-avatar">${escapeHtml(s.player.avatar)}</div>
          <div class="podium-name">${escapeHtml(s.player.name)}</div>
          <div class="podium-score">${toPersianDigits(s.player.score || 0)} امتیاز</div>
          <div class="podium-bar">${s.label}</div>
        </div>
      `
    )
    .join('');

  els.finalLeaderboard.innerHTML = sorted
    .map(
      (p, i) => `
        <li class="leaderboard-row ${p.id === state.myId ? 'is-me' : ''}">
          <div class="lb-left">
            <span>#${toPersianDigits(i + 1)}</span>
            <span>${escapeHtml(p.avatar)}</span>
            <span>${escapeHtml(p.name)}${p.id === state.myId ? ' (خودت)' : ''}</span>
          </div>
          <span class="lb-score">${toPersianDigits(p.score || 0)} امتیاز</span>
        </li>
      `
    )
    .join('');

  els.btnPlayAgain.classList.toggle('hidden', !host);
  els.gameoverWaitHost.classList.toggle('hidden', host);
}

document.addEventListener('DOMContentLoaded', init);
