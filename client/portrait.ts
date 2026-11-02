// Pixel-art chef portrait for character creation, the menu and the locker.
import { CHEF_COLORS } from "../shared/game";
import { SKIN_TONES, shopItem } from "../shared/meta";

export interface Look {
  skin: number;
  apron: number;
  hat: string;
  jacket: string;
}

const INK = "#1a1216";

export function drawPortrait(canvas: HTMLCanvasElement, look: Look) {
  canvas.width = 32;
  canvas.height = 40;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, 32, 40);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const skin = SKIN_TONES[look.skin] ?? SKIN_TONES[1];
  const jacket = shopItem(look.jacket)?.color ?? "#f4f1ea";
  const hatColor = shopItem(look.hat)?.color ?? "#f4f1ea";
  const apron = CHEF_COLORS[look.apron] ?? CHEF_COLORS[0];

  // Shoulders and jacket, with an apron bib and buttons.
  px(4, 29, 24, 11, INK);
  px(5, 30, 22, 10, jacket);
  px(11, 31, 10, 9, apron);
  px(12, 32, 8, 1, "rgba(255,255,255,0.35)");
  px(8, 33, 1, 1, INK);
  px(8, 36, 1, 1, INK);
  px(14, 28, 4, 2, apron); // neckerchief

  // Head.
  px(9, 14, 14, 15, INK);
  px(10, 15, 12, 13, skin);
  px(12, 20, 2, 2, INK); // eyes
  px(18, 20, 2, 2, INK);
  px(13, 25, 6, 1, "#9a4a3a"); // smile
  px(10, 23, 2, 1, "rgba(224,79,63,0.35)"); // blush
  px(20, 23, 2, 1, "rgba(224,79,63,0.35)");

  // Hat styles.
  switch (look.hat) {
    case "hat-tall":
      px(9, 1, 14, 15, INK);
      px(10, 2, 12, 13, hatColor);
      px(9, 13, 14, 3, INK);
      px(10, 13, 12, 2, "#dcd6cb");
      break;
    case "hat-bandana":
      px(9, 11, 14, 6, INK);
      px(10, 12, 12, 4, hatColor);
      px(22, 13, 4, 2, hatColor);
      px(12, 13, 1, 1, "#fff4dc");
      px(17, 14, 1, 1, "#fff4dc");
      break;
    case "hat-beret":
      px(7, 9, 18, 7, INK);
      px(8, 10, 16, 5, hatColor);
      px(15, 7, 2, 3, INK);
      break;
    case "hat-hachimaki":
      px(9, 15, 14, 4, INK);
      px(10, 16, 12, 2, hatColor);
      px(15, 16, 2, 2, "#e04f3f");
      px(22, 15, 4, 1, hatColor);
      px(22, 18, 3, 1, hatColor);
      break;
    default: {
      // Puffy toque (classic or golden).
      px(7, 4, 18, 12, INK);
      px(8, 5, 16, 10, hatColor);
      px(8, 5, 5, 4, "rgba(255,255,255,0.4)");
      px(9, 13, 14, 3, INK);
      px(10, 13, 12, 2, look.hat === "hat-gold" ? "#c9952a" : "#dcd6cb");
    }
  }
}
