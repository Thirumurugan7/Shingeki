/**
 * A dedicated financial account for one agent, scoped by design. The wallet
 * is the account layer where balances are enforced: it can never go negative,
 * so an agent cannot spend money it does not have.
 */
import { toMinor, toMajor } from './money.js';

export interface WalletState {
  agentId: string;
  currency: string;
  /** Integer minor units (e.g. cents). */
  balanceMinor: number;
}

export interface WalletOptions {
  currency?: string;
  /** Opening balance in major units. */
  balance?: number;
}

export class AgentWallet {
  readonly agentId: string;
  readonly currency: string;
  private balanceMinor: number;

  constructor(agentId: string, opts: WalletOptions = {}) {
    this.agentId = agentId;
    this.currency = opts.currency ?? 'USD';
    this.balanceMinor = opts.balance != null ? toMinor(opts.balance) : 0;
    if (this.balanceMinor < 0) throw new Error('opening balance cannot be negative');
  }

  /** Current balance in major units. */
  get balance(): number {
    return toMajor(this.balanceMinor);
  }

  /** Add funds to the wallet. */
  credit(amount: number): number {
    const m = toMinor(amount);
    if (m < 0) throw new Error('credit amount cannot be negative');
    this.balanceMinor += m;
    return this.balance;
  }

  /** True when the wallet holds at least `amount`. */
  canAfford(amount: number): boolean {
    return this.balanceMinor >= toMinor(amount);
  }

  /**
   * Remove funds. Throws if the wallet cannot cover the amount — the
   * structural guarantee that an agent never overdraws.
   */
  debit(amount: number): number {
    const m = toMinor(amount);
    if (m < 0) throw new Error('debit amount cannot be negative');
    if (m > this.balanceMinor) {
      throw new Error(
        `insufficient funds: balance ${this.balance} < debit ${toMajor(m)} ${this.currency}`,
      );
    }
    this.balanceMinor -= m;
    return this.balance;
  }

  toJSON(): WalletState {
    return { agentId: this.agentId, currency: this.currency, balanceMinor: this.balanceMinor };
  }

  static fromJSON(s: WalletState): AgentWallet {
    const w = new AgentWallet(s.agentId, { currency: s.currency });
    w.balanceMinor = Math.round(s.balanceMinor);
    return w;
  }
}
