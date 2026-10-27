export interface RetransmitEntry {
  seq: number
  peerKey: string
  send: () => void
}

export interface RetransmitterOptions {
  intervalMs?: number
  maxTries?: number
  onFailed?: (peerKey: string, seq: number) => void
}

const DEFAULT_INTERVAL_MS = 4_000
const DEFAULT_MAX_TRIES = 4

interface Pending extends RetransmitEntry {
  tries: number
  timer: ReturnType<typeof setTimeout>
}

export class Retransmitter {
  private readonly intervalMs: number
  private readonly maxTries: number
  private readonly onFailed: (peerKey: string, seq: number) => void
  private readonly pending = new Map<number, Pending>()

  constructor(options: RetransmitterOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.maxTries = options.maxTries ?? DEFAULT_MAX_TRIES
    this.onFailed = options.onFailed ?? (() => undefined)
  }

  add(entry: RetransmitEntry): void {
    this.drop(entry.seq)
    const pending: Pending = {
      ...entry,
      tries: 0,
      timer: setTimeout(() => this.fire(entry.seq), this.intervalMs)
    }
    pending.timer.unref()
    this.pending.set(entry.seq, pending)
  }

  ack(seq: number): void {
    this.drop(seq)
  }

  stop(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
  }

  size(): number {
    return this.pending.size
  }

  private fire(seq: number): void {
    const pending = this.pending.get(seq)
    if (pending === undefined) return
    pending.tries += 1
    if (pending.tries > this.maxTries) {
      this.pending.delete(seq)
      this.onFailed(pending.peerKey, seq)
      return
    }
    pending.send()
    pending.timer = setTimeout(() => this.fire(seq), this.intervalMs)
    pending.timer.unref()
  }

  private drop(seq: number): void {
    const pending = this.pending.get(seq)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(seq)
  }
}
