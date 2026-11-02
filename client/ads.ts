// Ads for your own website, via Google AdSense H5 Games Ads (the Ad Placement API).
// Off unless configured at build time:
//   VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX   (your AdSense publisher id)
//   VITE_ADSENSE_BANNER_SLOT=1234567890           (optional: a display ad unit for the menu banner)
//   VITE_ADSENSE_TEST=on                           (optional: test ads while you set things up)
// Never shown on itch.io, never during a shift: only menu banners, breaks between shifts,
// and an opt-in rewarded ad that doubles your shift coins.

type AdBreakOptions = Record<string, unknown>;
declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (o: AdBreakOptions) => void;
    adConfig?: (o: AdBreakOptions) => void;
  }
}

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const BANNER_SLOT = import.meta.env.VITE_ADSENSE_BANNER_SLOT as string | undefined;
const TEST = (import.meta.env.VITE_ADSENSE_TEST as string | undefined) === "on";

const onItch = /(^|\.)itch\.(io|zone)$/.test(location.hostname) || location.hostname.endsWith("hwcdn.net");
export const adsEnabled = !!CLIENT && !onItch;

let loaded = false;

export function initAds() {
  if (!adsEnabled || loaded) return;
  loaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  s.crossOrigin = "anonymous";
  s.dataset.adClient = CLIENT;
  if (TEST) s.dataset.adbreakTest = "on";
  document.head.appendChild(s);
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = (o) => window.adsbygoogle!.push(o);
  window.adConfig({ preloadAdBreaks: "on", sound: "on" });
}

/** Menu banner. Only fills if you configured a display ad unit. */
export function showBanner(el: HTMLElement) {
  if (!adsEnabled || !BANNER_SLOT) return;
  el.hidden = false;
  el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${CLIENT}" data-ad-slot="${BANNER_SLOT}"
    data-ad-format="horizontal" data-full-width-responsive="true"></ins>`;
  try {
    window.adsbygoogle!.push({});
  } catch {
    el.hidden = true;
  }
}

/** A break between shifts. Resolves when the ad (if any) is done. */
export function interstitial(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (!adsEnabled || !window.adBreak) return resolve();
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    window.adBreak({ type: "next", name, adBreakDone: finish });
    setTimeout(finish, 15000); // never trap the player if the ad network stalls
  });
}

/** Opt-in rewarded ad. Resolves true only if the player watched it to the end. */
export function rewarded(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!adsEnabled || !window.adBreak) return resolve(false);
    let granted = false;
    window.adBreak({
      type: "reward",
      name,
      beforeReward: (showAdFn: () => void) => showAdFn(),
      adViewed: () => (granted = true),
      adDismissed: () => (granted = false),
      adBreakDone: () => resolve(granted),
    });
  });
}
