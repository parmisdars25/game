/**
 * لایه ارتباطی و همگام‌سازی لحظه‌ای با Supabase
 * - مدیریت جدول‌های rooms، players و messages با Postgres Changes
 * - انتقال فوق‌سریع خطوط نقاشی با Realtime Broadcast (بدون پر کردن دیتابیس)
 * - تشخیص آنلاین/آفلاین بودن بازیکنان با Realtime Presence برای انتقال خودکار میزبان
 */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GAME_CONFIG } from './config.js';
import { generateRoomCode } from './utils.js';

class NetworkManager {
  constructor() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('کتابخانه Supabase بارگذاری نشده است. اتصال اینترنت خود را بررسی کنید.');
    }

    this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      realtime: {
        params: {
          eventsPerSecond: 30,
        },
      },
    });

    this.channel = null;
    this.roomCode = null;
    this.playerId = null;
    this.serverOffsetMs = 0; // اختلاف ساعت محلی با سرور برای دقت تایمر
  }

  /**
   * زمان دقیق فعلی هماهنگ‌شده با سرور
   */
  getServerNowMs() {
    return Date.now() + this.serverOffsetMs;
  }

  _calibrateClock(serverIsoString) {
    if (!serverIsoString) return;
    const serverMs = new Date(serverIsoString).getTime();
    if (!Number.isFinite(serverMs)) return;
    const diff = serverMs - Date.now();
    // فقط در صورت معقول بودن اختلاف (کمتر از ۲۴ ساعت) اعمال می‌شود
    if (Math.abs(diff) < 86400000) {
      this.serverOffsetMs = diff;
    }
  }

  /**
   * ساخت اتاق جدید و اضافه کردن سازنده به عنوان میزبان
   */
  async createRoom(player) {
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode(GAME_CONFIG.ROOM_CODE_LENGTH);

      const { data: room, error: roomErr } = await this.client
        .from('rooms')
        .insert({
          code,
          host_id: player.id,
          status: 'lobby',
          settings: { ...GAME_CONFIG.DEFAULT_SETTINGS },
        })
        .select()
        .single();

      if (roomErr) {
        // در صورت تکراری بودن کد اتاق، یک کد جدید امتحان می‌کنیم
        if (roomErr.code === '23505') {
          lastError = roomErr;
          continue;
        }
        throw new Error(`خطا در ساخت اتاق: ${roomErr.message}`);
      }

      this._calibrateClock(room.created_at);

      const { data: playerRow, error: playerErr } = await this.client
        .from('players')
        .insert({
          id: player.id,
          room_code: code,
          name: player.name,
          avatar: player.avatar,
          is_ready: false,
        })
        .select()
        .single();

      if (playerErr) {
        await this.client.from('rooms').delete().eq('code', code);
        throw new Error(`خطا در ثبت بازیکن: ${playerErr.message}`);
      }

      this._calibrateClock(playerRow.joined_at);
      return { room, player: playerRow };
    }

    throw new Error(lastError?.message || 'امکان ساخت کد اتاق یکتا وجود نداشت.');
  }

  /**
   * ورود به اتاق موجود با کد اتاق
   */
  async joinRoom(rawCode, player) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) {
      throw new Error('لطفاً کد اتاق را وارد کنید.');
    }

    const { data: room, error: roomErr } = await this.client
      .from('rooms')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (roomErr) {
      throw new Error(`خطا در اتصال به سرور: ${roomErr.message}`);
    }
    if (!room) {
      throw new Error('اتاقی با این کد پیدا نشد. کد را دوباره بررسی کنید.');
    }

    const { data: existingPlayers, error: listErr } = await this.client
      .from('players')
      .select('*')
      .eq('room_code', code);

    if (listErr) {
      throw new Error(`خطا در دریافت لیست بازیکنان: ${listErr.message}`);
    }

    const alreadyIn = (existingPlayers || []).find((p) => p.id === player.id);
    if (alreadyIn) {
      return { room, player: alreadyIn, players: existingPlayers };
    }

    if ((existingPlayers || []).length >= GAME_CONFIG.MAX_PLAYERS) {
      throw new Error('ظرفیت این اتاق تکمیل شده است (حداکثر ۱۰ نفر).');
    }

    if (room.status === 'finished') {
      throw new Error('بازی این اتاق به پایان رسیده است.');
    }

    const { data: playerRow, error: insertErr } = await this.client
      .from('players')
      .insert({
        id: player.id,
        room_code: code,
        name: player.name,
        avatar: player.avatar,
        is_ready: false,
      })
      .select()
      .single();

    if (insertErr) {
      throw new Error(`خطا در ورود به اتاق: ${insertErr.message}`);
    }

    this._calibrateClock(playerRow.joined_at);

    return {
      room,
      player: playerRow,
      players: [...(existingPlayers || []), playerRow],
    };
  }

  /**
   * بارگذاری کامل وضعیت فعلی اتاق (برای اتصال اولیه و بازیابی پس از رفرش)
   */
  async fetchRoomState(roomCode) {
    const [roomRes, playersRes, msgsRes] = await Promise.all([
      this.client.from('rooms').select('*').eq('code', roomCode).maybeSingle(),
      this.client.from('players').select('*').eq('room_code', roomCode).order('joined_at', { ascending: true }),
      this.client.from('messages').select('*').eq('room_code', roomCode).order('id', { ascending: true }).limit(120),
    ]);

    if (roomRes.error) throw roomRes.error;
    if (playersRes.error) throw playersRes.error;
    if (msgsRes.error) throw msgsRes.error;

    return {
      room: roomRes.data,
      players: playersRes.data || [],
      messages: msgsRes.data || [],
    };
  }

  /**
   * عضویت در کانال Realtime اتاق (دیتابیس + نقاشی Broadcast + Presence)
   */
  subscribeToRoom(roomCode, playerMeta, handlers = {}) {
    this.unsubscribe();

    this.roomCode = roomCode;
    this.playerId = playerMeta.id;

    const channel = this.client.channel(`room:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: playerMeta.id },
      },
    });

    // ۱. تغییرات جدول rooms
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          handlers.onRoomDeleted?.();
        } else if (payload.new) {
          handlers.onRoomUpdate?.(payload.new);
        }
      }
    );

    // ۲. تغییرات جدول players
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${roomCode}` },
      (payload) => {
        handlers.onPlayersChange?.(payload);
      }
    );

    // ۳. پیام‌های جدید چت
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_code=eq.${roomCode}` },
      (payload) => {
        if (payload.new) {
          handlers.onNewMessage?.(payload.new);
        }
      }
    );

    // ۴. رویدادهای نقاشی زنده (Broadcast)
    channel.on('broadcast', { event: 'draw' }, ({ payload }) => {
      if (payload) {
        handlers.onDrawEvent?.(payload);
      }
    });

    // ۵. حضور آنلاین بازیکنان (Presence)
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const onlineIds = Object.keys(state);
      handlers.onPresenceSync?.(onlineIds);
    });

    channel.on('presence', { event: 'leave' }, ({ key }) => {
      if (key) {
        handlers.onPresenceLeave?.(key);
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({
            playerId: playerMeta.id,
            name: playerMeta.name,
            onlineAt: new Date().toISOString(),
          });
        } catch {
          // خطای track مانع ادامه بازی نمی‌شود
        }
        handlers.onSubscribed?.();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handlers.onConnectionIssue?.(status);
      }
    });

    this.channel = channel;
    return channel;
  }

  async unsubscribe() {
    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      try {
        await ch.untrack();
      } catch {
        // ignore
      }
      try {
        await this.client.removeChannel(ch);
      } catch {
        // ignore
      }
    }
    this.roomCode = null;
  }

  /**
   * ارسال رویداد نقاشی از طریق WebSocket Broadcast
   */
  sendDrawEvent(payload) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'draw',
      payload,
    });
  }

  async updateRoom(roomCode, patch) {
    const { data, error } = await this.client
      .from('rooms')
      .update(patch)
      .eq('code', roomCode)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async deleteRoom(roomCode) {
    await this.client.from('rooms').delete().eq('code', roomCode);
  }

  async updatePlayer(playerId, patch) {
    const { data, error } = await this.client
      .from('players')
      .update(patch)
      .eq('id', playerId)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async resetAllPlayersForTurn(roomCode) {
    const { error } = await this.client
      .from('players')
      .update({
        has_guessed: false,
        guess_order: 0,
        round_score: 0,
      })
      .eq('room_code', roomCode);

    if (error) throw error;
  }

  async resetAllPlayersForLobby(roomCode) {
    const { error } = await this.client
      .from('players')
      .update({
        score: 0,
        is_ready: false,
        has_guessed: false,
        guess_order: 0,
        round_score: 0,
      })
      .eq('room_code', roomCode);

    if (error) throw error;
  }

  async removePlayer(playerId) {
    const { error } = await this.client
      .from('players')
      .delete()
      .eq('id', playerId);

    if (error) throw error;
  }

  async sendMessage(roomCode, { senderId = null, senderName = null, text, type = 'guess' }) {
    const { data, error } = await this.client
      .from('messages')
      .insert({
        room_code: roomCode,
        sender_id: senderId,
        sender_name: senderName,
        text,
        type,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async clearMessages(roomCode) {
    await this.client.from('messages').delete().eq('room_code', roomCode);
  }
}

export const network = new NetworkManager();
