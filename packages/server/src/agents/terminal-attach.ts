export interface TerminalOutputChunk {
  seq: number;
  data: string;
}

export interface TerminalSnapshotState {
  cursor: number;
  data: string;
}

export type TerminalAttachResponse =
  | {
      mode: "snapshot";
      terminalId: string;
      output: string[];
      cursor: number;
    }
  | {
      mode: "replay";
      terminalId: string;
      chunks: TerminalOutputChunk[];
      cursor: number;
    };

export function buildTerminalSnapshotOutput(options: {
  outputBuffer: TerminalOutputChunk[];
  persistedSnapshot?: TerminalSnapshotState | null;
  history?: string;
}): { output: string[]; cursor: number } {
  const { outputBuffer, persistedSnapshot, history } = options;

  if (persistedSnapshot) {
    const output = [persistedSnapshot.data];
    let cursor = persistedSnapshot.cursor;
    let nextSeq = persistedSnapshot.cursor + 1;

    for (const chunk of outputBuffer) {
      if (chunk.seq < nextSeq) {
        continue;
      }
      if (chunk.seq !== nextSeq) {
        break;
      }

      output.push(chunk.data);
      cursor = chunk.seq;
      nextSeq += 1;
    }

    return { output, cursor };
  }

  if (outputBuffer.length > 0) {
    return {
      output: outputBuffer.map((chunk) => chunk.data),
      cursor: outputBuffer[outputBuffer.length - 1].seq,
    };
  }

  if (history) {
    return { output: [history], cursor: 0 };
  }

  return { output: [], cursor: 0 };
}

export function buildTerminalAttachResponse(options: {
  terminalId: string;
  requestedCursor?: number;
  outputBuffer: TerminalOutputChunk[];
  snapshotOutput: string[];
  snapshotCursor: number;
}): TerminalAttachResponse {
  const { terminalId, requestedCursor, outputBuffer, snapshotOutput, snapshotCursor } = options;

  if (
    requestedCursor !== undefined &&
    requestedCursor > 0 &&
    requestedCursor <= snapshotCursor &&
    outputBuffer.length > 0
  ) {
    const firstBufferedSeq = outputBuffer[0].seq;
    const replayStartSeq = requestedCursor + 1;

    if (replayStartSeq >= firstBufferedSeq) {
      return {
        mode: "replay",
        terminalId,
        chunks: outputBuffer.filter((chunk) => chunk.seq >= replayStartSeq),
        cursor: snapshotCursor,
      };
    }
  }

  return {
    mode: "snapshot",
    terminalId,
    output: snapshotOutput,
    cursor: snapshotCursor,
  };
}
