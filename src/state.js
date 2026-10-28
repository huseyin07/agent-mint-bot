import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Basit, atomik yazılan JSON durum dosyası. Railway volume üzerinde durur,
// böylece yeniden başlatmada aynı kontratı iki kez mint etmeye çalışmaz.

const EMPTY = () => ({
  lastBlock: null,
  paused: false,
  // address -> { status, reason, at, txHash? }
  contracts: {},
  // address -> { firstSeen, nextTry }
  pendingVerify: {},
  daily: { date: today(), mints: 0, gasWei: '0' },
  // execute çağrıldı ama makbuz henüz görülmedi
  inflight: {},
});

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export class State {
  constructor(path) {
    this.path = path;
    this.data = EMPTY();
    try {
      this.data = { ...EMPTY(), ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch {
      // ilk çalıştırma
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  rollDay() {
    if (this.data.daily.date !== today()) {
      this.data.daily = { date: today(), mints: 0, gasWei: '0' };
      this.save();
    }
    return this.data.daily;
  }

  known(address) {
    return Boolean(this.data.contracts[address.toLowerCase()]);
  }

  mark(address, status, extra = {}) {
    this.data.contracts[address.toLowerCase()] = { status, at: new Date().toISOString(), ...extra };
    delete this.data.pendingVerify[address.toLowerCase()];
    this.save();
  }

  addGas(wei) {
    const d = this.rollDay();
    d.gasWei = (BigInt(d.gasWei) + BigInt(wei)).toString();
    this.save();
  }
}
