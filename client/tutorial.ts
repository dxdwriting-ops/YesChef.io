// Coach copy for the training shift: the helper's next step, explained like a friendly sous-chef.
import type { GuideStep } from "./guide";

const COACH: Record<string, { title: string; body: string }> = {
  "fetch:bun": {
    title: "Your first ticket!",
    body: "Tickets (top left) show what to cook. This Smash Burger needs a bun, a seared patty and chopped lettuce. Follow the purple arrow to the Walk-in fridge and press E to grab a Bun.",
  },
  "fetch:patty_cooked": {
    title: "Now the patty",
    body: "Patties come raw from the Walk-in. Grab a Raw patty (E, then pick it).",
  },
  "fetch:lettuce_chopped": {
    title: "Last part: lettuce",
    body: "Grab Lettuce from the Walk-in. It needs chopping before it goes on the burger.",
  },
  "fetch:fries": {
    title: "Ticket 2: Fries",
    body: "Fries take a few stations: Walk-in → Prep → Fryer → Pass. Start by grabbing a Potato.",
  },
  serve: {
    title: "Send it!",
    body: "Carry it to the Pass (the long counter under the orange heat lamp) and press E. Each part you send ticks off the ticket.",
  },
  prep: {
    title: "Knife work",
    body: "Take it to a Prep board and press E. Tap SPACE each time the knife crosses a mark. Cleaner cuts = bigger tips.",
  },
  grill: {
    title: "Sear it",
    body: "Head to the Grill and press E. HOLD Space to sear and let go when the meter is in the green. Hold too long and it burns.",
  },
  "fryer-drop": {
    title: "Into the fryer",
    body: "Press E at the Fryer to drop the basket. It cooks by itself, so in a real service you'd go do something else meanwhile!",
  },
  "fryer-wait": {
    title: "Frying...",
    body: "Watch the bar above the fryer: yellow means cooking, green means ready, red means burnt. Pull them (E) once it turns green.",
  },
  "fryer-pull": {
    title: "Golden!",
    body: "Press E at the Fryer to pull the fries, then take them to the Pass.",
  },
  "fryer-full": {
    title: "Fryer's busy",
    body: "Only one basket at a time. Wait for it to finish, or go help with something else.",
  },
  toss: {
    title: "Oops, burnt",
    body: "Burnt food can't be served. Toss it in the green Trash bin (right side of the kitchen) and grab a fresh one. No penalty in training!",
  },
  unneeded: {
    title: "Not needed",
    body: "No ticket wants that right now. Toss it in the Trash or hang on to it.",
  },
};

export const TRAINING_INTRO = {
  title: "Welcome to the kitchen!",
  body: "Move the mouse to look around, WASD to walk, hold SHIFT to sprint. Push the cursor to a screen edge to keep turning.",
};

export const TRAINING_DONE = {
  title: "You're ready, chef!",
  body: "In a real service several tickets come in at once, they run on a timer, and you'll need clean plates. Serve fast to build a combo. Press Start service when you're ready!",
};

export function coachFor(step: GuideStep | null): { title: string; body: string } | null {
  if (!step) return null;
  return COACH[step.key] ?? { title: "Keep going!", body: step.html.replace(/<[^>]+>/g, "") };
}
