import { db } from "./client.js";
import { sql } from "drizzle-orm";

type SeedPlace = {
  name: string;
  kind: "town" | "region" | "mountain_pass" | "natural_feature";
  region?: string;
  lat: number;
  lon: number;
};

// All 212 Slovenian municipalities, pulled from OpenStreetMap's admin
// boundaries (Overpass API: boundary=administrative, admin_level=8,
// filtered to ISO3166-2 starting "SI-" — an early attempt at this query
// leaked in a batch of Austrian Gemeinde relations, since admin_level=8
// isn't a globally consistent granularity). Point = each municipality's
// boundary centroid, not the settlement's own coordinates, so for
// irregularly-shaped municipalities this can sit a few km from the actual
// town — acceptable for "roughly where a rider means", since GraphHopper
// snaps to the nearest real road regardless. Validated all 225 seeded
// points against GraphHopper's GET /nearest: 224 snap within a couple
// hundred meters of a real road at worst. Kranjska Gora was the one
// exception — its centroid fell in roadless alpine terrain and GraphHopper
// couldn't snap it at all (500 "Nearest point cannot be found"), so that
// entry below uses the actual settlement point instead. Worth re-running
// this check if this list grows to include other large/mountainous
// municipalities (Bovec, Bohinj, Kranj's alpine reaches, etc. all snapped
// fine, but the failure mode is real and this was found by luck, not by
// checking every entry ahead of time).
//
// This replaced an earlier hand-typed list of ~30 towns after a live bug
// report: "Ivančna Gorica" wasn't in that list, so gazetteer.ts's trigram
// search matched it to "Nova Gorica" (0.35 similarity, barely over the
// 0.3 threshold, plausible-looking but a completely different town 100km
// away) instead of correctly reporting "not found". A curated list will
// always have gaps; real municipality data mostly closes them.
const MUNICIPALITY_TOWNS: SeedPlace[] = [
  { name: "Ajdovščina", kind: "town", lat: 45.9123, lon: 13.9314 },
  { name: "Ankaran / Ancarano", kind: "town", lat: 45.5944, lon: 13.6933 },
  { name: "Apače", kind: "town", lat: 46.691, lon: 15.8733 },
  { name: "Beltinci", kind: "town", lat: 46.6079, lon: 16.2235 },
  { name: "Benedikt", kind: "town", lat: 46.614, lon: 15.8932 },
  { name: "Bistrica ob Sotli", kind: "town", lat: 46.0593, lon: 15.6597 },
  { name: "Bled", kind: "town", lat: 46.3485, lon: 14.0697 },
  { name: "Bloke", kind: "town", lat: 45.7871, lon: 14.508 },
  { name: "Bohinj", kind: "town", lat: 46.302, lon: 13.953 },
  { name: "Borovnica", kind: "town", lat: 45.9112, lon: 14.377 },
  { name: "Bovec", kind: "town", lat: 46.3563, lon: 13.6181 },
  { name: "Braslovče", kind: "town", lat: 46.2804, lon: 15.0285 },
  { name: "Brda", kind: "town", lat: 46.0162, lon: 13.5543 },
  { name: "Brezovica", kind: "town", lat: 45.948, lon: 14.4272 },
  { name: "Brežice", kind: "town", lat: 45.9376, lon: 15.6116 },
  { name: "Cankova", kind: "town", lat: 46.7329, lon: 16.0241 },
  { name: "Celje", kind: "town", lat: 46.2548, lon: 15.2811 },
  { name: "Cerklje na Gorenjskem", kind: "town", lat: 46.2551, lon: 14.5066 },
  { name: "Cerknica", kind: "town", lat: 45.7984, lon: 14.3802 },
  { name: "Cerkno", kind: "town", lat: 46.1244, lon: 13.9788 },
  { name: "Cerkvenjak", kind: "town", lat: 46.5597, lon: 15.9418 },
  { name: "Cirkulane", kind: "town", lat: 46.345, lon: 15.9934 },
  { name: "Destrnik", kind: "town", lat: 46.4789, lon: 15.8795 },
  { name: "Divača", kind: "town", lat: 45.6867, lon: 14.0165 },
  { name: "Dobje", kind: "town", lat: 46.1348, lon: 15.4001 },
  { name: "Dobrepolje", kind: "town", lat: 45.81, lon: 14.738 },
  { name: "Dobrna", kind: "town", lat: 46.3528, lon: 15.2269 },
  { name: "Dobrova-Polhov Gradec", kind: "town", lat: 46.0596, lon: 14.3155 },
  { name: "Dobrovnik / Dobronak", kind: "town", lat: 46.6511, lon: 16.3487 },
  { name: "Dol pri Ljubljani", kind: "town", lat: 46.0966, lon: 14.6721 },
  { name: "Dolenjske Toplice", kind: "town", lat: 45.7149, lon: 15.0408 },
  { name: "Domžale", kind: "town", lat: 46.1505, lon: 14.6295 },
  { name: "Dornava", kind: "town", lat: 46.4543, lon: 15.9857 },
  { name: "Dravograd", kind: "town", lat: 46.5913, lon: 15.0241 },
  { name: "Duplek", kind: "town", lat: 46.5093, lon: 15.7649 },
  { name: "Gorenja vas-Poljane", kind: "town", lat: 46.1089, lon: 14.1229 },
  { name: "Gorišnica", kind: "town", lat: 46.4047, lon: 16.0151 },
  { name: "Gorje", kind: "town", lat: 46.3946, lon: 13.9693 },
  { name: "Gornja Radgona", kind: "town", lat: 46.6362, lon: 15.9595 },
  { name: "Gornji Grad", kind: "town", lat: 46.2961, lon: 14.7872 },
  { name: "Gornji Petrovci", kind: "town", lat: 46.7993, lon: 16.1981 },
  { name: "Grad", kind: "town", lat: 46.7947, lon: 16.0949 },
  { name: "Grosuplje", kind: "town", lat: 45.9443, lon: 14.6694 },
  { name: "Hajdina", kind: "town", lat: 46.4199, lon: 15.83 },
  { name: "Hodoš / Hodos", kind: "town", lat: 46.8317, lon: 16.3208 },
  { name: "Horjul", kind: "town", lat: 46.0197, lon: 14.2886 },
  { name: "Hoče-Slivnica", kind: "town", lat: 46.4901, lon: 15.6234 },
  { name: "Hrastnik", kind: "town", lat: 46.135, lon: 15.1234 },
  { name: "Hrpelje-Kozina", kind: "town", lat: 45.5628, lon: 14.0002 },
  { name: "Idrija", kind: "town", lat: 45.9838, lon: 14.0005 },
  { name: "Ig", kind: "town", lat: 45.9335, lon: 14.5189 },
  { name: "Ilirska Bistrica", kind: "town", lat: 45.5772, lon: 14.2966 },
  { name: "Ivančna Gorica", kind: "town", lat: 45.9042, lon: 14.8149 },
  { name: "Izola / Isola", kind: "town", lat: 45.5474, lon: 13.6165 },
  { name: "Jesenice", kind: "town", lat: 46.4459, lon: 14.0702 },
  { name: "Jezersko", kind: "town", lat: 46.3864, lon: 14.4833 },
  { name: "Juršinci", kind: "town", lat: 46.483, lon: 15.9752 },
  { name: "Kamnik", kind: "town", lat: 46.275, lon: 14.7318 },
  { name: "Kanal", kind: "town", lat: 46.0841, lon: 13.6507 },
  { name: "Kidričevo", kind: "town", lat: 46.3978, lon: 15.7441 },
  { name: "Kobarid", kind: "town", lat: 46.2432, lon: 13.5553 },
  { name: "Kobilje", kind: "town", lat: 46.6814, lon: 16.3907 },
  { name: "Komen", kind: "town", lat: 45.8193, lon: 13.7519 },
  { name: "Komenda", kind: "town", lat: 46.2072, lon: 14.5416 },
  { name: "Koper / Capodistria", kind: "town", lat: 45.5266, lon: 13.7976 },
  { name: "Kostanjevica na Krki", kind: "town", lat: 45.8415, lon: 15.4227 },
  { name: "Kostel", kind: "town", lat: 45.4996, lon: 14.8748 },
  { name: "Kozje", kind: "town", lat: 46.0649, lon: 15.5552 },
  { name: "Kočevje", kind: "town", lat: 45.6309, lon: 14.9046 },
  { name: "Kranj", kind: "town", lat: 46.2541, lon: 14.2932 },
  // The municipality-boundary centroid (46.4502, 13.8444) landed somewhere
  // GraphHopper couldn't snap to any road at all — verified via GET
  // /nearest, which returned a 500 "Nearest point cannot be found". Kranjska
  // Gora's municipality includes a lot of roadless alpine terrain, and its
  // polygon centroid fell into it. This is the actual village/settlement
  // point instead (Nominatim, type=village), confirmed routable.
  { name: "Kranjska Gora", kind: "town", lat: 46.4851, lon: 13.7844 },
  { name: "Križevci", kind: "town", lat: 46.5668, lon: 16.1214 },
  { name: "Krško", kind: "town", lat: 45.9463, lon: 15.4523 },
  { name: "Kungota", kind: "town", lat: 46.6414, lon: 15.6024 },
  { name: "Kuzma", kind: "town", lat: 46.8399, lon: 16.0959 },
  { name: "Laško", kind: "town", lat: 46.128, lon: 15.2436 },
  { name: "Lenart", kind: "town", lat: 46.5542, lon: 15.81 },
  { name: "Lendava / Lendva", kind: "town", lat: 46.5548, lon: 16.4546 },
  { name: "Litija", kind: "town", lat: 46.0497, lon: 14.9056 },
  { name: "Ljubljana", kind: "town", lat: 46.06, lon: 14.582 },
  { name: "Ljubno", kind: "town", lat: 46.3668, lon: 14.839 },
  { name: "Ljutomer", kind: "town", lat: 46.5222, lon: 16.1399 },
  { name: "Log-Dragomer", kind: "town", lat: 46.0133, lon: 14.3726 },
  { name: "Logatec", kind: "town", lat: 45.9424, lon: 14.2 },
  { name: "Lovrenc na Pohorju", kind: "town", lat: 46.5243, lon: 15.3841 },
  { name: "Loška Dolina", kind: "town", lat: 45.6643, lon: 14.4748 },
  { name: "Loški Potok", kind: "town", lat: 45.6625, lon: 14.6363 },
  { name: "Lukovica", kind: "town", lat: 46.175, lon: 14.7728 },
  { name: "Luče", kind: "town", lat: 46.3568, lon: 14.7252 },
  { name: "Majšperk", kind: "town", lat: 46.3157, lon: 15.7404 },
  { name: "Makole", kind: "town", lat: 46.3127, lon: 15.6754 },
  { name: "Maribor", kind: "town", lat: 46.5668, lon: 15.6446 },
  { name: "Markovci", kind: "town", lat: 46.3911, lon: 15.9437 },
  { name: "Medvode", kind: "town", lat: 46.1346, lon: 14.3981 },
  { name: "Mengeš", kind: "town", lat: 46.1634, lon: 14.553 },
  { name: "Metlika", kind: "town", lat: 45.6493, lon: 15.3061 },
  { name: "Mežica", kind: "town", lat: 46.5203, lon: 14.8603 },
  { name: "Miklavž na Dravskem polju", kind: "town", lat: 46.4884, lon: 15.7069 },
  { name: "Miren-Kostanjevica", kind: "town", lat: 45.8599, lon: 13.6469 },
  { name: "Mirna", kind: "town", lat: 45.9463, lon: 15.0571 },
  { name: "Mirna Peč", kind: "town", lat: 45.8542, lon: 15.0825 },
  { name: "Mislinja", kind: "town", lat: 46.4471, lon: 15.2255 },
  { name: "Mokronog-Trebelno", kind: "town", lat: 45.9235, lon: 15.1625 },
  { name: "Moravske Toplice", kind: "town", lat: 46.7107, lon: 16.2748 },
  { name: "Moravče", kind: "town", lat: 46.1318, lon: 14.7609 },
  { name: "Mozirje", kind: "town", lat: 46.3513, lon: 14.9483 },
  { name: "Murska Sobota", kind: "town", lat: 46.6494, lon: 16.1679 },
  { name: "Muta", kind: "town", lat: 46.6257, lon: 15.1361 },
  { name: "Naklo", kind: "town", lat: 46.2874, lon: 14.2991 },
  { name: "Nazarje", kind: "town", lat: 46.2863, lon: 14.9128 },
  { name: "Nova Gorica", kind: "town", lat: 45.971, lon: 13.7385 },
  { name: "Novo mesto", kind: "town", lat: 45.7807, lon: 15.2046 },
  { name: "Odranci", kind: "town", lat: 46.5852, lon: 16.2746 },
  { name: "Oplotnica", kind: "town", lat: 46.3889, lon: 15.4465 },
  { name: "Ormož", kind: "town", lat: 46.4393, lon: 16.1437 },
  { name: "Osilnica", kind: "town", lat: 45.5508, lon: 14.7403 },
  { name: "Pesnica", kind: "town", lat: 46.6178, lon: 15.7077 },
  { name: "Piran / Pirano", kind: "town", lat: 45.5265, lon: 13.5484 },
  { name: "Pivka", kind: "town", lat: 45.6887, lon: 14.2515 },
  { name: "Podlehnik", kind: "town", lat: 46.3153, lon: 15.8647 },
  { name: "Podvelka", kind: "town", lat: 46.5831, lon: 15.3595 },
  { name: "Podčetrtek", kind: "town", lat: 46.1362, lon: 15.5815 },
  { name: "Poljčane", kind: "town", lat: 46.3043, lon: 15.5991 },
  { name: "Polzela", kind: "town", lat: 46.3029, lon: 15.0845 },
  { name: "Postojna", kind: "town", lat: 45.7903, lon: 14.1842 },
  { name: "Prebold", kind: "town", lat: 46.221, lon: 15.093 },
  { name: "Preddvor", kind: "town", lat: 46.3241, lon: 14.4592 },
  { name: "Prevalje", kind: "town", lat: 46.5549, lon: 14.8905 },
  { name: "Ptuj", kind: "town", lat: 46.4415, lon: 15.8606 },
  { name: "Puconci", kind: "town", lat: 46.7551, lon: 16.1289 },
  { name: "Radenci", kind: "town", lat: 46.6204, lon: 16.0519 },
  { name: "Radeče", kind: "town", lat: 46.0595, lon: 15.1513 },
  { name: "Radlje ob Dravi", kind: "town", lat: 46.5903, lon: 15.2478 },
  { name: "Radovljica", kind: "town", lat: 46.345, lon: 14.191 },
  { name: "Ravne na Koroškem", kind: "town", lat: 46.5484, lon: 14.9493 },
  { name: "Razkrižje", kind: "town", lat: 46.5197, lon: 16.2761 },
  { name: "Rače-Fram", kind: "town", lat: 46.4475, lon: 15.6346 },
  { name: "Renče-Vogrsko", kind: "town", lat: 45.8951, lon: 13.6711 },
  { name: "Rečica ob Savinji", kind: "town", lat: 46.3323, lon: 14.9052 },
  { name: "Ribnica", kind: "town", lat: 45.7287, lon: 14.7012 },
  { name: "Ribnica na Pohorju", kind: "town", lat: 46.528, lon: 15.2568 },
  { name: "Rogatec", kind: "town", lat: 46.2375, lon: 15.7374 },
  { name: "Rogaška Slatina", kind: "town", lat: 46.2378, lon: 15.6447 },
  { name: "Rogašovci", kind: "town", lat: 46.7976, lon: 16.025 },
  { name: "Ruše", kind: "town", lat: 46.5194, lon: 15.4796 },
  { name: "Selnica ob Dravi", kind: "town", lat: 46.5942, lon: 15.4776 },
  { name: "Semič", kind: "town", lat: 45.6523, lon: 15.1516 },
  { name: "Sevnica", kind: "town", lat: 46.0086, lon: 15.2561 },
  { name: "Sežana", kind: "town", lat: 45.7265, lon: 13.8543 },
  { name: "Slovenj Gradec", kind: "town", lat: 46.4925, lon: 15.0744 },
  { name: "Slovenska Bistrica", kind: "town", lat: 46.4074, lon: 15.5102 },
  { name: "Slovenske Konjice", kind: "town", lat: 46.3248, lon: 15.4549 },
  { name: "Sodražica", kind: "town", lat: 45.7548, lon: 14.6147 },
  { name: "Solčava", kind: "town", lat: 46.4031, lon: 14.659 },
  { name: "Središče ob Dravi", kind: "town", lat: 46.4088, lon: 16.2574 },
  { name: "Starše", kind: "town", lat: 46.4652, lon: 15.7629 },
  { name: "Straža", kind: "town", lat: 45.7747, lon: 15.0885 },
  { name: "Sveta Ana", kind: "town", lat: 46.6541, lon: 15.8401 },
  { name: "Sveta Trojica v Slovenskih goricah", kind: "town", lat: 46.5669, lon: 15.8932 },
  { name: "Sveti Andraž v Slovenskih goricah", kind: "town", lat: 46.5182, lon: 15.961 },
  { name: "Sveti Jurij ob Ščavnici", kind: "town", lat: 46.5618, lon: 16.0267 },
  { name: "Sveti Jurij v Slovenskih goricah", kind: "town", lat: 46.6132, lon: 15.7943 },
  { name: "Sveti Tomaž", kind: "town", lat: 46.4765, lon: 16.0634 },
  { name: "Tabor", kind: "town", lat: 46.2244, lon: 15.0082 },
  { name: "Tišina", kind: "town", lat: 46.6581, lon: 16.0819 },
  { name: "Tolmin", kind: "town", lat: 46.1439, lon: 13.8137 },
  { name: "Trbovlje", kind: "town", lat: 46.1372, lon: 15.0449 },
  { name: "Trebnje", kind: "town", lat: 45.9083, lon: 14.9841 },
  { name: "Trnovska vas", kind: "town", lat: 46.5261, lon: 15.8879 },
  { name: "Trzin", kind: "town", lat: 46.1276, lon: 14.5516 },
  { name: "Tržič", kind: "town", lat: 46.3804, lon: 14.3378 },
  { name: "Turnišče", kind: "town", lat: 46.615, lon: 16.3166 },
  { name: "Velenje", kind: "town", lat: 46.3746, lon: 15.1346 },
  { name: "Velika Polana", kind: "town", lat: 46.5782, lon: 16.3615 },
  { name: "Velike Lašče", kind: "town", lat: 45.8502, lon: 14.5898 },
  { name: "Veržej", kind: "town", lat: 46.5832, lon: 16.1638 },
  { name: "Videm", kind: "town", lat: 46.343, lon: 15.8813 },
  { name: "Vipava", kind: "town", lat: 45.8213, lon: 13.9806 },
  { name: "Vitanje", kind: "town", lat: 46.4055, lon: 15.2921 },
  { name: "Vodice", kind: "town", lat: 46.1708, lon: 14.4985 },
  { name: "Vojnik", kind: "town", lat: 46.3141, lon: 15.3071 },
  { name: "Vransko", kind: "town", lat: 46.2338, lon: 14.9473 },
  { name: "Vrhnika", kind: "town", lat: 45.9476, lon: 14.286 },
  { name: "Vuzenica", kind: "town", lat: 46.5648, lon: 15.159 },
  { name: "Zagorje ob Savi", kind: "town", lat: 46.1287, lon: 14.9488 },
  { name: "Zavrč", kind: "town", lat: 46.3639, lon: 16.0465 },
  { name: "Zreče", kind: "town", lat: 46.4068, lon: 15.3664 },
  { name: "Črenšovci", kind: "town", lat: 46.5616, lon: 16.2918 },
  { name: "Črna na Koroškem", kind: "town", lat: 46.4647, lon: 14.8205 },
  { name: "Črnomelj", kind: "town", lat: 45.5252, lon: 15.2196 },
  { name: "Šalovci", kind: "town", lat: 46.8238, lon: 16.2441 },
  { name: "Šempeter-Vrtojba", kind: "town", lat: 45.9178, lon: 13.6488 },
  { name: "Šentilj", kind: "town", lat: 46.6696, lon: 15.7135 },
  { name: "Šentjernej", kind: "town", lat: 45.8249, lon: 15.3294 },
  { name: "Šentjur", kind: "town", lat: 46.1887, lon: 15.433 },
  { name: "Šentrupert", kind: "town", lat: 45.9848, lon: 15.094 },
  { name: "Šenčur", kind: "town", lat: 46.2395, lon: 14.4276 },
  { name: "Škocjan", kind: "town", lat: 45.9139, lon: 15.2869 },
  { name: "Škofja Loka", kind: "town", lat: 46.1688, lon: 14.2784 },
  { name: "Škofljica", kind: "town", lat: 45.9567, lon: 14.5735 },
  { name: "Šmarje pri Jelšah", kind: "town", lat: 46.217, lon: 15.5188 },
  { name: "Šmarješke Toplice", kind: "town", lat: 45.8875, lon: 15.2496 },
  { name: "Šmartno ob Paki", kind: "town", lat: 46.3398, lon: 15.0294 },
  { name: "Šmartno pri Litiji", kind: "town", lat: 46.0171, lon: 14.837 },
  { name: "Šoštanj", kind: "town", lat: 46.4024, lon: 14.9861 },
  { name: "Štore", kind: "town", lat: 46.1982, lon: 15.3198 },
  { name: "Žalec", kind: "town", lat: 46.2612, lon: 15.1613 },
  { name: "Železniki", kind: "town", lat: 46.2183, lon: 14.1166 },
  { name: "Žetale", kind: "town", lat: 46.2882, lon: 15.8088 },
  { name: "Žiri", kind: "town", lat: 46.0442, lon: 14.1072 },
  { name: "Žirovnica", kind: "town", lat: 46.4064, lon: 14.1776 },
  { name: "Žužemberk", kind: "town", lat: 45.8072, lon: 14.9411 },
];

