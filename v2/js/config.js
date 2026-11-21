/**
 * تنظیمات اتصال Supabase و ثابت‌های اصلی بازی «بکش و بگو!» (نسخه ۲)
 */

export const SUPABASE_URL = 'https://pyjubwgfxpdwvztedhxt.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VavAsWLbimqMmk4m9oFKvA_OyrA1nY8';

export const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  ROOM_CODE_LENGTH: 5,

  // زمان‌بندی‌های کلیدی (بر حسب ثانیه)
  COUNTDOWN_SECONDS: 3,
  WORD_CHOICE_SECONDS: 12,
  ROUND_END_SECONDS: 5,

  // تسریع تایمر پس از اولین حدس درست
  ACCELERATE_MIN_REMAINING: 22,
  ACCELERATE_TARGET_MAX: 35,

  // امتیازدهی
  GUESS_POINTS_BY_ORDER: [12, 10, 8, 7, 6, 5, 4],
  SPEED_BONUS_POINTS: 2,      // پاداش حدس در نیمه اول زمان
  DRAWER_POINTS_PER_GUESS: 3, // امتیاز نقاش به ازای هر حدس درست
  DRAWER_MAX_ROUND_POINTS: 15,

  // تنظیمات پیش‌فرض اتاق
  DEFAULT_SETTINGS: {
    mode: 'rounds',       // 'rounds' | 'score'
    targetValue: 3,       // ۳ دور یا ۵۰ امتیاز
    roundTime: 90,        // ثانیه
    categories: ['all'],  // ['all'] یا لیستی از کلید دسته‌ها
  },

  // گزینه‌های قابل انتخاب در لابی
  ROUND_OPTIONS: [
    { value: 2, label: '۲ دور کامل (کوتاه)' },
    { value: 3, label: '۳ دور کامل (استاندارد)' },
    { value: 4, label: '۴ دور کامل (مفصل)' },
    { value: 5, label: '۵ دور کامل (طولانی)' },
  ],
  SCORE_OPTIONS: [
    { value: 30, label: '۳۰ امتیاز (سریع)' },
    { value: 50, label: '۵۰ امتیاز (متعادل)' },
    { value: 80, label: '۸۰ امتیاز (مفصل)' },
    { value: 100, label: '۱۰۰ امتیاز (ماراتن)' },
  ],

  // کاراکترهای صفحه ورود
  AVATARS: [
    '🦊', '🐼', '🦁', '🐸', '🦄', '🐙',
    '🦖', '🐝', '🦋', '🐱', '🐶', '🐨',
    '🦉', '🐧', '🤖', '👻', '🧙', '🥷',
  ],

  // پالت ۱۲ رنگ اصلی بوم نقاشی
  PALETTE: [
    { hex: '#111827', name: 'مشکی' },
    { hex: '#FFFFFF', name: 'سفید' },
    { hex: '#9CA3AF', name: 'خاکستری' },
    { hex: '#EF4444', name: 'قرمز' },
    { hex: '#F97316', name: 'نارنجی' },
    { hex: '#FACC15', name: 'زرد' },
    { hex: '#22C55E', name: 'سبز' },
    { hex: '#06B6D4', name: 'فیروزه‌ای' },
    { hex: '#2563EB', name: 'آبی' },
    { hex: '#8B5CF6', name: 'بنفش' },
    { hex: '#EC4899', name: 'صورتی' },
    { hex: '#92400E', name: 'قهوه‌ای' },
  ],

  // ۴ سایز قلم به صورت نسبی نسبت به عرض بوم (۴:۳)
  BRUSH_SIZES: [
    { id: 'sm', ratio: 0.0055, dotPx: 6,  label: 'نازک' },
    { id: 'md', ratio: 0.0125, dotPx: 10, label: 'متوسط' },
    { id: 'lg', ratio: 0.0240, dotPx: 15, label: 'ضخیم' },
    { id: 'xl', ratio: 0.0420, dotPx: 20, label: 'خیلی ضخیم' },
  ],

  // دسته‌بندی‌های بانک کلمات (تمیز و بدون شلوغی ایموجی)
  CATEGORIES: [
    { id: 'all',       label: 'همه موضوعات' },
    { id: 'animals',   label: 'حیوانات' },
    { id: 'food',      label: 'غذا و خوراکی' },
    { id: 'objects',   label: 'اشیا و وسایل' },
    { id: 'nature',    label: 'طبیعت و فضا' },
    { id: 'places',    label: 'مکان‌ها و بناها' },
    { id: 'jobs',      label: 'مشاغل و شخصیت‌ها' },
    { id: 'sports',    label: 'ورزش و سرگرمی' },
    { id: 'vehicles',  label: 'وسایل نقلیه' },
    { id: 'body',      label: 'پوشاک و بدن' },
    { id: 'actions',   label: 'افعال و مفاهیم' },
  ],
};
