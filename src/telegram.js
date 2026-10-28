// Minimal Telegram Bot API istemcisi (bağımlılık yok). Sadece TELEGRAM_CHAT_ID'den
// gelen komutları dinler; başka sohbetlerden gelen mesajlar yok sayılır.

export class Telegram {
  constructor(token, chatId, log = console) {
    this.token = token;
    this.chatId = String(chatId || '');
    this.log = log;
    this.offset = 0;
    this.handlers = new Map();
  }

  get enabled() {
    return Boolean(this.token && this.chatId);
  }

  async api(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    // Token asla loga yazılmaz; sadece Telegram'ın hata açıklaması.
    if (!j.ok) throw new Error(`Telegram ${method}: ${j.error_code || res.status} ${j.description || ''}`.trim());
    return j;
  }

  async send(text) {
    if (!this.enabled) {
      this.log.info(`[telegram kapalı] ${text}`);
      return;
    }
    try {
      await this.api('sendMessage', { chat_id: this.chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
    } catch (e) {
      this.log.error(`telegram gönderilemedi: ${e.message}`);
    }
  }

  on(command, handler) {
    this.handlers.set(command, handler);
  }

  async pollForever() {
    if (!this.enabled) return;
    const chatOk = /^-?\d+$/.test(this.chatId);
    this.log.info(`telegram açık, chat id ${chatOk ? 'sayısal' : 'SAYI DEĞİL (hatalı olabilir)'}`);
    for (;;) {
      try {
        const r = await this.api('getUpdates', { offset: this.offset, timeout: 30, allowed_updates: ['message'] });
        for (const u of r.result || []) {
          this.offset = u.update_id + 1;
          const msg = u.message;
          if (!msg || String(msg.chat?.id) !== this.chatId) continue;
          const cmd = String(msg.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
          const h = this.handlers.get(cmd);
          if (h) {
            Promise.resolve(h(msg)).catch((e) => this.send(`Komut hatası: ${e.message}`));
          }
        }
      } catch (e) {
        this.log.error(`telegram poll: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
