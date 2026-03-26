const MAX_RECENT_TERMINAL_INPUTS = 10;

function removeLastCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

function removeLastWord(value: string): string {
  const chars = Array.from(value);
  while (chars.length > 0 && /\s/.test(chars[chars.length - 1] ?? "")) {
    chars.pop();
  }
  while (chars.length > 0 && !/\s/.test(chars[chars.length - 1] ?? "")) {
    chars.pop();
  }
  return chars.join("");
}

function commitInput(recentInputs: string[], currentLine: string) {
  const normalized = currentLine.trimEnd();
  if (!normalized.trim()) {
    return;
  }
  recentInputs.push(normalized);
}

export function applyTerminalInputChunk(
  currentLine: string,
  data: string
): { currentLine: string; committedInputs: string[] } {
  let nextLine = currentLine;
  const committedInputs: string[] = [];

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];

    if (!char) continue;

    if (char === "\x1b") {
      while (index + 1 < data.length) {
        const nextChar = data[index + 1];
        if (!nextChar) break;
        if (/[A-Za-z~]/.test(nextChar)) {
          index += 1;
          break;
        }
        if (nextChar === "[" || nextChar === "]" || /[0-9;?]/.test(nextChar)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (char === "\r" || char === "\n") {
      commitInput(committedInputs, nextLine);
      nextLine = "";
      if (char === "\r" && data[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "\u0003") {
      nextLine = "";
      continue;
    }

    if (char === "\u0008" || char === "\u007f") {
      nextLine = removeLastCharacter(nextLine);
      continue;
    }

    if (char === "\u0015") {
      nextLine = "";
      continue;
    }

    if (char === "\u0017") {
      nextLine = removeLastWord(nextLine);
      continue;
    }

    if (char < " ") {
      continue;
    }

    nextLine += char;
  }

  return { currentLine: nextLine, committedInputs };
}

export function appendRecentTerminalInputs(
  recentInputs: string[],
  inputs: string[]
): string[] {
  const nextRecentInputs = recentInputs.slice(-MAX_RECENT_TERMINAL_INPUTS);

  for (const input of inputs) {
    commitInput(nextRecentInputs, input);
  }

  return nextRecentInputs.slice(-MAX_RECENT_TERMINAL_INPUTS);
}

export { MAX_RECENT_TERMINAL_INPUTS };
