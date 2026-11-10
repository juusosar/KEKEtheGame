# Weapons (§7)

Copy of the weapon table in the design doc's §7. `tools/weapons-table.test.ts` checks that
`packages/shared/src/data/weapons.json` agrees with it (name, behaviour, damage, uses, cooldown, rarity).
When the doc's table changes, paste it here and update the JSON; the JSON also holds the stats the table
does not give (ranges, arcs, speeds), which are starting values for playtests.

| id                  | Name               | Behaviour          | Damage             | Uses              | Cooldown | Effect                                                                                   | Rarity       |
| ------------------- | ------------------ | ------------------ | ------------------ | ----------------- | -------- | ---------------------------------------------------------------------------------------- | ------------ |
| `fists`             | Fists              | melee              | 5                  | ∞                 | 0.4 s    | Small shove                                                                              | — (fallback) |
| `baguette`          | Baguette           | melee              | 10                 | 20 swings         | 0.35 s   | Fast, wide arc                                                                           | common       |
| `frozen_salmon`     | Frozen salmon      | melee              | 18                 | 12 swings         | 0.9 s    | Heavy knockback                                                                          | common       |
| `rolling_pin`       | Rolling pin        | melee              | 12                 | 15 swings         | 0.6 s    | Stun 0.8 s                                                                               | uncommon     |
| `ketchup_bottle`    | Ketchup bottle     | spray (short cone) | 3 / tick           | 3 s of spray      | —        | Slows target 40% for 1.5 s                                                               | common       |
| `egg_carton`        | Egg carton         | thrown ×6          | 8                  | 6 eggs            | 0.3 s    | Small splash (r = 32 px)                                                                 | common       |
| `soda_bottle`       | Shaken soda bottle | thrown ×2          | 6                  | 2 bottles         | 0.8 s    | Bursts into a fizz spray: area knockback (r = 64 px)                                     | uncommon     |
| `cast_iron_pan`     | Cast-iron pan      | melee + block      | 15                 | 15 swings         | 0.7 s    | Hold block: reflects projectiles, −70% melee damage taken, 50% move speed while blocking | uncommon     |
| `banana_peels`      | Banana peels       | trap ×3            | 0                  | 3 peels           | 0.5 s    | Target slips: slides 1 s uncontrollably and drops carried item. Peels last 45 s          | common       |
| `fire_extinguisher` | Fire extinguisher  | spray (wide cone)  | 0                  | 4 s of spray      | —        | Strong push, blocks vision slightly                                                      | uncommon     |
| `champagne_bottle`  | Champagne bottle   | shot\_then\_melee  | 20 shot / 12 melee | 1 cork + 8 swings | 0.6 s    | Long-range cork shot, then becomes a melee weapon                                        | rare         |
| `pallet_jack`       | Pallet jack        | charge             | 25                 | 3 charges         | 1.5 s    | Dash 6 tiles, knocks down everything in its line (players, NPCs, loose items scatter)    | rare         |

Rarity weights: common 55, uncommon 33, rare 12 (config `weaponRarityWeights`).
