export interface TerminalOutputChunk {
  seq: number;
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
