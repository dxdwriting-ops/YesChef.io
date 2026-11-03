# YesChef.io

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

Every key can be rebound in **Settings** (main menu, or Esc in game). The defaults:

| Key | Action |
| --- | --- |
| Mouse | Look around: **hold to look** (default), **follow the mouse**, or **mouse lock**, picked in Settings |
| WASD, ← → | Move, turn (Shift to sprint) |
| E | Use the station you're facing |
| 1-4, Q, mouse wheel | Pick a hand slot (Trash throws away the selected one) |
| Space or mouse | Mini-game action: chop, sear, toast |
| Tab | Peek at flipped tickets (limited peeks) |
| H | Toggle the step-by-step helper |
| Z X C V | Crew calls: Heard! / Behind! / Need plates! / 86 that! |
| G | Graphics: Retro / Sharp / HD + shadows |
| N / M | Music / sound effects on or off |
| Esc | Pause (solo kitchens stop; multiplayer keeps cooking), or step away from a station |

Tickets slide onto the rail. There's **no clock**: a shift lasts an unknown number of orders (say 15, 20 or 30) and ends when the last ticket is served or walks out. **Last call** tells you the final ticket is on the rail. A finished ticket needs a **clean plate** to go out, and plates come back dirty a few seconds later.

You have **three hands** (four with the Sheet Tray), so you can grab everything for a dish in one walk-in trip, prep or grill it all in one stop, and send it all at the pass with one press.

**Easy to start:** the helper (on by default at the Food Truck) plans your next trip and points a bouncing arrow at the station; the menu chalkboard shows every recipe; the pre-shift huddle has a practice checklist.

**Memory and speed:** orders can come with modifiers (No lettuce, + Cheese, Double patty...). At the Diner and Bistro, tickets **flip face-down** after a few seconds, so read them, remember them, and peek sparingly. Serving back to back builds a **combo** (up to x2 points), and **rush hour** hits about halfway through the night.

**Music:** original light Japanese jazz / city-pop, generated live in the browser (Rhodes, walking bass, brushed drums, vinyl crackle). It gets busier during rush hour and last call.

| Dish | Route |
| --- | --- |
| Smash Burger | bun → grill (toast) · ground beef → prep (form) → grill (sear) · lettuce → prep (chop) |
| Fries | potato → prep (cut) → fryer |
| Garden Salad | lettuce → prep · tomato → prep |
| Onion Rings | onion → prep (ring) → fryer |
| Crispy Chicken | bun → grill · chicken → prep (bread) → fryer · lettuce → prep |

- **Walk-in:** pick one ingredient per free hand, then close it (E or Enter).
- **Prep:** rhythm knife work. Hit Space (or click) as the knife crosses each mark. Holding several things to prep? They run back to back.
- **Grill:** hold Space (or the mouse) to sear or toast, release in the green window. Buns toast faster than patties sear.
- **Fryer:** drop a basket and come back. Fries, rings and chicken each have their own timing; pulling needs a free hand.
- **Dish pit:** alternate your strafe keys (A and D) to scrub plates.
- **Trash:** toss mistakes and burnt food.

Expired tickets are walk-outs (strikes). Score = base + speed bonus + quality tip. Stars come from your average points per ticket, so short and long nights are judged the same.

## Ways to play

- **Multiplayer (quick play):** pick a kitchen and queue up. Once two or more chefs are in, service starts after a 20-second countdown; a solo player can press Start now.
- **Career:** a 9-shift story (Food Truck → Mika's Diner → Le Petit Pixel), each shift with goals. Clearing a chapter finale also unlocks that kitchen for multiplayer.
- **Challenges:** a Daily Special (new rules every day) plus Burger Blitz, Memory Lane, Fry Cook and Plate Panic, each with a best score.
- **Training:** the 2-minute coached tutorial. New players create a chef and go straight into it.

## Progression and collection

Every shift pays **XP** (levels) and **coins**. Spend coins in the **Shop & Locker**:

- **Equipment** with real perks: Santoku Knife (wider cut marks), Cast-Iron Plancha (wider sear window), Kitchen Clogs (+10% speed), Sheet Tray (a fourth hand slot), Turbo Fryer, Bus Cart and Ticket Printer (solo-mode kitchen perks).
- **Hats and jackets** that other players see on your chef.
- **Decor** that appears in your kitchen: rug, plant, poster, string lights, paper lanterns, neon sign, lucky cat.

Come back daily for a **login streak** (day 7 drops a mystery crate) and **three new daily quests**. Progress is saved in the browser (localStorage).

## Restaurants (difficulty)

| Tier | Menu | What gets harder |
| --- | --- | --- |
| Food Truck | Burger, fries | Forgiving timers, 5 strikes |
| Diner | + Salad, Onion Rings | Faster tickets, flipping tickets, narrower grill window |
| Bistro | + Crispy Chicken | Tight tickets, thin grill window, 3 strikes |
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
