import { createPublicClient, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

export function makeClient(rpcUrl) {
  return createPublicClient({ chain: bsc, transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }) });
}

const erc721 = parseAbi(['function balanceOf(address) view returns (uint256)']);

export async function alreadyHolds(client, contract, wallet) {
  try {
    const bal = await client.readContract({ address: contract, abi: erc721, functionName: 'balanceOf', args: [wallet] });
    return bal > 0n;
  } catch {
    return false; // balanceOf yoksa bilinmiyor say, önizleme ve simülasyon zaten yakalar
  }
}

/**
 * Yeni bloklardaki doğrudan kontrat yayınlarını (to = null) bulur.
 * Not: Fabrika kontratlarının içeriden yarattığı kontratları görmez.
 */
export class DeployWatcher {
  constructor(client, { pollMs, maxBlocksPerTick, startBlock, log }) {
    this.client = client;
    this.pollMs = pollMs;
    this.maxBlocksPerTick = maxBlocksPerTick;
    this.next = startBlock;
    this.log = log;
  }

  async tick(onDeploy) {
    const latest = await this.client.getBlockNumber();
    if (this.next === null || this.next === undefined) this.next = latest;
    // Çok geride kaldıysak eskiyi atla: bu iş "erken gelen kazanır", eski blok değersiz.
    if (latest - this.next > 300n) {
      this.log.warn(`${latest - this.next} blok geride, en yeniye atlanıyor`);
      this.next = latest - 5n;
    }
    const end = this.next + BigInt(this.maxBlocksPerTick) - 1n < latest ? this.next + BigInt(this.maxBlocksPerTick) - 1n : latest;
    for (let n = this.next; n <= end; n++) {
      const block = await this.client.getBlock({ blockNumber: n, includeTransactions: true });
      const creations = block.transactions.filter((tx) => tx.to === null);
      const receipts = await Promise.all(creations.map((tx) => this.client.getTransactionReceipt({ hash: tx.hash }).catch(() => null)));
      for (const r of receipts) {
        if (r?.status === 'success' && r.contractAddress) await onDeploy(r.contractAddress, n);
      }
      this.next = n + 1n;
    }
    return this.next;
  }

  async run(onDeploy, onProgress) {
    for (;;) {
      try {
        const next = await this.tick(onDeploy);
        onProgress?.(next);
      } catch (e) {
        this.log.error(`izleyici: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }
}
