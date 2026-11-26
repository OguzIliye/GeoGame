export type KeyActionId =
  | 'togglePause'
  | 'speedSlow'
  | 'speedNormal'
  | 'speedFast'
  | 'cycleArmy'
  | 'openBuildings'
  | 'openFactory'
  | 'openBarracks'
  | 'openScience'
  | 'openDiplomacy'
  | 'openSettings'
  | 'openTutorial';

export interface KeyActionSpec {
  id: KeyActionId;
  label: string;
  defaultCode: string;
}

export const KEY_ACTION_SPECS: KeyActionSpec[] = [
  { id: 'togglePause', label: 'Durdur / Devam Et', defaultCode: 'Space' },
  { id: 'speedSlow', label: 'Zaman Hızı 0.5x', defaultCode: 'Digit1' },
  { id: 'speedNormal', label: 'Zaman Hızı 1x', defaultCode: 'Digit2' },
  { id: 'speedFast', label: 'Zaman Hızı 2x', defaultCode: 'Digit3' },
  { id: 'cycleArmy', label: 'Sıradaki Orduya Zoomla', defaultCode: 'KeyQ' },
  { id: 'openBuildings', label: 'Binalar Penceresi', defaultCode: 'KeyB' },
  { id: 'openFactory', label: 'Fabrika Penceresi', defaultCode: 'KeyF' },
  { id: 'openBarracks', label: 'Kışla Penceresi', defaultCode: 'KeyK' },
  { id: 'openScience', label: 'Bilim Ağacı Penceresi', defaultCode: 'KeyT' },
  { id: 'openDiplomacy', label: 'Diplomasi Penceresi', defaultCode: 'KeyD' },
  { id: 'openSettings', label: 'Ayarlar Penceresi', defaultCode: 'KeyO' },
  { id: 'openTutorial', label: 'Nasıl Oynanır (Tutorial)', defaultCode: 'KeyH' },
];

const STORAGE_KEY = 'pixelworld_keybindings_v1';

const FORBIDDEN_CODES = new Set([
  'Escape', // Explicitly forbidden by DESIGN.md (web fullscreen conflict)
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export function formatKeyCodeLabel(code: string): string {
  if (code === 'Space') return 'Boşluk';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  return code;
}

export class KeyBindingsManager {
  private bindings: Record<KeyActionId, string>;
  private listeners: Array<() => void> = [];

  constructor() {
    this.bindings = this.buildDefaults();
    this.loadFromStorage();
  }

  private buildDefaults(): Record<KeyActionId, string> {
    const map = {} as Record<KeyActionId, string>;
    for (const spec of KEY_ACTION_SPECS) {
      map[spec.id] = spec.defaultCode;
    }
    return map;
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<KeyActionId, string>>;
      for (const spec of KEY_ACTION_SPECS) {
        const saved = parsed[spec.id];
        if (typeof saved === 'string' && saved.length > 0 && !FORBIDDEN_CODES.has(saved)) {
          this.bindings[spec.id] = saved;
        }
      }
    } catch {
      // Ignore storage access errors
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // Ignore storage access errors
    }
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  getCode(action: KeyActionId): string {
    return this.bindings[action];
  }

  getDisplayLabel(action: KeyActionId): string {
    return formatKeyCodeLabel(this.bindings[action]);
  }

  getActionForCode(code: string): KeyActionId | null {
    for (const spec of KEY_ACTION_SPECS) {
      if (this.bindings[spec.id] === code) return spec.id;
    }
    return null;
  }

  getTooltipText(action: KeyActionId): string {
    const spec = KEY_ACTION_SPECS.find((s) => s.id === action);
    const label = spec?.label ?? action;
    return `${label} — Kısayol: [${this.getDisplayLabel(action)}]`;
  }

  bindKey(
    action: KeyActionId,
    newCode: string,
  ): { ok: boolean; error?: string; swappedWith?: KeyActionId } {
    if (!newCode || FORBIDDEN_CODES.has(newCode)) {
      if (newCode === 'Escape') {
        return {
          ok: false,
          error: 'Esc tuşu tarayıcı tam ekran çakışması nedeniyle atanamaz.',
        };
      }
      return { ok: false, error: 'Bu tuş kısayol olarak atanamaz.' };
    }

    const prevCode = this.bindings[action];
    if (prevCode === newCode) return { ok: true };

    const conflict = this.getActionForCode(newCode);
    if (conflict && conflict !== action) {
      this.bindings[conflict] = prevCode;
      this.bindings[action] = newCode;
      this.saveToStorage();
      this.notify();
      return { ok: true, swappedWith: conflict };
    }

    this.bindings[action] = newCode;
    this.saveToStorage();
    this.notify();
    return { ok: true };
  }

  resetDefaults(): void {
    this.bindings = this.buildDefaults();
    this.saveToStorage();
    this.notify();
  }

  getAllSpecsWithCurrentKeys(): Array<KeyActionSpec & { currentCode: string; displayKey: string }> {
    return KEY_ACTION_SPECS.map((spec) => ({
      ...spec,
      currentCode: this.bindings[spec.id],
      displayKey: formatKeyCodeLabel(this.bindings[spec.id]),
    }));
  }
}
