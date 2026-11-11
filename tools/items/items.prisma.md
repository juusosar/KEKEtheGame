# Item catalogue (phase 2 supermarket map)

The phase 2 map's catalogue (design doc §9.2, phase 2 plan decision 6). Same story as the wholesale
map, in a consumer supermarket: the wholesale run failed, so the lunch restaurant's staff shop for the
kitchen in consumer sizes. Finnish product names, English one-liners for the target card.

Edit the tables here, then run `npm run gen:items` to regenerate
`packages/shared/src/data/items.prisma.json` (it rebuilds every `items.<theme>.md`). Table rules are
the same as in `items.kespro.md`:

- A table with a `Zone` column lists normal items (`rarity: normal`).
- A table without a `Zone` column lists joke items (`rarity: joke`, `zone: any`).
- An optional `Rarity` or `Sprite` column overrides that. The sprite defaults to the id, which is the
  frame name in the shared `items` atlas (drawn in `tools/art/items.ts`), so ids must not clash with
  another catalogue's.
- Store brand words stay out of names and descriptions (the brand guard checks the generated JSON).
  Private-label and other product names are fine.

Item zones (each needs `item_spawns` on the map, checked by `checkItemMap`): `produce` 4, `bakery` 4,
`dairy` 4, `frozen` 3, `pantry` 5, `drinks` 4, `candy` 3, `deli` 3. Spawns behind the deli counter
use zone `deli`, and the bottle-return dead end holds 2 `drinks` spawns.

## Normal items

| id                     | Name                            | Zone    | Description                                          |
| ---------------------- | ------------------------------- | ------- | ---------------------------------------------------- |
| `bananas`              | Banaanit 1 kg                   | produce | The smoothie bar opens at ten.                       |
| `cucumber`             | Kotimainen kurkku               | produce | The salad bar's last one became a ride-on toy.       |
| `potatoes_puikula`     | Puikula-peruna 2 kg             | produce | Mash for the meatballs. Twenty bags of it.           |
| `onions`               | Keltasipuli 1 kg                | produce | Nobody wants to chop these. Somebody has to.         |
| `rye_bread_reissumies` | Fazer Reissumies 4 kpl          | bakery  | Sandwich line restock, consumer edition.             |
| `karelian_pies`        | Karjalanpiirakka 10 kpl         | bakery  | Egg butter not included.                             |
| `cinnamon_buns`        | Korvapuusti 4 kpl               | bakery  | Coffee break is in five minutes.                     |
| `baguette_rainbow`     | Rainbow patonki 400 g           | bakery  | Garlic bread. Also a decent club.                    |
| `milk_eko`             | Valio luomumaito 1 l            | dairy   | The latte machine, one litre at a time.              |
| `oat_drink_oatly`      | Oatly kaurajuoma 1 l            | dairy   | Half the lunch crowd went oat.                       |
| `yogurt_plain`         | Valio maustamaton jogurtti 1 kg | dairy   | Tzatziki for the kebab plate.                        |
| `quark_rahka`          | Maitorahka 250 g                | dairy   | Someone in the kitchen is bulking.                   |
| `pizza_frozen`         | Rainbow pakastepizza            | frozen  | The pizza oven broke. Nobody needs to know.          |
| `meatballs_frozen`     | Pakastelihapullat 1 kg          | frozen  | Today's lunch special comes pre-rolled.              |
| `peas_frozen`          | Pakasteherneet 500 g            | frozen  | The side dish. All six bags.                         |
| `macaroni`             | Makaroni 400 g                  | pantry  | Makaronilaatikko is on the menu. Again.              |
| `porridge_rice`        | Risella puuroriisi 1 kg         | pantry  | Rice porridge for the Christmas buffet. In November. |
| `oats_elovena`         | Elovena kaurahiutaleet 1 kg     | pantry  | Breakfast porridge for the early shift.              |
| `tuna_cans`            | Rainbow tonnikala 185 g         | pantry  | Tuna salad. Twelve cans should do.                   |
| `mustard_turun`        | Turun sinappi 275 g             | pantry  | The sausage grill is out of mustard.                 |
| `orange_juice`         | Rainbow appelsiinitäysmehu 1 l  | drinks  | Brunch without juice is just lunch.                  |
| `vichy`                | Vichy Original 0,5 l            | drinks  | The chef's hangover cure.                            |
| `pepsi_max`            | Pepsi Max 1,5 l                 | drinks  | The staff fridge is empty. Mutiny looms.             |
| `energy_drink`         | Battery energiajuoma 0,33 l     | drinks  | The night shift runs on this.                        |
| `salmiakki_tyrkisk`    | Fazer Tyrkisk Peber 150 g       | candy   | A bribe for the dishwasher.                          |
| `mints_marianne`       | Fazer Marianne 220 g            | candy   | One on every bill folder.                            |
| `pick_and_mix`         | Irtokarkit 500 g                | candy   | Kids' party favours. Mostly salmiakki.               |
| `ham_slices`           | HK Viljaporsas kinkku 300 g     | deli    | Ham sandwiches, assembly-line style.                 |
| `smoked_salmon`        | Kylmäsavulohi 200 g             | deli    | Fancy toast for the fancy tables.                    |
| `rotisserie_chicken`   | Grillattu broileri              | deli    | Still warm. Someone already called a leg.            |

## Joke items (rare)

| id             | Name                       | Description                                         |
| -------------- | -------------------------- | --------------------------------------------------- |
| `toilet_paper` | Vessapaperi 48 rullaa      | Not food. Absolutely essential.                     |
| `empties_bag`  | Kassillinen tyhjiä pulloja | Forty cents each. The tip jar's retirement plan.    |
| `sled`         | Liukurikko                 | Staff sledding day. Attendance is mandatory.        |
| `trampoline`   | Trampoliini 3 m            | Team building, phase two.                           |
| `rowing_boat`  | Soutuvene                  | Fish of the day: catch it yourself.                 |
| `gas_grill`    | Kaasugrilli                | The stove broke, so it's summer menu now.           |
| `big_tv`       | Televisio 65"              | The regulars want the hockey on.                    |
| `ice_auger`    | Pilkkikaira                | The lake is frozen. The fish supplier isn't coming. |
| `giant_teddy`  | Jättinalle 150 cm          | Employee of the month gets a hug.                   |
| `plastic_tree` | Muovikuusi 2 m             | Goes with the November ham.                         |
