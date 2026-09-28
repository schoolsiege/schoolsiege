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
| 1 / 2 | Return to operator |
| F | Operator ability |

Touch controls include CAMS, DRONE, ABILITY, camera switching, jump, boost, scan and exit. Drag to look and use the left joystick to drive. Landscape provides more space.

Four fixed cameras cover key rooms on every map. Bots can shoot your drone and cameras you access; they require line of sight, take time to react and can miss. Destroyed devices return next round. Ground-level door barricades have a visible gap for drones.

Choose one of four operators in the menu. These are simplified implementations of the familiar [Siege ability types](https://www.ubisoft.com/en-us/game/rainbow-six/siege/news-updates/1iA0mBrzRBQjtnEhHSlC5G/launch-game-guide-part-2), with this game's own balance:

- **Sledge:** hammer breaks barricades or opens soft walls within 2.3m; 12 uses.
- **Ash:** two projectile breaching rounds for soft walls, barricades and nearby electronics.
- **Doc:** three stims heal 60 HP, capped at 100; aim at an injured teammate or heal yourself.
- **Pulse:** heartbeat sensor detects enemies through walls within 9m for 4 seconds; 12-second cooldown.

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
```

These run production geometry, collision, navigation and game logic with real Three.js. DOM, audio output and GPU rendering are stubbed. They check map switching, the chalet roof slope, recon, device damage and bot accuracy, abilities, barricades, touch input mappings, mode isolation and match progression. They do not replace visual browser or physical-phone testing.
