// Kaynak kodu doğrulanmış mı? Önce Sourcify (ücretsiz, anahtarsız), sonra varsa
// Etherscan V2 API (BscScan için de geçerli, ETHERSCAN_API_KEY gerekir).

const SOURCIFY = 'https://sourcify.dev/server/v2/contract';
const ETHERSCAN = 'https://api.etherscan.io/v2/api';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fromSourcify(chainId, address, requireExact) {
  const j = await getJson(`${SOURCIFY}/${chainId}/${address}?fields=abi`);
  if (j.notFound || !j.match) return null;
  if (requireExact && j.match !== 'exact_match') return null;
  if (!Array.isArray(j.abi)) return null;
  return { abi: j.abi, source: 'sourcify', match: j.match };
}

async function fromEtherscan(chainId, address, apiKey) {
  if (!apiKey) return null;
  const q = new URLSearchParams({ chainid: String(chainId), module: 'contract', action: 'getsourcecode', address, apikey: apiKey });
  const j = await getJson(`${ETHERSCAN}?${q}`);
  const r = Array.isArray(j?.result) ? j.result[0] : null;
  if (!r || !r.SourceCode || !r.ABI || r.ABI.startsWith('Contract source code not verified')) return null;
  // Proxy kontratlar atlanır: mantık başka adreste, değiştirilebilir.
  if (r.Proxy === '1') return { proxy: true };
  return { abi: JSON.parse(r.ABI), source: 'bscscan', match: 'verified' };
}

/**
 * @returns {Promise<{status:'verified', abi:any[], source:string, match:string} | {status:'unverified'} | {status:'proxy'} | {status:'error', message:string}>}
 */
export async function lookupVerified(chainId, address, { requireExact = false, etherscanApiKey = '' } = {}) {
  let lastErr = null;
  for (const fn of [() => fromSourcify(chainId, address, requireExact), () => fromEtherscan(chainId, address, etherscanApiKey)]) {
    try {
      const r = await fn();
      if (r?.proxy) return { status: 'proxy' };
      if (r) return { status: 'verified', ...r };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) return { status: 'error', message: lastErr.message };
  return { status: 'unverified' };
}
