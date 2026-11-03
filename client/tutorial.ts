// Coach copy for the training shift: the helper's next step, explained like a friendly sous-chef.
import type { GuideStep } from "./guide";

const COACH: Record<string, { title: string; body: string }> = {
  "fetch:bun_toasted": {
    title: "Your first ticket!",
    body: "Tickets (top left) show what to cook. A Smash Burger needs a toasted bun, a seared patty and chopped lettuce. You have 3 hands, so grab all three at the Walk-in in one trip: press E, then pick Bun, Ground beef and Lettuce.",
  },
  "fetch:patty_cooked": {
    title: "Now the patty",
    body: "Grab Ground beef at the Walk-in. You'll shape it into a patty at Prep, then sear it on the Grill.",
  },
  "fetch:lettuce_chopped": {
    title: "Lettuce",
    body: "Grab Lettuce from the Walk-in. It needs chopping at Prep before it goes on the burger.",
  },
  "fetch:fries": {
    title: "Ticket 2: Fries",
    body: "Fries take a few stops: Walk-in → Prep → Fryer → Pass. Start by grabbing a Potato.",
  },
  serve: {
    title: "Send it!",
    body: "Carry it to the Pass (the long counter under the orange heat lamp) and press E. Everything you hold that a ticket needs goes out at once.",
  },
  prep: {
    title: "Knife work",
    body: "At a Prep board press E. Tap SPACE (or click) each time the knife crosses a mark. If you hold more than one thing to prep, the next one starts straight away.",
  },
  grill: {
    title: "Sear it",
    body: "At the Grill press E. HOLD Space (or the mouse) to sear and let go in the green. Hold too long and it burns.",
  },
  toast: {
    title: "Toast the bun",
    body: "Buns go on the Grill too. Same move as the patty, but buns toast faster, so let go sooner!",
  },
  "fryer-drop": {
    title: "Into the fryer",
    body: "Press E at the Fryer to drop the basket. It cooks by itself, so in a real service you'd go do something else meanwhile!",
  },
  "fryer-wait": {
    title: "Frying...",
    body: "Watch the bar above the fryer: yellow means cooking, green means ready, red means burnt. Pull it (E) once it turns green.",
  },
  "fryer-pull": {
    title: "Golden!",
    body: "Press E at the Fryer to pull the basket (you need a free hand), then take it to the Pass.",
  },
  "fryer-full": {
    title: "Fryer's busy",
    body: "One basket per fryer. Wait for it to finish, or go help with something else.",
  },
  toss: {
    title: "Oops, burnt",
    body: "Burnt food can't be served. Toss it in the green Trash bin and grab a fresh one. No penalty in training!",
  },
  unneeded: {
    title: "Hands full",
    body: "Your hands are full of things no ticket wants. Toss one in the Trash (it throws away the selected slot: 1-3 or Q to pick).",
  },
};

export const TRAINING_INTRO = {
  title: "Welcome to the kitchen!",
  body: "Hold the mouse and drag to look around (change it in Settings), WASD to walk, hold SHIFT to sprint. Esc pauses.",
};

export const TRAINING_DONE = {
  title: "You're ready, chef!",
  body: "In a real service several tickets come in at once, each one's patience runs out, and you'll need clean plates. Nobody knows how many orders the night brings, so keep going until the last ticket! Serve fast to build a combo. Press Start service when you're ready!",
};

export function coachFor(step: GuideStep | null): { title: string; body: string } | null {
  if (!step) return null;
  return COACH[step.key] ?? { title: "Keep going!", body: step.html.replace(/<[^>]+>/g, "") };
}
