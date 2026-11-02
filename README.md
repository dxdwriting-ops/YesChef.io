# chef.io

A co-op, first-person kitchen .io game in 2.5D pixel cel shading. Your crew works one dinner service together, and **where you stand is your job**: the walk-in, prep boards, grill, fryer, pass and dish pit each play differently.

## Run it

```bash
npm install
npm run dev
```

This starts the Colyseus game server on port 2567 and the Vite client on <http://localhost:5173>. Friends on your network can join at `http://<your-ip>:5173`; anyone who picks the same restaurant shares your kitchen.

Other scripts: `npm run typecheck`, `npm run build` (client into `dist/`), `npm run server`, `npm run client`.

To point the client at a hosted server, set `VITE_SERVER_URL` (for example `wss://kitchen.example.com`).

## How to play

| Key | Action |
| --- | --- |
| Drag mouse / ← → | Look around |
| WASD / ↑ ↓ | Move (Shift to hustle) |
| E | Use the station you're facing |
| Tab | Peek at flipped tickets (limited peeks) |
| H | Toggle the step-by-step helper |
| 1-4 | Crew pings: Heard! / Behind! / Need plates! / 86 that! |
| G | Graphics: Retro / Sharp / HD + shadows |
| N / M | Music / sound effects on or off |
| L | Lock the mouse (optional) |
| Esc | Step away from a station |

Tickets slide onto the rail. Build each dish and send its parts to the **pass**; a finished ticket needs a **clean plate** to go out, and plates come back dirty a few seconds later.

**Easy to start:** the helper (on by default at the Food Truck) tells you the next move and points a bouncing arrow at the station; the menu chalkboard shows every recipe; the pre-shift huddle has a practice checklist.

**Memory and speed:** orders can come with modifiers (No lettuce, + Tomato, Double patty...). At the Diner and Bistro, tickets **flip face-down** after a few seconds, so read them, remember them, and peek sparingly. Serving back to back builds a **combo** (up to x2 points), and **rush hour** hits just past halfway.

**Music:** original light Japanese jazz / city-pop, generated live in the browser (Rhodes, walking bass, brushed drums, vinyl crackle). It gets busier during rush hour.

- **Walk-in:** grab buns, raw patties, lettuce, tomatoes, potatoes.
- **Prep:** rhythm chopping. Tap Space as the knife crosses each mark. Cleaner cuts mean bigger tips.
- **Grill:** hold Space to sear, release in the green window. Too long and it burns.
- **Fryer:** drop cut potatoes, then pull them between 6 and 11 seconds. It keeps cooking while you do other things.
- **Dish pit:** alternate A and D to scrub plates.
- **Trash:** toss mistakes.

Expired tickets are walk-outs (strikes). Score = base + speed bonus + quality tip; stars at the end.

## Ways to play

- **Multiplayer (quick play):** pick a kitchen and queue up. Once two or more chefs are in, service starts after a 20-second countdown; a solo player can press Start now.
- **Career:** a 9-shift story (Food Truck → Mika's Diner → Le Petit Pixel), each shift with goals. Clearing a chapter finale also unlocks that kitchen for multiplayer.
- **Challenges:** a Daily Special (new rules every day) plus Burger Blitz, Memory Lane, Fry Cook and Plate Panic, each with a best score.
- **Training:** the 2-minute coached tutorial. New players create a chef and go straight into it.

## Progression and collection

Every shift pays **XP** (levels) and **coins**. Spend coins in the **Shop & Locker**:

- **Equipment** with real perks: Santoku Knife (wider cut marks), Cast-Iron Plancha (wider sear window), Kitchen Clogs (+10% speed), Turbo Fryer, Bus Cart and Ticket Printer (solo-mode kitchen perks).
- **Hats and jackets** that other players see on your chef.
- **Decor** that appears in your kitchen: rug, plant, poster, string lights, paper lanterns, neon sign, lucky cat.

Come back daily for a **login streak** (day 7 drops a mystery crate) and **three new daily quests**. Progress is saved in the browser (localStorage).

## Restaurants (difficulty)

| Tier | Menu | What gets harder |
| --- | --- | --- |
| Food Truck | Burger, fries | Forgiving timers, 5 strikes |
| Diner | + Salad | Faster tickets, narrower grill window |
| Bistro | All | Tight tickets, thin grill window, 3 strikes |
| Ramen Bar, Bakery, Steakhouse, Tasting Room | Coming soon | Simmer timers, proofing, doneness, course pacing |

Tier tuning lives in `shared/game.ts` (`TIERS`).

## Code map

| Path | What it does |
| --- | --- |
| `shared/game.ts` | Items, recipes, stations and layout, tiers, shared rules |
| `server/state.ts` | Colyseus schema (synced state) |
| `server/KitchenRoom.ts` | Authoritative game loop: tickets, stations, fryer, plates, scoring |
| `client/render.ts` | Pixel cel-shading: low-res toon render + ink outline/dither post pass |
| `client/world.ts` | Kitchen geometry and live station visuals |
| `client/controls.ts` | First-person movement and collision |
| `client/avatars.ts` | Other cooks |
| `client/minigames.ts` | Station mini-games |
| `client/hud.ts` | Ticket rail, stats, prompts, overlays |
| `client/icons.ts` | Code-drawn 16x16 pixel ingredient icons |
| `client/main.ts` | Title screen, networking, game loop, interaction |
