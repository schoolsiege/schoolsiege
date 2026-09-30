# BREACHPOINT

Static, single-player tactical FPS with bots. Serve this folder as a website, or publish its contents to GitHub Pages. Keep `index.html`, both CSS files and the whole `js/` folder together. Three.js and fonts load from external CDNs.

## Recon and operators

Each round starts with a 30-second droning phase. Press **Enter** or tap **START ACTION** to finish early. Your operator stays in place while you use remote cameras and remains vulnerable during the action phase.

| Control | Action |
| --- | --- |
| 5 | Building cameras; press again to leave |
| Q / E | Previous / next camera |
| 6 | Drive your drone; press again to leave |
| WASD | Drive |
| Space | Drone jump (1.2-second cooldown) |
| Hold Shift | Drone boost: 2 seconds, then 6-second cooldown |
| Click / X | Scan visible enemies; marks last 5 seconds |
| 1 / 2 | Return to operator | a
| F | Operator ability |

Touch controls include CAMS, DRONE, ABILITY, camera switching, jump, boost, scan and exit. Drag to look and use the left joystick to drive. Landscape provides more space.

Four fixed cameras cover key rooms on every map. Bots can shoot your drone and cameras you access; they require line of sight, take time to react and can miss. Destroyed devices return next round. Ground-level door barricades have a visible gap for drones.

Choose one of four original operators in the menu:

- **Maul:** hammer breaks barricades or opens soft walls within 2.3m; 12 uses.
- **Cinder:** two projectile breaching rounds for soft walls, barricades and nearby electronics.
- **Mender:** three stims heal 60 HP, capped at 100; aim at an injured teammate or heal yourself.
- **Sonar:** heartbeat sensor detects enemies through walls within 9m for 4 seconds; 12-second cooldown.

Bots also use abilities. Abilities activate during the action phase. Reinforced walls resist breaching.

## Modes

- **Secure Area:** normal team rules; cheats are disabled.
- **Hacker Arena:** player versus six cheating bots, everyone against everyone. First individual to win three rounds wins the match. Aimbot, ESP, rapid fire, infinite ammunition and movement bonuses are available. Bots have enemy location knowledge and boosted combat settings. Everyone can die; god mode, noclip and one-shot toggles are unavailable. The normal headshot damage rule still applies.

Press **M** or use the Hacker Loadout menu to configure the custom mode. Saved custom settings cannot enable cheats in Secure Area.

## Regression checks

Use Node and Three.js **0.149.0**:

```sh
node tests/map-switch.mjs /path/to/three/build/three.module.js
node tests/gameplay.mjs /path/to/three/build/three.module.js
node tests/fortify.mjs /path/to/three/build/three.module.js
node tests/floors.mjs /path/to/three/build/three.module.js
```

These run production geometry, collision, navigation and game logic with real Three.js. DOM, audio output and GPU rendering are stubbed. They check map switching, the chalet roof slope, recon, device damage and bot accuracy, abilities, barricades, touch input mappings, mode isolation and match progression. `fortify.mjs` covers reinforcement, door barricades, 1v1 side swaps, scopes and the final kill cam. `floors.mjs` checks the three-floor map: every objective spot is reachable, every spawn has a path to every floor, and a bot and the player really climb the stairs. They do not replace visual browser or physical-phone testing.

## Controller

Any standard Xbox, PlayStation or USB/Bluetooth pad works. Press any button to start using it; menus can be driven with the D-pad/left stick and **A**.

| Button | Action |
| --- | --- |
| Left stick / right stick | Move / look |
| RT / LT | Shoot / aim down sights |
| Hold LT + click left or right stick | Lean left / right (click the same side again, or release LT, to stand straight) |
| Left stick click (not aiming) | Sprint |
| Right stick click (not aiming) | Melee |
| RB / LB | Ability / grenade |
| A / B / X / Y | Jump-vault / crouch / reload / swap weapon (Y starts the action phase during prep) |
| Hold X (defending, looking at a wall or doorway) | Reinforce wall / barricade door (tap X still reloads) |
| D-pad up / down | Cameras / drone (left-right switches camera, B exits) |
| Start / View | Pause / scoreboard |

Controller look sensitivity is in the main menu settings.

## 1v1 Duel

Pick **1V1 DUEL** on the main menu to fight a single bot. First to 5 rounds. Sides switch every 2 rounds (attack rounds 1–2, defend 3–4, and so on); round wins follow the players, not the side. Online 1v1 swaps the same way.

## Cedar Creek Compound (three floors)

A farm compound with a **basement**, a **ground floor** and an **upstairs**, linked by a switchback main stairwell, stairs in the garage up to the study, an outside staircase to a west balcony, and bulkhead stairs from the yard down into the basement. Each round the defenders get one of three objective sites — **Bunker** (basement), **Meeting Hall** (ground floor) or **Master Bedroom** (upstairs) — shown in the round banner. The objective marker shows ▲ / ▼ when the objective is on another floor. Bots path between floors, and defender bots fortify the floor the objective is on.

## Fortifying (defense)

When you defend, you can walk around during the preparation phase (30 s single-player, 15 s online) and fortify:

- **Reinforce walls:** look at a full-height soft wall and hold **T** (controller: hold **X**, touch: hold **FORTIFY**). Steel plating covers a ~1.75 m strip; it stops bullets, melee, the breaching hammer, breaching rounds and grenades.
- **Barricade doors:** look at an open interior doorway and hold the same button. The barricade breaks like any other (3 melee hits or about 6 rifle rounds).
- Each defender gets 8 reinforcements and 4 barricades in 1v1 (2 and 2 each on a full team). Defender bots fortify the walls and doors around the objective during prep. Everything resets each round.

## Sights

Pick **RED DOT / HOLO · 1X** or **1.5X SCOPE** under **SIGHT** on the main menu. The 1.5x scope zooms 1.5 times further than the standard sight when aiming, and fits the rifle, SMG and shotgun (the sidearm keeps its iron sights).

## Online multiplayer

Press **MULTIPLAYER** on the main menu. No server setup is needed: game traffic goes through free public MQTT message brokers (HiveMQ, with test.mosquitto.org as backup) over a secure WebSocket, so it works on mobile data, different Wi-Fi networks, phones and PCs. The lobby code records which broker the lobby is on, and the lobby list updates live.

- **Host:** choose TEAM or 1V1, bots on/off and public/private, then CREATE LOBBY. Share the 5-letter code or press COPY INVITE LINK (the link auto-joins).
- **Join:** type the code, open an invite link, or pick a lobby from PUBLIC LOBBIES.
- **Team:** up to 5 v 5 humans; with bots on, empty spots are filled with bots run by the host. First to 3 rounds.
- **1v1:** one attacker vs one defender, no bots. First to 5 rounds.
- The host controls map, mode, friendly fire and starts the match. If the host leaves, the lobby closes.
- Cheats are disabled online. Drones and cameras are single-player only.
- Everyone should be on the same version of the page; refresh if a join is refused for version mismatch.

## Teammate highlight

Teammates have a blue outline and a name tag that stays visible through walls (with distance when they are out of sight). Toggle it under **Settings → Teammate highlight**.

## Kill cam

After you are killed, a short replay plays from your killer's eyes, showing their gun and sight in view (aimed down sights when they were aiming), their shots, weapon and remaining health. When a round ends on a kill, everyone sees a **FINAL KILL** replay of it. Click, press Space or controller A (or tap FIRE) to skip. Toggle it under **Settings → Kill cam**.
