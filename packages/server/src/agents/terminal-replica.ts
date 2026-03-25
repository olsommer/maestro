import headless from "@xterm/headless";
import serializePkg from "@xterm/addon-serialize";

const { Terminal: HeadlessTerminal } = headless;
const { SerializeAddon } = serializePkg;

export interface TerminalReplicaSnapshot {
  cursor: number;
  data: string;
  savedAt: number;
  cols: number;
  rows: number;
}

interface CreateTerminalReplicaOptions {
  cols?: number;
  rows?: number;
  scrollback?: number;
  snapshot?: Pick<TerminalReplicaSnapshot, "data" | "cols" | "rows"> | null;
}

export class TerminalReplica {
  private readonly terminal;
  private readonly serializeAddon;
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;
  private lastSnapshot: TerminalReplicaSnapshot;

  constructor(options: CreateTerminalReplicaOptions = {}) {
    const cols = options.snapshot?.cols ?? options.cols ?? 120;
    const rows = options.snapshot?.rows ?? options.rows ?? 30;
    const scrollback = options.scrollback ?? 50000;

    this.terminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
      convertEol: false,
      disableStdin: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);
    this.lastSnapshot = {
      cursor: 0,
      data: "",
      savedAt: Date.now(),
      cols,
      rows,
    };

    if (options.snapshot?.data) {
      void this.replaceSnapshot(
        {
          data: options.snapshot.data,
          cols,
          rows,
        },
        0
      );
    } else {
      this.refreshSnapshot(0);
    }
  }

  write(data: string, cursor: number): Promise<void> {
    return this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, () => {
            this.refreshSnapshot(cursor);
            resolve();
          });
        })
    );
  }

  resize(cols: number, rows: number, cursor: number): Promise<void> {
    return this.enqueue(() => {
      this.terminal.resize(cols, rows);
      this.refreshSnapshot(cursor);
    });
  }

  replaceSnapshot(
    snapshot: Pick<TerminalReplicaSnapshot, "data" | "cols" | "rows">,
    cursor: number
  ): Promise<void> {
    return this.enqueue(async () => {
      this.terminal.reset();
      if (this.terminal.cols !== snapshot.cols || this.terminal.rows !== snapshot.rows) {
        this.terminal.resize(snapshot.cols, snapshot.rows);
      }
      if (snapshot.data) {
        await new Promise<void>((resolve) => {
          this.terminal.write(snapshot.data, resolve);
        });
      }
      this.refreshSnapshot(cursor);
    });
  }

  async snapshot(): Promise<TerminalReplicaSnapshot> {
    await this.pending;
    return this.lastSnapshot;
  }

  dispose(): void {
    this.disposed = true;
    this.terminal.dispose();
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const next = this.pending.then(async () => {
      if (this.disposed) {
        return;
      }
      await operation();
    });
    this.pending = next.catch(() => undefined);
    return next;
  }

  private refreshSnapshot(cursor: number): void {
    this.lastSnapshot = {
      cursor,
      data: this.serializeAddon.serialize(),
      savedAt: Date.now(),
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }
}

export function createTerminalReplica(
  options: CreateTerminalReplicaOptions = {}
): TerminalReplica {
  return new TerminalReplica(options);
}
