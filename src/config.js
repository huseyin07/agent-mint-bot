// Tüm ayarlar ortam değişkenlerinden gelir. Cüzdanla ilgili gizli bilgi burada YOK:
// baw oturumu BINANCE_BAW_DIR klasöründe, baw'ın kendisi tarafından tutulur.

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name, fallback) {
  const v = Number(env(name, fallback));
  if (!Number.isFinite(v)) throw new Error(`${name} sayı olmalı`);
  return v;
}

function bool(name, fallback) {
  const v = String(env(name, fallback)).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

const wallet = env('AGENT_WALLET', '');
if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
  throw new Error('AGENT_WALLET geçerli bir 0x adresi olmalı (Agentic Wallet BSC adresin).');
}

export const config = {
  // Zincir
  chainId: 56,
  rpcUrl: env('BSC_RPC_URL', 'https://bsc-rpc.publicnode.com'),
  pollMs: num('POLL_MS', 3000),
  maxBlocksPerTick: num('MAX_BLOCKS_PER_TICK', 20),

  // Agent ID registry: kontrat bytecode'unda bu adres geçiyorsa aday sayılır.
  agentRegistry: env('AGENT_REGISTRY', '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F'),

  // Cüzdan
  wallet,
  bawBin: env('BAW_BIN', 'baw'),

  // Doğrulama
  etherscanApiKey: env('ETHERSCAN_API_KEY', ''),
  requireExactMatch: bool('REQUIRE_EXACT_MATCH', 'false'),
  unverifiedRetryMinutes: num('UNVERIFIED_RETRY_MINUTES', 5),
  unverifiedGiveUpHours: num('UNVERIFIED_GIVE_UP_HOURS', 6),

  // Limitler (güvenlik tavanları)
  dryRun: bool('DRY_RUN', 'true'),
  maxMintsPerDay: num('MAX_MINTS_PER_DAY', 15),
  maxGasBnbPerDay: num('MAX_GAS_BNB_PER_DAY', 0.0005),
  minBnbReserve: num('MIN_BNB_RESERVE', 0.0003),
  maxQuantity: num('MAX_QUANTITY', 1),

  // Telegram
  telegramToken: env('TELEGRAM_BOT_TOKEN', ''),
  telegramChatId: env('TELEGRAM_CHAT_ID', ''),

  // Kalıcı durum (Railway volume üzerinde olmalı)
  statePath: env('STATE_PATH', './data/state.json'),
};
