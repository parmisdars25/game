/**
 * توابع کمکی هوشمند برای پردازش زبان فارسی، بررسی حدس‌ها، امتیازدهی و ابزارهای عمومی
 */

import { GAME_CONFIG } from './config.js';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * تبدیل ارقام انگلیسی به ارقام فارسی برای نمایش زیبا در رابط کاربری
 */
export function toPersianDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * ایمن‌سازی متن برای جلوگیری از تزریق HTML
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * نرمال‌سازی پیشرفته متن فارسی:
 * - یکسان‌سازی ی/ي/ى، ک/ك، آ/أ/إ/ا، ة/ۀ/ه، ؤ/و، ئ/ی
 * - حذف اعراب، تشدید، کشیده (ـ) و علائم نگارشی
 * - حالت compact: حذف کامل فاصله و نیم‌فاصله (مثلاً «بستنی قیفی» = «بستنی‌قیفی» = «بستنیقیفی»)
 * @param {string} text
 * @param {boolean} compact
 * @returns {string}
 */
export function normalizePersian(text, compact = false) {
  if (!text) return '';

  let s = String(text)
    .trim()
    .toLowerCase()
    .replace(/[يیىئ]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/[آأإا]/g, 'ا')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/ؤ/g, 'و')
    // حذف حرکات، اعراب و کشیده
    .replace(/[ً-ٰٟـ]/g, '')
    // حذف علائم نگارشی رایج
    .replace(/[.,!؟?،؛:"'«»()\[\]{}\-_+=/\|<>~`@#$%^&*]/g, ' ');

  if (compact) {
    return s.replace(/[\s‌‍]+/g, '');
  }

  return s
    .replace(/[‌‍]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * محاسبه فاصله لونشتاین (حداقل تعداد تغییرات تک‌حرفی بین دو رشته)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const chA = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = chA === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // حذف
        curr[j - 1] + 1,  // درج
        prev[j - 1] + cost // جایگزینی
      );
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

/**
 * ارزیابی هوشمند حدس بازیکن در برابر کلمه مخفی
 * خروجی:
 *  - 'exact' : حدس کاملاً درست
 *  - 'close' : فقط ۱ حرف اختلاف دارد (خیلی نزدیک بودی 🔥)
 *  - 'wrong' : حدس نادرست
 * @param {string} guessText
 * @param {string} targetWord
 * @returns {'exact' | 'close' | 'wrong'}
 */
export function evaluateGuess(guessText, targetWord) {
  const guessCompact = normalizePersian(guessText, true);
  const targetCompact = normalizePersian(targetWord, true);

  if (!guessCompact || !targetCompact) return 'wrong';

  if (guessCompact === targetCompact) {
    return 'exact';
  }

  // برای جلوگیری از اخطار الکی در کلمات دوحرفی مثل «پا» یا «مو»، شرط طول >= ۳ می‌گذاریم
  if (targetCompact.length >= 3) {
    const dist = levenshteinDistance(guessCompact, targetCompact);
    if (dist === 1) {
      return 'close';
    }
  }

  return 'wrong';
}

/**
 * بررسی ضد-اسپویل برای پیام‌های نقاش یا برنده‌ها
 * جلوگیری از لو رفتن ناخواسته کلمه اصلی در چت
 * @param {string} text
 * @param {string} targetWord
 * @returns {boolean}
 */
export function containsTargetWord(text, targetWord) {
  const targetCompact = normalizePersian(targetWord, true);
  const textCompact = normalizePersian(text, true);

  if (!targetCompact || !textCompact) return false;
  if (textCompact.includes(targetCompact)) return true;

  // بررسی تک‌تک کلمات پیام در برابر کلمه هدف
  const tokens = normalizePersian(text, false).split(' ').filter(Boolean);
  for (const token of tokens) {
    if (token === targetCompact) return true;
    if (targetCompact.length >= 4 && levenshteinDistance(token, targetCompact) <= 1) {
      return true;
    }
  }

  return false;
}

/**
 * استخراج ساختار خط‌تیره‌های کلمه مخفی برای نمایش در هدر بازی
 * مثال: «بستنی قیفی» -> { parts: ['بستنی', 'قیفی'], totalLetters: 9, metaText: '۲ کلمه (۵ + ۴ حرف)' }
 * @param {string} word
 */
export function getWordStructure(word) {
  if (!word) {
    return { parts: [], totalLetters: 0, metaText: '' };
  }

  const parts = String(word).trim().split(/\s+/).filter(Boolean);
  const lengths = parts.map((p) => Array.from(p).length);
  const totalLetters = lengths.reduce((sum, n) => sum + n, 0);

  let metaText = `${toPersianDigits(totalLetters)} حرف`;
  if (parts.length > 1) {
    const breakdown = lengths.map((n) => toPersianDigits(n)).join(' + ');
    metaText = `${toPersianDigits(parts.length)} کلمه (${breakdown} حرف)`;
  }

  return { parts, totalLetters, metaText };
}

/**
 * محاسبه امتیاز حدس‌زننده بر اساس ترتیب حدس و سرعت عمل
 * @param {number} guessOrder - ۱ برای نفر اول، ۲ برای نفر دوم و...
 * @param {number} remainingSec - ثانیه باقی‌مانده
 * @param {number} totalRoundSec - کل زمان راند
 * @returns {number}
 */
export function calculateGuesserPoints(guessOrder, remainingSec, totalRoundSec) {
  const table = GAME_CONFIG.GUESS_POINTS_BY_ORDER;
  const idx = Math.max(0, Math.min(guessOrder - 1, table.length - 1));
  let points = table[idx];

  // پاداش سرعت در صورت حدس در نیمه اول زمان راند
  if (totalRoundSec > 0 && remainingSec >= totalRoundSec * 0.5) {
    points += GAME_CONFIG.SPEED_BONUS_POINTS;
  }

  return points;
}

/**
 * محاسبه امتیاز نقاش به ازای تعداد کسانی که کلمه را درست حدس زدند
 * @param {number} correctGuessersCount
 * @returns {number}
 */
export function calculateDrawerPoints(correctGuessersCount) {
  if (!correctGuessersCount || correctGuessersCount <= 0) return 0;
  return Math.min(
    correctGuessersCount * GAME_CONFIG.DRAWER_POINTS_PER_GUESS,
    GAME_CONFIG.DRAWER_MAX_ROUND_POINTS
  );
}

/**
 * تولید کد اتاق خوانا و کوتاه (بدون حروف مشابه مثل O/0 و I/1/L)
 */
export function generateRoomCode(length = GAME_CONFIG.ROOM_CODE_LENGTH) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * تولید شناسه یکتای بازیکن
 */
export function generatePlayerId() {
  const rand = Math.random().toString(36).slice(2, 9);
  return `p_${Date.now().toString(36)}_${rand}`;
}

/**
 * برهم‌زدن تصادفی آرایه بدون تغییر آرایه اصلی
 */
export function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * کپی ایمن متن در کلیپ‌بورد با پشتیبانی از مرورگرهای موبایل
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback در ادامه اجرا می‌شود
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
