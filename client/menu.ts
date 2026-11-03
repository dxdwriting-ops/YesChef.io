// Menus: main menu, multiplayer, career, challenges, shop & locker, character creation, daily rewards.
import { CHEF_COLORS, TIERS, isPlayableTier, type TierId } from "../shared/game";
import { SHOP, SKIN_TONES, STREAK_REWARDS, type ItemKind } from "../shared/meta";
import { CAREER, challenges, goalText, type Mode } from "../shared/modes";
import { drawPortrait } from "./portrait";
import {
  APRON_LEVELS,
  apronUnlocked,
  buy,
  canBuy,
  careerUnlocked,
  checkIn,
  isUnlocked,
  levelProgress,
  saveProfile,
  unlockHint,
  type Profile,
} from "./profile";

export interface PlayRequest {
  mode: Mode;
  tier?: TierId;
  level?: string;
  challenge?: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ["main", "multi", "career", "challenge", "shop", "create", "brief"] as const;
type Screen = (typeof SCREENS)[number];

function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function initMenu(profile: Profile, onPlay: (req: PlayRequest) => void) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("chefio.tier");
  } catch {
    // Storage blocked: default kitchen.
  }
  let tier: TierId = isPlayableTier(saved) && isUnlocked(profile, saved) ? saved : "foodtruck";
  let shopTab: ItemKind = "equipment";
  let briefPlay: PlayRequest | null = null;
  let briefBack: Screen = "main";

  const show = (screen: Screen) => {
    for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
    $("join-error").hidden = true;
    renderHeader();
    if (screen === "main") renderMain();
    if (screen === "multi") renderTiers();
    if (screen === "career") renderCareer();
    if (screen === "challenge") renderChallenges();
    if (screen === "shop") renderShop();
    if (screen === "create") renderCreate();
    $("title").scrollTop = 0;
  };

  const look = () => ({ skin: profile.skin, apron: profile.apron, hat: profile.hat, jacket: profile.jacket });

  function renderHeader() {
    const prog = levelProgress(profile.xp);
    $("coins").textContent = String(profile.coins);
    $("career-level").textContent = `Lv ${prog.level}`;
    $("career-xp").style.width = `${(prog.into / prog.span) * 100}%`;
    $("career-note").textContent = `${prog.span - prog.into} XP to Lv ${prog.level + 1}`;
  }

  function renderMain() {
    renderHeader();
    drawPortrait($<HTMLCanvasElement>("portrait"), look());
    $("chef-name").textContent = profile.name || "Chef";
    $("streak-line").textContent = profile.streak > 1 ? `${profile.streak}-day streak! Come back tomorrow for more.` : "Play daily to build a streak.";
    $("quests").innerHTML = profile.quests
      .map(
        (q) => `<li class="${q.done ? "done" : ""}"><span>${q.done ? "✓ " : ""}${esc(q.text)}</span>
        <span><i class="coin"></i> ${q.reward}</span>
        <span class="xpbar"><i style="width:${(q.progress / q.target) * 100}%"></i></span></li>`,
      )
      .join("");
    const now = new Date();
    const hours = 23 - now.getHours();
    $("quest-reset").textContent = `new in ${hours}h ${59 - now.getMinutes()}m`;
  }

  function renderTiers() {
    renderHeader();
    $("tiers").innerHTML = (Object.keys(TIERS) as TierId[])
      .map((id) => {
        const t = TIERS[id];
        const open = isUnlocked(profile, id);
        const stars = profile.stars[id] ?? 0;
        const best = profile.best[id];
        const meta = open
          ? `<span class="tier-meta">${[1, 2, 3].map((n) => `<i class="${n <= stars ? "on" : ""}">★</i>`).join("")}${best ? ` · best ${best}` : ""}</span>`
          : "";
        const blurb = t.locked ? "Coming soon" : open ? t.blurb : `Locked: ${unlockHint(id)} or clear its career chapter`;
        return `<button class="tier" data-tier="${id}" aria-pressed="${id === tier}" ${open ? "" : "disabled"}>
          <b>${t.name}</b><small>${blurb}</small>${meta}</button>`;
      })
      .join("");
  }

  function renderCareer() {
    renderHeader();
    $("chapters").innerHTML = CAREER.map((ch) => {
      const rows = ch.levels
        .map((l) => {
          const open = careerUnlocked(profile, l);
          const rec = profile.career[l.id];
          const stars = rec?.cleared ? [1, 2, 3].map((n) => (n <= rec.stars ? "★" : "☆")).join("") : "";
          return `<button class="row ${rec?.cleared ? "owned" : ""}" data-level="${l.id}" ${open ? "" : "disabled"}>
            <span><b>${l.id} · ${esc(l.name)}</b><small>${open ? goalText(l.goal).join(" · ") : "Clear the previous shift to unlock"}</small></span>
            <span class="tag">${rec?.cleared ? stars : open ? "Play →" : "Locked"}</span></button>`;
        })
        .join("");
      return `<div class="chapter"><h3>${esc(ch.title)}</h3><p>${esc(ch.intro)}</p><div class="list">${rows}</div></div>`;
    }).join("");
  }

  function renderChallenges() {
    renderHeader();
    $("challenges").innerHTML = challenges()
      .map((c) => {
        const best = profile.challengeBest[c.id];
        return `<button class="row" data-challenge="${c.id}">
          <span><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></span>
          <span class="tag">${best ? `Best ${best}` : "Play →"}</span></button>`;
      })
      .join("");
  }

  function renderShop() {
    renderHeader();
    drawPortrait($<HTMLCanvasElement>("shop-portrait"), look());
    $("shop-tabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === shopTab)));
    $("shop-grid").innerHTML = SHOP.filter((i) => i.kind === shopTab)
      .map((i) => {
        const status = canBuy(profile, i);
        const equipped =
          (i.kind === "hat" && profile.hat === i.id) || (i.kind === "jacket" && profile.jacket === i.id) || (i.kind === "decor" && profile.decor.includes(i.id));
        let tag = "";
        if (status === "owned") {
          tag = i.kind === "equipment" ? "Active" : i.kind === "decor" ? (equipped ? "Shown ✓" : "Show") : equipped ? "Wearing ✓" : "Wear";
        } else if (status === "level") tag = `Lv ${i.level}`;
        else tag = `<i class="coin"></i> ${i.price}`;
        const swatch = i.color ? `<i style="display:inline-block;width:10px;height:10px;background:${i.color};border:2px solid #1a1216;margin-right:6px"></i>` : "";
        return `<button class="row ${status === "owned" ? "owned" : ""} ${equipped ? "equipped" : ""}" data-item="${i.id}"
          ${status === "level" || (status === "coins" && i.price > 0) ? "data-locked" : ""}>
          <span><b>${swatch}${esc(i.name)}</b><small>${esc(i.blurb)}</small></span><span class="tag">${tag}</span></button>`;
      })
      .join("");
  }

  function renderCreate() {
    $("create-title").textContent = profile.created ? "Edit your chef" : "Create your chef";
    $<HTMLInputElement>("name").value = profile.name;
    drawPortrait($<HTMLCanvasElement>("create-portrait"), look());
    $("skins").innerHTML = SKIN_TONES.map(
      (c, i) => `<button class="apron" style="--c:${c}" data-skin="${i}" aria-pressed="${i === profile.skin}" title="Skin tone"></button>`,
    ).join("");
    $("aprons").innerHTML = CHEF_COLORS.map((c, i) => {
      const open = apronUnlocked(profile, i);
      return `<button class="apron" style="--c:${c}" data-apron="${i}" aria-pressed="${i === profile.apron}" ${open ? "" : "disabled"}
        title="${open ? "Apron" : `Unlocks at Lv ${APRON_LEVELS[i]}`}">${open ? "" : `Lv${APRON_LEVELS[i]}`}</button>`;
    }).join("");
    $("hats").innerHTML = SHOP.filter((i) => i.kind === "hat" && profile.owned.includes(i.id))
      .map((i) => `<button class="apron" style="--c:${i.color}" data-hat="${i.id}" aria-pressed="${i.id === profile.hat}" title="${esc(i.name)}"></button>`)
      .join("");
    $("create-done").textContent = profile.created ? "Save" : "Let's cook!";
  }

  function brief(req: PlayRequest, back: Screen, kicker: string, title: string, story: string, goals: string[]) {
    briefPlay = req;
    briefBack = back;
    $("brief-kicker").textContent = kicker;
    $("brief-title").textContent = title;
    $("brief-story").textContent = story;
    $("brief-goals").innerHTML = goals.map((g) => `<li>${esc(g)}</li>`).join("");
    show("brief");
  }

  // ----- Events -----

  $("title").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-go]")?.dataset.go as Screen | undefined;
    if (go) return show(go);

    const tierId = t.closest<HTMLElement>("[data-tier]")?.dataset.tier;
    if (isPlayableTier(tierId) && isUnlocked(profile, tierId)) {
      tier = tierId;
      return renderTiers();
    }

    const levelId = t.closest<HTMLElement>("[data-level]")?.dataset.level;
    if (levelId) {
      const ch = CAREER.find((c) => c.levels.some((l) => l.id === levelId))!;
      const level = ch.levels.find((l) => l.id === levelId)!;
      const first = ch.levels[0] === level;
      return brief({ mode: "career", level: levelId }, "career", ch.title, `${level.id} · ${level.name}`, first ? `${ch.intro} ${level.story}` : level.story, goalText(level.goal));
    }

    const chId = t.closest<HTMLElement>("[data-challenge]")?.dataset.challenge;
    if (chId) {
      const c = challenges().find((x) => x.id === chId)!;
      const [one, two, three] = c.rules.stars ?? TIERS[c.tier].stars;
      return brief({ mode: "challenge", challenge: chId }, "challenge", "Challenge", c.name, c.blurb, [
        `Points per ticket for stars: ★ ${one}  ★★ ${two}  ★★★ ${three}`,
      ]);
    }

    const tab = t.closest<HTMLElement>("[data-tab]")?.dataset.tab as ItemKind | undefined;
    if (tab) {
      shopTab = tab;
      return renderShop();
    }

    const itemEl = t.closest<HTMLElement>("[data-item]");
    if (itemEl) {
      const item = SHOP.find((i) => i.id === itemEl.dataset.item)!;
      const status = canBuy(profile, item);
      if (status === "ok" && buy(profile, item.id)) {
        if (item.kind === "hat") profile.hat = item.id;
        if (item.kind === "jacket") profile.jacket = item.id;
      } else if (status === "owned") {
        if (item.kind === "hat") profile.hat = item.id;
        if (item.kind === "jacket") profile.jacket = item.id;
        if (item.kind === "decor") {
          profile.decor = profile.decor.includes(item.id) ? profile.decor.filter((d) => d !== item.id) : [...profile.decor, item.id];
        }
      } else if (status === "coins") {
        $("join-error").textContent = `Not enough coins yet. Play shifts and finish daily quests to earn more.`;
        $("join-error").hidden = false;
        return;
      }
      saveProfile(profile);
      return renderShop();
    }

    const skin = t.closest<HTMLElement>("[data-skin]")?.dataset.skin;
    const apron = t.closest<HTMLElement>("[data-apron]")?.dataset.apron;
    const hat = t.closest<HTMLElement>("[data-hat]")?.dataset.hat;
    if (skin !== undefined) profile.skin = Number(skin);
    if (apron !== undefined && apronUnlocked(profile, Number(apron))) profile.apron = Number(apron);
    if (hat) profile.hat = hat;
    if (skin !== undefined || apron !== undefined || hat) renderCreate();
  });

  $<HTMLInputElement>("name").addEventListener("input", (e) => {
    profile.name = (e.target as HTMLInputElement).value.slice(0, 14);
  });

  $("create-done").addEventListener("click", () => {
    const firstTime = !profile.created;
    profile.name = profile.name.trim() || "Chef";
    profile.created = true;
    saveProfile(profile);
    if (firstTime && !profile.trained) onPlay({ mode: "training" });
    else show("main");
  });

  $("join").addEventListener("click", () => {
    try {
      localStorage.setItem("chefio.tier", tier);
    } catch {
      // Not remembered.
    }
    onPlay({ mode: "quick", tier });
  });
  $("go-training").addEventListener("click", () => onPlay({ mode: "training" }));
  $("brief-go").addEventListener("click", () => briefPlay && onPlay(briefPlay));
  $("brief-back").addEventListener("click", () => show(briefBack));

  // ----- First screen -----

  const login = checkIn(profile);
  if (!profile.created) show("create");
  else show("main");

  if (login && profile.created) {
    $("daily-title").textContent = login.day === 7 ? "Day 7: mystery crate!" : `Day ${login.day} streak`;
    $("daily-days").innerHTML = STREAK_REWARDS.map(
      (c, i) => `<span class="${i < login.day ? "got" : ""} ${i === login.day - 1 ? "today" : ""}">D${i + 1}<br>${c}</span>`,
    ).join("");
    $("daily-text").textContent = `+${login.coins} coins${login.crate ? ` and a ${login.crate.name}!` : ""}. Three new daily quests are waiting.`;
    $("daily-popup").hidden = false;
    $("daily-ok").addEventListener("click", () => {
      $("daily-popup").hidden = true;
      renderMain();
    });
  }

  return {
    error(text: string) {
      $("join-error").textContent = text;
      $("join-error").hidden = false;
    },
  };
}
