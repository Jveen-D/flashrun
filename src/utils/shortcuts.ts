export interface ShortcutDefinition {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
]);

export function isMacPlatform() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function getDefaultTerminalShortcut(): ShortcutDefinition {
  const isMac = isMacPlatform();
  return {
    code: 'KeyJ',
    key: 'J',
    ctrlKey: !isMac,
    metaKey: isMac,
    altKey: false,
    shiftKey: false,
  };
}

export function sanitizeShortcutDefinition(value: Partial<ShortcutDefinition> | null | undefined): ShortcutDefinition {
  const fallback = getDefaultTerminalShortcut();
  const shortcut = {
    code: typeof value?.code === 'string' && value.code ? value.code : fallback.code,
    key: typeof value?.key === 'string' && value.key ? normalizeShortcutKeyLabel(value.key, value.code ?? fallback.code) : fallback.key,
    ctrlKey: Boolean(value?.ctrlKey),
    metaKey: Boolean(value?.metaKey),
    altKey: Boolean(value?.altKey),
    shiftKey: Boolean(value?.shiftKey),
  };

  return hasShortcutModifier(shortcut) ? shortcut : fallback;
}

export function formatShortcut(shortcut: ShortcutDefinition) {
  const parts: string[] = [];
  const isMac = isMacPlatform();

  if (shortcut.ctrlKey) {
    parts.push(isMac ? 'Control' : 'Ctrl');
  }
  if (shortcut.metaKey) {
    parts.push(isMac ? 'Command' : 'Meta');
  }
  if (shortcut.altKey) {
    parts.push(isMac ? 'Option' : 'Alt');
  }
  if (shortcut.shiftKey) {
    parts.push('Shift');
  }

  parts.push(normalizeShortcutKeyLabel(shortcut.key, shortcut.code));
  return parts.join(' + ');
}

export function toGlobalShortcutAccelerator(shortcut: ShortcutDefinition) {
  const parts: string[] = [];
  const isMac = isMacPlatform();

  if (shortcut.ctrlKey) {
    parts.push('Control');
  }
  if (shortcut.metaKey) {
    parts.push(isMac ? 'Command' : 'Super');
  }
  if (shortcut.altKey) {
    parts.push('Alt');
  }
  if (shortcut.shiftKey) {
    parts.push('Shift');
  }

  parts.push(normalizeShortcutAcceleratorKey(shortcut));
  return parts.join('+');
}




export function eventMatchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition) {
  return !event.repeat
    && event.code === shortcut.code
    && event.ctrlKey === shortcut.ctrlKey
    && event.metaKey === shortcut.metaKey
    && event.altKey === shortcut.altKey
    && event.shiftKey === shortcut.shiftKey;
}

export function createShortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutDefinition | null {
  if (MODIFIER_CODES.has(event.code)) {
    return null;
  }

  return {
    code: event.code,
    key: normalizeShortcutKeyLabel(event.key, event.code),
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

export function hasShortcutModifier(shortcut: ShortcutDefinition) {
  return shortcut.ctrlKey || shortcut.metaKey || shortcut.altKey || shortcut.shiftKey;
}

function normalizeShortcutKeyLabel(rawKey: string | undefined, code: string) {
  const key = (rawKey || '').trim();
  if (!key) {
    return normalizeShortcutCodeLabel(code);
  }

  const lookup: Record<string, string> = {
    ' ': 'Space',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };

  if (lookup[key]) {
    return lookup[key];
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key[0].toUpperCase() + key.slice(1);
}

function normalizeShortcutCodeLabel(code: string) {
  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }

  const lookup: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
  };

  return lookup[code] || code;
}

function normalizeShortcutAcceleratorKey(shortcut: ShortcutDefinition) {
  const normalizedKey = normalizeShortcutKeyLabel(shortcut.key, shortcut.code);
  const lookup: Record<string, string> = {
    Space: 'Space',
    Esc: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    '↑': 'Up',
    '↓': 'Down',
    '←': 'Left',
    '→': 'Right',
  };

  if (lookup[normalizedKey]) {
    return lookup[normalizedKey];
  }

  if (normalizedKey.length === 1) {
    return normalizedKey.toUpperCase();
  }

  return normalizeShortcutCodeLabel(shortcut.code);
}