// Notable places that aren't municipalities in their own right, so the
// query above doesn't find them, plus regions and mountain passes/roads
// riders name directly (from PROJECT_SPEC.md §4.2's system-prompt
// vocabulary). Hand-curated, not survey-grade.
const SUPPLEMENTAL_PLACES: SeedPlace[] = [
  // Villages/valleys riders name directly, not municipality seats
  // This entry was wrong for the entire session until a live bug report
  // caught it: (45.9339, 14.5914) was a hand-typed value from memory, never
  // actually verified like the rest of the gazetteer — off by ~12.6km from
  // the real village (confirmed via Nominatim, which places it in Brezovica
  // municipality). Every earlier "ride to/around Rakitna" demo in this
  // session was quietly routing to an empty patch of forest instead.
  { name: "Rakitna", kind: "town", region: "Notranjska", lat: 45.891, lon: 14.4405 },
  { name: "Trenta", kind: "town", region: "Primorska", lat: 46.3603, lon: 13.7593 },

  // Regions
  { name: "Gorenjska", kind: "region", lat: 46.3600, lon: 14.1000 },
  { name: "Notranjska", kind: "region", lat: 45.8300, lon: 14.3200 },
  { name: "Primorska", kind: "region", lat: 45.8500, lon: 13.7500 },
  { name: "Dolenjska", kind: "region", lat: 45.8000, lon: 15.1700 },
  { name: "Štajerska", kind: "region", lat: 46.3300, lon: 15.4000 },
  { name: "Koroška", kind: "region", lat: 46.5200, lon: 14.9500 },
  { name: "Prekmurje", kind: "region", lat: 46.6600, lon: 16.1700 },

  // Mountain passes & notable roads
  { name: "Vršič", kind: "mountain_pass", region: "Gorenjska", lat: 46.4331, lon: 13.7478 },
  { name: "Mangart", kind: "mountain_pass", region: "Primorska", lat: 46.4389, lon: 13.6122 },
  { name: "Pokljuka", kind: "natural_feature", region: "Gorenjska", lat: 46.3389, lon: 13.9333 },
  { name: "Črni Kal", kind: "natural_feature", region: "Primorska", lat: 45.5486, lon: 13.9219 },
];

const SEED_PLACES: SeedPlace[] = [...MUNICIPALITY_TOWNS, ...SUPPLEMENTAL_PLACES];

async function main() {
  await db.execute(sql`TRUNCATE TABLE places`);
  console.log(`Seeding ${SEED_PLACES.length} places…`);
  for (const p of SEED_PLACES) {
    await db.execute(sql`
      INSERT INTO places (name, kind, region, geom)
      VALUES (${p.name}, ${p.kind}, ${p.region ?? null}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326))
    `);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
