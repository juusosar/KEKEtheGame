# Item catalogue (Kespro map)

Copy of the design doc's §10 and §10.1 tables. Edit the tables here (or paste the doc's tables over
them), then run `npm run gen:items` to regenerate `packages/shared/src/data/items.kespro.json`.

How the tables are read:

- A table with a `Zone` column lists normal items (`rarity: normal`).
- A table without a `Zone` column lists joke items (`rarity: joke`, `zone: any`).
- An optional `Rarity` or `Sprite` column overrides that. The sprite defaults to the id, which is the
  frame name in the `items` atlas.
- Backticks and Markdown escapes (`dry\_goods`) are removed, so a table pasted from the doc works as is.

## 10. Normal items

| id                       | Name                                 | Zone       | Description                               |
| ------------------------ | ------------------------------------ | ---------- | ----------------------------------------- |
| `coffee_juhla_mokka`     | Paulig Juhla Mokka 500 g             | dry\_goods | The morning shift won't start without it. |
| `flour_myllyn_paras`     | Myllyn Paras vehnäjauho 2 kg         | dry\_goods | Enough for about 40 pizza bases.          |
| `pasta_barilla`          | Barilla spaghetti 5 kg               | dry\_goods | Tonight's special is… spaghetti. Again.   |
| `ketchup_felix`          | Felix ketsuppi 1 kg                  | dry\_goods | The fry station is completely out.        |
| `tomato_crush`           | K-Menu tomaattimurska 2,5 kg         | dry\_goods | Base for the house marinara.              |
| `taco_spice`             | Santa Maria tacomauste 1 kg          | dry\_goods | Taco Tuesday is in danger.                |
| `oil_rapeseed`           | K-Menu rypsiöljy 3 l                 | dry\_goods | The deep fryer is running on fumes.       |
| `chocolate_fazer`        | Fazer Sininen 200 g                  | dry\_goods | Dessert menu emergency.                   |
| `cola`                   | Coca-Cola 1,5 l                      | beverages  | The lunch rush is thirsty.                |
| `jaffa`                  | Hartwall Jaffa appelsiini 1,5 l      | beverages  | The kids' menu demands it.                |
| `novelle`                | Hartwall Novelle 0,5 l               | beverages  | Fizzy water for the fancy tables.         |
| `pommac`                 | Pommac 0,33 l                        | beverages  | Someone booked a party.                   |
| `kotikalja`              | Hartwall Kotikalja 1,5 l             | beverages  | The grandpa regulars insist.              |
| `lapin_kulta_pure`       | Lapin Kulta Pure 0,0 %               | beverages  | For the designated drivers.               |
| `butter_valio`           | Valio voi 2,5 kg                     | cold\_room | For the restaurant's croissants.          |
| `milk_valio`             | Valio kevytmaito 1 l                 | cold\_room | The latte machine is empty.               |
| `cheese_oltermanni`      | Valio Oltermanni 1 kg                | cold\_room | Burger cheese, slice it thick.            |
| `eggs`                   | Kananmunat 30 kpl                    | cold\_room | Breakfast buffet starts in an hour.       |
| `cream_whip`             | Valio vispikerma 1 l                 | cold\_room | The cake needs clouds.                    |
| `cheese_polar`           | Valio Polar 15 % 1 kg                | cold\_room | Sandwich line restock.                    |
| `mince_atria`            | Atria jauheliha 1 kg                 | meat\_fish | Meatballs for 200 people.                 |
| `sausage_sininen_lenkki` | HK Sininen lenkki                    | meat\_fish | The legendary blue sausage.               |
| `salmon_fillet`          | Lohifilee 1 kg                       | meat\_fish | Today's fish of the day.                  |
| `chicken_breast`         | Kariniemen broilerin rintafilee 2 kg | meat\_fish | Caesar salads won't make themselves.      |
| `bacon_atria`            | Atria pekoni 1 kg                    | meat\_fish | Brunch without bacon is a riot.           |
| `fries_frozen`           | Pakaste-ranskalaiset 2,5 kg          | frozen     | Fries for the whole lunch rush.           |
| `veg_mix_apetit`         | Apetit herne-maissi-paprika 2 kg     | frozen     | The classic Finnish side dish.            |
| `ice_cream_pingviini`    | Pingviini vaniljajäätelö 2 l         | frozen     | Melts fast. Run.                          |
| `fish_fingers_apetit`    | Apetit kalapuikot 1 kg               | frozen     | School lunch flashbacks.                  |
| `blueberries_frozen`     | Pakastemustikat 1 kg                 | frozen     | Pie of the week.                          |

## 10.1 Joke items (rare)

| id              | Name                      | Description                                     |
| --------------- | ------------------------- | ----------------------------------------------- |
| `kurkkumopo`    | Kurkkumopo                | A ride-on cucumber. The chef's kid demanded it. |
| `palju`         | Puulämmitteinen palju     | The staff party is this weekend. Don't ask.     |
| `kiuas`         | Sähkökiuas 9 kW           | The office sauna broke. Again.                  |
| `flamingo`      | Puhallettava flamingo 2 m | Team-building day at the lake.                  |
| `karaoke`       | Karaoke-kone              | Friday is karaoke night at the restaurant.      |
| `moose_head`    | Täytetty hirvenpää        | Decor for the new hunting-lodge theme.          |
| `rubber_boots`  | Kumisaappaat koko 48      | For the dishwasher who floods everything.       |
| `christmas_ham` | Joulukinkku 9 kg          | It's November. The boss insists.                |
| `snowblower`    | Lumilinko                 | The parking lot won't plow itself.              |
| `garden_gnome`  | Puutarhatonttu            | The new restaurant mascot.                      |
