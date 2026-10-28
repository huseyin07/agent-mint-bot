import { execFile } from 'node:child_process';

// baw CLI için ince sarmalayıcı. Komutlar Binance'in resmi skill dokümanından:
// github.com/binance/binance-skills-hub/.../binance-agentic-wallet/references
// Her çağrı --json ile yapılır; cevap { success, data } ya da { success:false, error } olur.

export class Baw {
  constructor(bin = 'baw') {
    this.bin = bin;
  }

  run(args, timeoutMs = 60_000) {
    return new Promise((resolve) => {
      execFile(this.bin, [...args, '--json'], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        const text = String(stdout || '').trim();
        try {
          // Bazı sürümler JSON'dan önce satır basabiliyor; son JSON bloğunu al.
          const start = text.indexOf('{');
          resolve(JSON.parse(text.slice(start)));
        } catch {
          resolve({
            success: false,
            error: { name: 'BAW_EXEC_FAILED', message: err?.message || text || 'baw çıktısı okunamadı' },
          });
        }
      });
    });
  }

  status() {
    return this.run(['wallet', 'status']);
  }

  settings() {
    return this.run(['wallet', 'settings']);
  }

  signin() {
    return this.run(['auth', 'signin']);
  }

  // Kullanıcı Binance uygulamasında onaylayana kadar (en fazla ~5 dk) bekler.
  verify(qrCodeId) {
    return this.run(['auth', 'verify', '--qrCodeId', qrCodeId], 6 * 60_000);
  }

  // Değer HER ZAMAN 0. Bu fonksiyon başka bir değer kabul etmez.
  previewCall({ from, to, inputData }) {
    return this.run([
      'contract-call', 'preview',
      '--binanceChainId', '56',
      '--from', from,
      '--to', to,
      '--value', '0',
      '--inputData', inputData,
    ]);
  }

  execute(requestId) {
    return this.run(['contract-call', 'execute', '--requestId', requestId], 120_000);
  }
}
