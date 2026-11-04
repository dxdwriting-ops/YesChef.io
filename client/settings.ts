// Player settings, saved in this browser: how the mouse looks around, every key binding,
// graphics and performance, and audio. One object, read live by the controls and the HUD.
import { isQuality, type Quality } from "./render";

export type LookMode = "hold" | "follow" | "lock";

export const LOOK_MODES: { id: LookMode; name: string; blurb: string }[] = [
  { id: "hold", name: "Hold to look", blurb: "Hold a mouse button and drag to look. The cursor stays free." },
  { id: "follow", name: "Follow the mouse", blurb: "The view follows the cursor. Push it to a screen edge to keep turning." },
  { id: "lock", name: "Mouse lock (FPS)", blurb: "Click the kitchen to capture the mouse, like a shooter. Esc frees it." },
];

export const ACTIONS = {
  forward: "Walk forward",
  back: "Walk back",
  left: "Strafe left",
  right: "Strafe right",
  sprint: "Sprint",
  turnLeft: "Turn left",
  turnRight: "Turn right",
  interact: "Use station",
  work: "Mini-game action (chop, sear)",
  slot1: "Hand slot 1",
  slot2: "Hand slot 2",
  slot3: "Hand slot 3",
  slot4: "Hand slot 4",
  cycle: "Next hand slot",
  peek: "Peek at tickets",
  helper: "Helper on/off",
  ping1: "Call: Heard!",
  ping2: "Call: Behind!",
  ping3: "Call: Need plates!",
  ping4: "Call: 86 that!",
  music: "Music on/off",
  sound: "Sound on/off",
  graphics: "Cycle graphics",
} as const;

export type Action = keyof typeof ACTIONS;

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  sprint: "ShiftLeft",
  turnLeft: "ArrowLeft",
  turnRight: "ArrowRight",
  interact: "KeyE",
  work: "Space",
  slot1: "Digit1",
  slot2: "Digit2",
  slot3: "Digit3",
  slot4: "Digit4",
  cycle: "KeyQ",
  peek: "Tab",
  helper: "KeyH",
  ping1: "KeyZ",
  ping2: "KeyX",
  ping3: "KeyC",
  ping4: "KeyV",
  music: "KeyN",
  sound: "KeyM",
  graphics: "KeyG",
};

export interface Settings {
  look: LookMode;
  sensitivity: number; // 0.25 - 3
  invertY: boolean;
  quality: Quality;
  autoRes: boolean; // lower the render resolution when the frame rate drops
  showFps: boolean;
  keys: Record<Action, string>;
}

const KEY = "chefio.settings";

export function defaultSettings(): Settings {
  return { look: "hold", sensitivity: 1, invertY: false, quality: "ultra", autoRes: true, showFps: false, keys: { ...DEFAULT_KEYS } };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    // Graphics quality used to live on its own key.
    const oldQuality = localStorage.getItem("chefio.quality");
    if (isQuality(oldQuality)) s.quality = oldQuality;
    if (raw && typeof raw === "object") {
      if (LOOK_MODES.some((m) => m.id === raw.look)) s.look = raw.look;
      if (typeof raw.sensitivity === "number") s.sensitivity = Math.min(3, Math.max(0.25, raw.sensitivity));
      if (typeof raw.invertY === "boolean") s.invertY = raw.invertY;
      if (isQuality(raw.quality)) s.quality = raw.quality;
      // Move players still on an older default to the new one, once.
      if (!raw.saw3d && s.quality === "hd") s.quality = "ultra";
      if (!raw.sawUltra && s.quality === "smooth") s.quality = "ultra";
      if (typeof raw.autoRes === "boolean") s.autoRes = raw.autoRes;
      if (typeof raw.showFps === "boolean") s.showFps = raw.showFps;
      for (const a of Object.keys(ACTIONS) as Action[]) if (typeof raw.keys?.[a] === "string") s.keys[a] = raw.keys[a];
    }
  } catch {
    // Storage blocked or corrupt: defaults.
  }
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, saw3d: true, sawUltra: true }));
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

/** Bind `code` to `action`. If another action had that key, the two swap so nothing is left doubled up. */
export function bind(s: Settings, action: Action, code: string) {
  const clash = (Object.keys(s.keys) as Action[]).find((a) => a !== action && s.keys[a] === code);
  if (clash) s.keys[clash] = s.keys[action];
  s.keys[action] = code;
}

/** The action a key event triggers, if any. The right-hand Shift, Ctrl or Alt counts as the left one. */
export function actionFor(s: Settings, code: string): Action | null {
  const modifier = /^(Shift|Control|Alt)Right$/.test(code) ? code.replace(/Right$/, "Left") : null;
  for (const a of Object.keys(s.keys) as Action[]) {
    if (s.keys[a] === code || s.keys[a] === modifier) return a;
  }
  return null;
}

/** "KeyW" → "W", "ShiftLeft" → "Shift", "Digit1" → "1", "ArrowLeft" → "←". */
export function keyName(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const arrows: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  if (arrows[code]) return arrows[code];
  const named: Record<string, string> = {
    ShiftLeft: "Shift",
    ShiftRight: "R-Shift",
    ControlLeft: "Ctrl",
    ControlRight: "R-Ctrl",
    AltLeft: "Alt",
    AltRight: "R-Alt",
    Space: "Space",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    CapsLock: "Caps",
    Enter: "Enter",
    Backspace: "Bksp",
  };
  return named[code] ?? code;
}

/** Keys that can't be bound: Esc is always pause and step-away, and the browser owns the F-keys. */
export function bindable(code: string): boolean {
  return code !== "Escape" && !/^F\d+$/.test(code) && code !== "MetaLeft" && code !== "MetaRight";
}
