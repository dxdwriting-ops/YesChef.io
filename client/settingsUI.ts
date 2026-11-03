// The settings screen, shared by the main menu and the in-game pause menu.
import { QUALITY_LABEL, type Quality } from "./render";
import { ACTIONS, DEFAULT_KEYS, LOOK_MODES, bind, bindable, keyName, saveSettings, type Action, type Settings } from "./settings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface SettingsUI {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** True while waiting for a key to bind, so the game ignores that key press. */
  readonly capturing: boolean;
}

/** `onChange` runs after every change, with the setting that changed. */
export function initSettingsUI(settings: Settings, onChange: (what: keyof Settings) => void, onClose: () => void = () => {}): SettingsUI {
  let capture: Action | null = null;
  const root = $("settings");

  const changed = (what: keyof Settings) => {
    saveSettings(settings);
    render();
    onChange(what);
  };

  function render() {
    $("set-look").innerHTML = LOOK_MODES.map(
      (m) => `<button data-look="${m.id}" aria-pressed="${settings.look === m.id}">${m.name}</button>`,
    ).join("");
    $("set-look-blurb").textContent = LOOK_MODES.find((m) => m.id === settings.look)?.blurb ?? "";
    $<HTMLInputElement>("set-sens").value = String(settings.sensitivity);
    $("set-sens-val").textContent = `${settings.sensitivity.toFixed(2)}x`;
    $<HTMLInputElement>("set-invert").checked = settings.invertY;
    $("set-quality").innerHTML = (Object.keys(QUALITY_LABEL) as Quality[])
      .map((q) => `<button data-quality="${q}" aria-pressed="${settings.quality === q}">${QUALITY_LABEL[q]}</button>`)
      .join("");
    $<HTMLInputElement>("set-autores").checked = settings.autoRes;
    $<HTMLInputElement>("set-fps").checked = settings.showFps;
    $("set-keys").innerHTML = (Object.keys(ACTIONS) as Action[])
      .map((a) => {
        const label = capture === a ? "Press a key..." : keyName(settings.keys[a]);
        const changedFromDefault = settings.keys[a] !== DEFAULT_KEYS[a];
        return `<div class="key-row"><span>${ACTIONS[a]}</span><button data-bind="${a}" class="${capture === a ? "listening" : ""} ${changedFromDefault ? "custom" : ""}">${label}</button></div>`;
      })
      .join("");
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const look = t.closest<HTMLElement>("[data-look]")?.dataset.look;
    if (look && LOOK_MODES.some((m) => m.id === look)) {
      settings.look = look as Settings["look"];
      return changed("look");
    }
    const quality = t.closest<HTMLElement>("[data-quality]")?.dataset.quality as Quality | undefined;
    if (quality && quality in QUALITY_LABEL) {
      settings.quality = quality;
      return changed("quality");
    }
    const action = t.closest<HTMLElement>("[data-bind]")?.dataset.bind as Action | undefined;
    if (action && action in ACTIONS) {
      capture = capture === action ? null : action;
      return render();
    }
  });
  $<HTMLInputElement>("set-sens").addEventListener("input", (e) => {
    settings.sensitivity = Number((e.target as HTMLInputElement).value);
    changed("sensitivity");
  });
  $<HTMLInputElement>("set-invert").addEventListener("change", (e) => {
    settings.invertY = (e.target as HTMLInputElement).checked;
    changed("invertY");
  });
  $<HTMLInputElement>("set-autores").addEventListener("change", (e) => {
    settings.autoRes = (e.target as HTMLInputElement).checked;
    changed("autoRes");
  });
  $<HTMLInputElement>("set-fps").addEventListener("change", (e) => {
    settings.showFps = (e.target as HTMLInputElement).checked;
    changed("showFps");
  });
  $("set-reset").addEventListener("click", () => {
    settings.keys = { ...DEFAULT_KEYS };
    capture = null;
    changed("keys");
  });

  const close = () => {
    capture = null;
    root.hidden = true;
    onClose();
  };
  $("set-done").addEventListener("click", close);

  // Capture phase, so binding a key never also triggers it in the game underneath.
  window.addEventListener(
    "keydown",
    (e) => {
      if (root.hidden) return;
      if (capture) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === "Escape") {
          capture = null;
          return render();
        }
        if (!bindable(e.code)) return;
        bind(settings, capture, e.code);
        capture = null;
        return changed("keys");
      }
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    },
    true,
  );

  return {
    open() {
      render();
      root.hidden = false;
    },
    close,
    get isOpen() {
      return !root.hidden;
    },
    get capturing() {
      return capture !== null;
    },
  };
}

/** The little controls cheat-sheet on the main menu and in the HUD, built from the live bindings. */
export function controlsHTML(s: Settings, compact = false): string {
  const k = (a: Action) => `<kbd>${keyName(s.keys[a])}</kbd>`;
  const look = s.look === "hold" ? "Hold mouse" : s.look === "follow" ? "Mouse" : "Click";
  if (compact) {
    return `${k("ping1")} Heard ${k("ping2")} Behind ${k("ping3")} Plates ${k("ping4")} 86 · ${k("cycle")} next hand · <kbd>Esc</kbd> pause`;
  }
  return [
    `<li><kbd>${look}</kbd> look</li>`,
    `<li>${k("forward")}${k("left")}${k("back")}${k("right")} move</li>`,
    `<li>${k("sprint")} sprint</li>`,
    `<li>${k("interact")} use station</li>`,
    `<li>${k("slot1")}-${k("slot4")} pick hand</li>`,
    `<li>${k("peek")} peek</li>`,
    `<li><kbd>Esc</kbd> pause</li>`,
  ].join("");
}
