/**
 * The Made Of knowledge base. The canonical source of truth for items.
 *
 * Rules:
 *  - `name` is the lowercase display name (may contain spaces). The slug
 *    is derived at load time.
 *  - Recipes have 1..n alternatives. Each lists what the item is
 *    `made from` (f), `made with` (w, tools), `needs` (n) and what it
 *    `evolved from` (e). If one recipe, drop the label.
 *  - Item-level links are `n` (needs) and `s` (comes from).
 *  - Do not add non-physical items here (sunlight, lightning, electricity,
 *    internet, fire). They are not entities in this app.
 */

import type { DataItem } from "./types";

export const ITEMS: DataItem[] = [
  {
    name: "big bang",
    tier: "F",
    kind: "cosmic",
    firstAppeared: "13.8bya",
    fact: "The start of everything. Almost all the hydrogen and helium that exists was made in its first few minutes.",
    tags: ["combine-exclude"],
  },
  {
    name: "hydrogen",
    tier: "F",
    kind: "element",
    firstAppeared: "13.8bya",
    symbol: "H",
    fact: "The simplest element: one proton, one electron. About nine in every ten atoms in the universe are hydrogen.",
    recipes: [
      {
        f: ["big bang"],
      },
    ],
  },
  {
    name: "helium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.8bya",
    symbol: "He",
    fact: "The second most common element. Most of it was made in the first few minutes after the big bang.",
    recipes: [
      {
        f: ["big bang"],
      },
    ],
  },
  {
    name: "lithium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.8bya",
    symbol: "Li",
    fact: "One of only three elements made in the big bang, though stars made most of it later. The lightest metal, light enough to float on oil.",
    recipes: [
      {
        f: ["big bang"],
      },
    ],
  },
  {
    name: "star",
    tier: "F",
    kind: "cosmic",
    firstAppeared: "13.6bya",
    fact: "A star is a fusion furnace. It squeezes light elements into heavier ones, and every carbon atom in your body was made inside one.",
    recipes: [
      {
        f: ["hydrogen","helium"],
      },
    ],
  },
  {
    name: "supernova",
    tier: "F",
    kind: "cosmic",
    firstAppeared: "13.6bya",
    fact: "When a massive star dies it explodes, scattering the elements it made across space. Later stars and planets form from that debris.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "neutron star merger",
    tier: "F",
    kind: "cosmic",
    firstAppeared: "?",
    fact: "When two dead star cores collide, they forge the heaviest elements. Much of Earth's gold may have been made this way, or in rare collapsing giant stars.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "sun",
    tier: "F",
    kind: "cosmic",
    firstAppeared: "4.6bya",
    fact: "Our local star. It turns about 4 million tonnes of matter into energy every second.",
    recipes: [
      {
        f: ["hydrogen","helium"],
      },
    ],
  },
  {
    name: "carbon",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "C",
    fact: "The backbone of all life. Stars make it by fusing three helium nuclei together.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "oxygen",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "O",
    fact: "The most common element in Earth's crust by weight. Most of it is locked up in rock, not air.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "nitrogen",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "N",
    fact: "Makes up 78% of the air you breathe. Plants need it to build proteins but can't take it from the air directly.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "sodium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Na",
    fact: "A soft metal that bursts into flame in water. It is half of table salt.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "silicon",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Si",
    fact: "The second most common element in Earth's crust, after oxygen. Rock, sand and computer chips are all built on it.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "iron",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Fe",
    fact: "The end point of fusion in stars. Making anything heavier than iron costs a star energy instead of releasing it.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "aluminium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Al",
    fact: "The most common metal in Earth's crust, but so hard to extract that it was once more precious than gold.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "copper",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Cu",
    fact: "One of the first metals people worked, about 10,000 years ago. It carries electricity better than almost anything.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "tin",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Sn",
    fact: "Mixed with copper it makes bronze, which gave the Bronze Age its name.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "calcium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Ca",
    fact: "Builds your bones, seashells and limestone cliffs.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "chlorine",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Cl",
    fact: "A poisonous gas on its own. Paired with sodium it becomes the salt on your table.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "gold",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "Au",
    fact: "All the gold ever mined would fit in a cube about 22 metres on each side.",
    recipes: [
      {
        f: ["neutron star merger"],
      },
    ],
  },
  {
    name: "magnesium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Mg",
    fact: "Sits at the heart of every chlorophyll molecule. Without it, plants couldn't capture sunlight.",
    recipes: [
      {
        f: ["star"],
      },
    ],
  },
  {
    name: "hydrothermal vent",
    tier: "N",
    kind: "place",
    firstAppeared: "~4.4bya",
    fact: "Cracks in the sea floor where hot, mineral-rich water meets the cold ocean. Many scientists think life began at places like this.",
    recipes: [
      {
        f: ["rock","seawater"],
      },
    ],
  },
  {
    name: "hot spring pool",
    tier: "N",
    kind: "place",
    firstAppeared: "?",
    fact: "Pools on volcanic land that dry out and refill. Some scientists think repeated drying and wetting here strung life's first molecules together.",
    recipes: [
      {
        f: ["rock","water"],
      },
    ],
  },
  {
    name: "meteorite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Rocks that fall from space. The Murchison meteorite, which landed in Australia in 1969, contains dozens of amino acids formed in space.",
    recipes: [
      {
        f: ["rock","iron","carbon"],
      },
    ],
  },
  {
    name: "early amniotes",
    tier: "N",
    kind: "living",
    firstAppeared: "~320mya",
    fact: "The first animals to lay eggs with shells, about 320 million years ago. Their descendants split into two lines: reptiles and synapsids.",
    recipes: [
      {
        n: ["air"],
        e: ["amphibians"],
      },
    ],
  },
  {
    name: "synapsids",
    tier: "N",
    kind: "living",
    firstAppeared: "~306mya",
    fact: "The line that leads to mammals. Early synapsids like Dimetrodon looked reptile-like but were never reptiles.",
    recipes: [
      {
        n: ["air"],
        e: ["early amniotes"],
      },
    ],
  },
  {
    name: "amino acids",
    tier: "N",
    kind: "substance",
    firstAppeared: "?",
    fact: "Just 20 kinds build every protein in your body. Where life's first amino acids came from is still open: sea-floor vents, lightning and meteorites are all candidates.",
    recipes: [
      {
        label: "at vents",
        f: ["carbon","hydrogen","nitrogen","oxygen"],
        n: ["hydrothermal vent"],
      },
      {
        label: "by lightning",
        f: ["carbon","hydrogen","nitrogen","oxygen"],
      },
      {
        label: "from space",
        f: ["carbon","hydrogen","nitrogen","oxygen"],
        n: ["meteorite"],
      },
    ],
  },
  {
    name: "nucleotides",
    tier: "N",
    kind: "substance",
    firstAppeared: "?",
    fact: "The letters of the genetic code. DNA uses only four: A, C, G and T. The best lab recipes so far use sunlight and shallow water.",
    recipes: [
      {
        label: "at vents",
        f: ["carbon","hydrogen","nitrogen","oxygen","phosphorus"],
        n: ["hydrothermal vent"],
      },
      {
        label: "in sunlit pools",
        f: ["carbon","hydrogen","nitrogen","oxygen","phosphorus"],
        n: ["hot spring pool"],
      },
    ],
  },
  {
    name: "lipids",
    tier: "N",
    kind: "substance",
    firstAppeared: "?",
    fact: "Fatty molecules that avoid water. Dropped in water, they gather into tiny hollow bubbles all by themselves.",
    recipes: [
      {
        f: ["carbon","hydrogen","oxygen"],
      },
    ],
  },
  {
    name: "RNA",
    tier: "M",
    kind: "substance",
    firstAppeared: "~4.2bya",
    fact: "Can carry genetic information and also speed up chemical reactions. Many scientists think the earliest life ran on RNA alone.",
    recipes: [
      {
        label: "at vents",
        f: ["nucleotides"],
        n: ["hydrothermal vent"],
      },
      {
        label: "in drying pools",
        f: ["nucleotides"],
        n: ["hot spring pool"],
      },
    ],
  },
  {
    name: "proteins",
    tier: "M",
    kind: "substance",
    firstAppeared: "~4.2bya",
    fact: "Long chains of amino acids folded into precise shapes. They do almost all the work inside a cell.",
    recipes: [
      {
        f: ["amino acids"],
        w: ["ribosome"],
      },
    ],
  },
  {
    name: "ribosome",
    tier: "C",
    kind: "part",
    firstAppeared: "~4.2bya",
    fact: "The cell's protein factory. Its working core is made of RNA, a strong clue that RNA came before proteins.",
    recipes: [
      {
        label: "RNA world",
        f: ["RNA"],
      },
      {
        label: "modern",
        f: ["RNA","proteins"],
      },
    ],
  },
  {
    name: "DNA",
    tier: "M",
    kind: "substance",
    firstAppeared: "~4.2bya",
    fact: "A sturdier store of genetic information than RNA. Stretched out, the DNA in one of your cells would be about 2 metres long.",
    recipes: [
      {
        f: ["nucleotides"],
        w: ["proteins"],
      },
    ],
  },
  {
    name: "cell membrane",
    tier: "C",
    kind: "part",
    firstAppeared: "~4.2bya",
    fact: "A skin just two molecules thick that separates life from everything else.",
    recipes: [
      {
        label: "first",
        f: ["lipids"],
      },
      {
        label: "modern",
        f: ["lipids","proteins"],
      },
    ],
  },
  {
    name: "LUCA",
    tier: "N",
    kind: "living",
    firstAppeared: "~4.2bya",
    fact: "The last universal common ancestor: the single-celled organism every living thing on Earth descends from. Where it lived is still argued.",
    recipes: [
      {
        label: "at vents",
        f: ["DNA","RNA","proteins","ribosome","cell membrane"],
        n: ["hydrothermal vent"],
      },
      {
        label: "elsewhere",
        f: ["DNA","RNA","proteins","ribosome","cell membrane"],
      },
    ],
  },
  {
    name: "bacteria",
    tier: "N",
    kind: "living",
    firstAppeared: "~3.5bya",
    fact: "There are far more bacteria on Earth than stars in the observable universe. Your body carries about as many bacterial cells as human ones.",
    recipes: [
      {
        n: ["water"],
        e: ["LUCA"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "archaea",
    tier: "N",
    kind: "living",
    firstAppeared: "~3.5bya",
    fact: "Look like bacteria but are a separate branch of life. Many thrive in boiling springs and salt lakes.",
    recipes: [
      {
        e: ["LUCA"],
      },
    ],
  },
  {
    name: "cyanobacteria",
    tier: "N",
    kind: "living",
    firstAppeared: "~2.7bya",
    fact: "The first life to make oxygen from sunlight. Over hundreds of millions of years, they filled the air with it.",
    recipes: [
      {
        n: ["water","carbon dioxide"],
        e: ["bacteria"],
      },
    ],
  },
  {
    name: "mitochondrion",
    tier: "C",
    kind: "part",
    firstAppeared: "~2bya",
    fact: "The power plant of your cells. It was once a free-living bacterium and still carries its own DNA.",
    recipes: [
      {
        e: ["bacteria"],
      },
    ],
  },
  {
    name: "chlorophyll",
    tier: "N",
    kind: "substance",
    firstAppeared: "?",
    fact: "Absorbs red and blue light and reflects green, which is why plants look green.",
    recipes: [
      {
        f: ["carbon","hydrogen","nitrogen","oxygen","magnesium"],
      },
    ],
  },
  {
    name: "chloroplast",
    tier: "C",
    kind: "part",
    firstAppeared: "~1.5bya",
    fact: "Where photosynthesis happens. It began as a cyanobacterium swallowed by another cell, and it never left.",
    recipes: [
      {
        f: ["chlorophyll"],
        e: ["cyanobacteria"],
      },
    ],
  },
  {
    name: "complex cell",
    tier: "N",
    kind: "living",
    firstAppeared: "~2bya",
    fact: "Every plant, animal and fungus is built from this kind of cell. It formed when an archaeon took in a bacterium, which may have happened only once.",
    recipes: [
      {
        e: ["archaea","mitochondrion"],
      },
    ],
  },
  {
    name: "algae",
    tier: "N",
    kind: "living",
    firstAppeared: "~1.5bya",
    fact: "Seaweeds and their microscopic cousins. Every land plant descends from green algae.",
    recipes: [
      {
        n: ["water"],
        e: ["complex cell","chloroplast"],
      },
    ],
  },
  {
    name: "fungi",
    tier: "N",
    kind: "living",
    firstAppeared: "~1bya",
    fact: "Closer relatives of animals than of plants. A single honey fungus in Oregon spreads across nearly 10 square kilometres.",
    recipes: [
      {
        e: ["complex cell"],
      },
    ],
  },
  {
    name: "land plants",
    tier: "N",
    kind: "living",
    firstAppeared: "~470mya",
    fact: "The first land plants were tiny mosses. Fungi helped their roots pull nutrients from bare rock.",
    recipes: [
      {
        n: ["water","air","fungi"],
        e: ["algae"],
      },
    ],
  },
  {
    name: "early animals",
    tier: "N",
    kind: "living",
    firstAppeared: "~600mya",
    fact: "The first animals were soft-bodied sea creatures, likely sponges. Sponges can survive on very little oxygen, so how much oxygen the first animals needed is still debated.",
    recipes: [
      {
        n: ["water","air"],
        e: ["complex cell"],
      },
    ],
  },
  {
    name: "eye",
    tier: "C",
    kind: "part",
    firstAppeared: "~540mya",
    fact: "The first eyes appeared around 540 million years ago. Seeing may have helped spark the Cambrian explosion of animal life.",
    recipes: [
      {
        f: ["proteins","complex cell"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bone",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Calcium phosphate crystals woven through protein, which makes bone both hard and slightly flexible.",
    recipes: [
      {
        f: ["calcium","phosphorus","proteins","complex cell"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "brain",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Take away the water and about half of what is left is fat. A human brain has around 86 billion neurons.",
    recipes: [
      {
        f: ["lipids","proteins","complex cell"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lung",
    tier: "C",
    kind: "part",
    firstAppeared: "~400mya",
    fact: "Lungs evolved in fish, before any animal walked on land. Some fish still gulp air.",
    recipes: [
      {
        f: ["proteins","complex cell"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "fish",
    tier: "N",
    kind: "living",
    firstAppeared: "~530mya",
    fact: "The first animals with backbones. In evolutionary terms, you are a much-modified fish.",
    recipes: [
      {
        f: ["bone","eye","brain"],
        n: ["water"],
        e: ["early animals"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "insects",
    tier: "N",
    kind: "living",
    firstAppeared: "~480mya",
    fact: "Over a million insect species have been described, more than all other animals combined.",
    recipes: [
      {
        f: ["eye","brain"],
        n: ["air"],
        e: ["early animals"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "amphibians",
    tier: "N",
    kind: "living",
    firstAppeared: "~370mya",
    fact: "The first four-legged animals crawled out of the water about 370 million years ago.",
    recipes: [
      {
        f: ["lung"],
        n: ["water","air"],
        e: ["fish"],
      },
    ],
  },
  {
    name: "reptiles",
    tier: "N",
    kind: "living",
    firstAppeared: "~312mya",
    fact: "Lizards, snakes, turtles, crocodiles and dinosaurs all belong to this line, which split from the one leading to mammals over 300 million years ago.",
    recipes: [
      {
        n: ["air"],
        e: ["early amniotes"],
      },
    ],
  },
  {
    name: "dinosaurs",
    tier: "N",
    kind: "living",
    firstAppeared: "~230mya",
    fact: "Ruled the land for over 150 million years, until an asteroid struck 66 million years ago.",
    recipes: [
      {
        e: ["reptiles"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "birds",
    tier: "N",
    kind: "living",
    firstAppeared: "~150mya",
    fact: "Birds are living dinosaurs. A chicken is more closely related to T. rex than a crocodile is.",
    recipes: [
      {
        e: ["dinosaurs"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "mammals",
    tier: "N",
    kind: "living",
    firstAppeared: "~200mya",
    fact: "The first true mammals were small, furry and nocturnal, living in the dinosaurs' shadow. They fed their young on milk.",
    recipes: [
      {
        e: ["synapsids"],
      },
    ],
  },
  {
    name: "primates",
    tier: "N",
    kind: "living",
    firstAppeared: "~60mya",
    fact: "Early primates lived in trees. Grasping hands and forward-facing eyes helped them climb, leap and grab food among the branches.",
    recipes: [
      {
        n: ["tree"],
        e: ["mammals"],
      },
    ],
  },
  {
    name: "humans",
    tier: "N",
    kind: "living",
    firstAppeared: "~300ka",
    fact: "Our species appeared in Africa about 300,000 years ago. Every product and system on this map needed us.",
    recipes: [
      {
        f: ["brain"],
        n: ["water","air"],
        e: ["primates"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "water",
    tier: "N",
    kind: "mineral",
    firstAppeared: "4.4bya",
    fact: "Two hydrogen atoms and one oxygen. Some of the water on Earth is thought to be older than the sun.",
    recipes: [
      {
        f: ["hydrogen","oxygen"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "air",
    tier: "N",
    kind: "mineral",
    firstAppeared: "2.4bya",
    fact: "Earth's air only became rich in oxygen about 2.4 billion years ago, thanks to microbes in the sea.",
    recipes: [
      {
        f: ["nitrogen","oxygen","argon","neon","carbon dioxide"],
      },
    ],
    linksN: ["cyanobacteria"],
    tags: ["combine-everyday"],
  },
  {
    name: "rock",
    tier: "N",
    kind: "mineral",
    firstAppeared: "4.4bya",
    fact: "Most of Earth's crust is silicate rock, built mainly from silicon and oxygen. The oldest crystals found are about 4.4 billion years old.",
    recipes: [
      {
        f: ["silicon","oxygen","aluminium","iron","calcium"],
      },
    ],
  },
  {
    name: "quartz",
    tier: "N",
    kind: "mineral",
    firstAppeared: "4.4bya",
    fact: "One of the most common minerals in Earth's crust. Your phone's chips begin as purified quartz.",
    recipes: [
      {
        f: ["silicon","oxygen"],
      },
    ],
  },
  {
    name: "sand",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Mostly tiny grains of quartz, worn down by water and wind. Desert sand is too round to use in concrete.",
    recipes: [
      {
        f: ["quartz","rock"],
        n: ["water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "clay",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Extremely fine particles of weathered rock. Soft and shapeable when wet, hard as stone once fired.",
    recipes: [
      {
        f: ["rock","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "gravel",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Broken rock. By weight, concrete is mostly gravel and sand.",
    recipes: [
      {
        f: ["rock"],
      },
    ],
  },
  {
    name: "plankton",
    tier: "N",
    kind: "living",
    firstAppeared: "~2.7bya",
    fact: "Tiny drifting ocean life. Ocean plankton produce about half of all the oxygen made on Earth.",
    recipes: [
      {
        label: "bacterial",
        e: ["cyanobacteria"],
      },
      {
        label: "algal",
        e: ["algae"],
      },
    ],
    linksN: ["water","carbon dioxide"],
  },
  {
    name: "limestone",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Most limestone is made from the shells and skeletons of ancient sea creatures.",
    recipes: [
      {
        f: ["calcium","carbon","oxygen","plankton"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "crude oil",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Dead plankton, buried and slowly cooked underground for millions of years.",
    recipes: [
      {
        f: ["plankton"],
      },
    ],
    linksS: ["oil well"],
    tags: ["combine-everyday"],
  },
  {
    name: "natural gas",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Mostly methane. It forms alongside oil from the same buried sea life.",
    recipes: [
      {
        f: ["plankton"],
      },
    ],
    linksS: ["oil well"],
  },
  {
    name: "coal",
    tier: "N",
    kind: "mineral",
    firstAppeared: "360mya",
    fact: "The squashed remains of ancient swamp plants. Many great coal beds formed in tropical swamp forests around 300 million years ago.",
    recipes: [
      {
        f: ["tree"],
      },
    ],
    linksS: ["mine"],
    tags: ["combine-everyday"],
  },
  {
    name: "iron ore",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Iron in ore is mostly bound to oxygen, like rust. Many huge ore beds formed as early ocean microbes changed iron dissolved in seawater into solid oxides.",
    recipes: [
      {
        f: ["iron","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["combine-everyday"],
  },
  {
    name: "bauxite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "The main source of aluminium. It forms in hot, wet climates where rain washes everything else away.",
    recipes: [
      {
        f: ["aluminium","oxygen"],
      },
    ],
    linksS: ["mine"],
  },
  {
    name: "copper ore",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Usually ordinary-looking rock with tiny copper minerals scattered through it. Most copper ore holds less than 1% copper.",
    recipes: [
      {
        f: ["copper","rock"],
      },
    ],
    linksS: ["mine"],
  },
  {
    name: "graphite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Pure carbon in slippery sheets. The \"lead\" in a pencil has never been lead.",
    recipes: [
      {
        f: ["carbon"],
      },
    ],
    linksS: ["mine"],
  },
  {
    name: "seawater",
    tier: "N",
    kind: "mineral",
    firstAppeared: "4.4bya",
    fact: "About 3.5% salt. Spread over the land, the ocean's salt would make a layer more than 160 metres thick.",
    recipes: [
      {
        f: ["water","sodium","chlorine"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lithium brine",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Salty water under deserts like Chile's Atacama. It is a major source of lithium for batteries.",
    recipes: [
      {
        f: ["lithium","water","sodium","chlorine"],
      },
    ],
  },
  {
    name: "soil",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "The first soils were weathered rock. Once forests arrived, rotting leaves made it rich. A teaspoon of healthy soil holds more living things than there are people on Earth.",
    recipes: [
      {
        label: "first soil",
        f: ["rock","water"],
      },
      {
        label: "living soil",
        f: ["rock","water","leaf litter"],
        n: ["bacteria","fungi"],
      },
    ],
  },
  {
    name: "leaf litter",
    tier: "N",
    kind: "living",
    firstAppeared: "385mya",
    fact: "Fallen leaves that rot into soil. Forests feed the soil that feeds them.",
    recipes: [
      {
        f: ["tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tree",
    tier: "N",
    kind: "living",
    firstAppeared: "385mya",
    fact: "A tree is mostly made from air. The carbon in wood comes from carbon dioxide.",
    recipes: [
      {
        e: ["land plants"],
      },
    ],
    linksN: ["water","air","soil"],
    tags: ["combine-everyday"],
  },
  {
    name: "grass",
    tier: "N",
    kind: "living",
    firstAppeared: "~70mya",
    fact: "Wheat, rice, maize and sugarcane are all grasses.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","air","soil"],
    tags: ["combine-everyday"],
  },
  {
    name: "flower",
    tier: "N",
    kind: "living",
    firstAppeared: "130mya",
    fact: "Flowering plants appeared about 130 million years ago, before bees. Today many can't make seeds without them.",
    recipes: [
      {
        e: ["land plants"],
      },
    ],
    linksN: ["water","soil"],
    tags: ["combine-everyday"],
  },
  {
    name: "wheat",
    tier: "N",
    kind: "living",
    firstAppeared: "10ka",
    fact: "One of the first crops people farmed, around 10,000 years ago.",
    recipes: [
      {
        e: ["grass"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "cotton plant",
    tier: "N",
    kind: "living",
    firstAppeared: "~7ka",
    fact: "Cotton fibre is the fluffy hair that grows around the plant's seeds.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "sugarcane",
    tier: "N",
    kind: "living",
    firstAppeared: "~10ka",
    fact: "A giant grass that supplies most of the world's sugar.",
    recipes: [
      {
        e: ["grass"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "sugar beet",
    tier: "N",
    kind: "living",
    firstAppeared: "1801",
    fact: "A pale root bred for its sugar. The first beet sugar factory opened in 1801, and beets now supply about a fifth of the world's sugar.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
  },
  {
    name: "cacao tree",
    tier: "N",
    kind: "living",
    firstAppeared: "~5.3ka",
    fact: "Grows only in a warm band within about 20 degrees of the equator.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "coffee plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "A coffee \"bean\" is the seed of a small red fruit called a coffee cherry.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "tomato plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Botanically the tomato is a fruit, and a close cousin of the potato.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "indigo plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "The original blue in blue jeans. Since the early 1900s almost all indigo dye has been made in factories rather than from plants.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
  },
  {
    name: "rubber tree",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Natural rubber is tree sap called latex. Nearly half the world's rubber still comes from trees.",
    recipes: [
      {
        e: ["flower"],
      },
    ],
    linksN: ["water","soil"],
    tags: ["combine-everyday"],
  },
  {
    name: "sheep",
    tier: "N",
    kind: "living",
    firstAppeared: "~11ka",
    fact: "Domesticated about 11,000 years ago. A single sheep grows about 4 to 5 kilograms of wool a year.",
    recipes: [
      {
        e: ["mammals"],
      },
    ],
    linksN: ["grass","water"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "cow",
    tier: "N",
    kind: "living",
    firstAppeared: "~10ka",
    fact: "A dairy cow gives about 25 litres of milk a day.",
    recipes: [
      {
        e: ["mammals"],
      },
    ],
    linksN: ["grass","water"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "chicken",
    tier: "N",
    kind: "living",
    firstAppeared: "~3.5ka",
    fact: "There are over 20 billion chickens alive at any time, more than any other bird.",
    recipes: [
      {
        e: ["birds"],
      },
    ],
    linksN: ["wheat","water"],
    linksS: ["farm"],
    tags: ["combine-everyday"],
  },
  {
    name: "bee",
    tier: "N",
    kind: "living",
    firstAppeared: "~100mya",
    fact: "To make one kilogram of honey, bees visit around four million flowers.",
    recipes: [
      {
        e: ["insects"],
      },
    ],
    linksN: ["flower"],
    tags: ["combine-everyday"],
  },
  {
    name: "yeast",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "A single-celled fungus. It makes bread rise by giving off bubbles of carbon dioxide.",
    recipes: [
      {
        e: ["fungi"],
      },
    ],
    linksN: ["sugar","water"],
  },
  {
    name: "wool",
    tier: "M",
    kind: "substance",
    firstAppeared: "~6ka",
    fact: "Wool fibres are covered in tiny scales that let them lock together into felt.",
    recipes: [
      {
        f: ["sheep"],
        w: ["shears"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cotton",
    tier: "M",
    kind: "substance",
    firstAppeared: "~7ka",
    fact: "The most used natural fibre in the world. Picking out the seeds by hand took a worker a whole day per pound.",
    recipes: [
      {
        label: "by machine",
        f: ["cotton plant"],
        w: ["cotton gin"],
      },
      {
        label: "by hand",
        f: ["cotton plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "thread",
    tier: "M",
    kind: "substance",
    firstAppeared: "~50ka",
    fact: "People were twisting fibres into cord at least 50,000 years ago. Spinning turns short fibres into one long, strong strand.",
    recipes: [
      {
        label: "wool",
        f: ["wool"],
        w: ["spinning wheel"],
      },
      {
        label: "cotton",
        f: ["cotton"],
        w: ["spinning wheel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "fabric",
    tier: "M",
    kind: "substance",
    firstAppeared: "~30ka",
    fact: "Weaving crosses two sets of threads at right angles, called the warp and the weft.",
    recipes: [
      {
        f: ["thread"],
        w: ["loom"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "dye",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Before the first synthetic dye in 1856, purple came from sea snails and was worth more than its weight in gold, a colour of kings.",
    recipes: [
      {
        label: "natural",
        f: ["indigo plant"],
      },
      {
        label: "synthetic",
        f: ["crude oil"],
        w: ["refinery"],
      },
    ],
  },
  {
    name: "leather",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Tanning stops animal skin from rotting by locking its proteins together.",
    recipes: [
      {
        f: ["cow","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "milk",
    tier: "M",
    kind: "food",
    firstAppeared: "~9ka",
    fact: "Mostly water, with about 3.5% fat. People began milking animals about 9,000 years ago.",
    recipes: [
      {
        f: ["cow"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "egg",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "A good laying hen produces around 300 eggs a year.",
    recipes: [
      {
        f: ["chicken"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "flour",
    tier: "M",
    kind: "food",
    firstAppeared: "~30ka",
    fact: "People were grinding wild plants, including cattail roots and grass seeds, into flour at least 30,000 years ago, long before farming.",
    recipes: [
      {
        f: ["wheat"],
        w: ["mill"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "sugar",
    tier: "M",
    kind: "food",
    firstAppeared: "~350",
    fact: "Sugar crystals were first made in India around 1,700 years ago.",
    recipes: [
      {
        label: "cane sugar",
        f: ["sugarcane"],
        w: ["mill"],
      },
      {
        label: "beet sugar",
        f: ["sugar beet"],
        w: ["mill"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cocoa",
    tier: "M",
    kind: "food",
    firstAppeared: "~5.3ka",
    fact: "Cacao seeds are fermented and roasted before they taste anything like chocolate.",
    recipes: [
      {
        f: ["cacao tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "coffee beans",
    tier: "M",
    kind: "food",
    firstAppeared: "~1450",
    fact: "A cup of coffee holds over 1,000 different chemicals. Roasting turns the bland green seeds into the brown, fragrant beans we brew.",
    recipes: [
      {
        f: ["coffee plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tomato",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Tomatoes reached Europe from the Americas in the 1500s and were long thought to be poisonous.",
    recipes: [
      {
        f: ["tomato plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "salt",
    tier: "M",
    kind: "food",
    firstAppeared: "~-6000",
    fact: "Sea salt is made by letting sunshine evaporate seawater in shallow pools. People were making salt at least 8,000 years ago.",
    recipes: [
      {
        f: ["seawater"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "honey",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Nectar that bees have concentrated and sealed in wax. Kept dry, it practically never spoils.",
    recipes: [
      {
        f: ["flower"],
        w: ["bee"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "beeswax",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Bees make wax from glands on their bellies, then chew it into hexagonal cells.",
    recipes: [
      {
        f: ["bee"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "wood",
    tier: "M",
    kind: "substance",
    firstAppeared: "385mya",
    fact: "Wood is about half carbon by dry weight, all of it pulled from the air.",
    recipes: [
      {
        label: "sawn",
        f: ["tree"],
        w: ["saw"],
      },
      {
        label: "fallen",
        f: ["tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "charcoal",
    tier: "M",
    kind: "energy",
    firstAppeared: "?",
    fact: "Wood heated with little air. It burns hotter than wood and fuelled the Iron Age.",
    recipes: [
      {
        f: ["wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "paper",
    tier: "M",
    kind: "substance",
    firstAppeared: "105",
    fact: "Invented in China around 105 CE. Paper has been made from wood pulp only since the 1840s.",
    recipes: [
      {
        label: "wood pulp",
        f: ["wood","water"],
      },
      {
        label: "recycled",
        f: ["paper","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "coke",
    tier: "M",
    kind: "energy",
    firstAppeared: "1709",
    fact: "Coal baked without air. Using it instead of charcoal from 1709 made iron cheap.",
    recipes: [
      {
        f: ["coal"],
        w: ["furnace"],
      },
    ],
  },
  {
    name: "steel",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-1800",
    fact: "Iron with a pinch of carbon. The world makes almost two billion tonnes a year, and a large share is recycled steel.",
    recipes: [
      {
        label: "blast furnace",
        f: ["iron ore","coke","limestone"],
        w: ["blast furnace"],
      },
      {
        label: "early steel",
        f: ["iron ore","charcoal"],
        w: ["furnace"],
      },
      {
        label: "recycled",
        f: ["steel"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "aluminium metal",
    tier: "M",
    kind: "substance",
    firstAppeared: "1825",
    fact: "Smelting it uses so much power that it's nicknamed \"solid electricity\". Recycling it saves about 95% of that energy.",
    recipes: [
      {
        label: "smelted",
        f: ["bauxite"],
      },
      {
        label: "recycled",
        f: ["aluminium metal"],
      },
    ],
  },
  {
    name: "copper wire",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Copper is drawn through smaller and smaller holes until it's as thin as needed, then coated in plastic.",
    recipes: [
      {
        f: ["refined copper","plastic"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "soda ash",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Sodium carbonate, made from salt and limestone or mined as the mineral trona. Adding it lets sand melt at a much lower temperature.",
    recipes: [
      {
        f: ["salt","limestone"],
      },
    ],
  },
  {
    name: "glass",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-3500",
    fact: "Window glass is mostly sand, melted at around 1,500 °C and cooled before it can crystallise.",
    recipes: [
      {
        f: ["sand","soda ash","limestone"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "plastic",
    tier: "M",
    kind: "substance",
    firstAppeared: "1907",
    fact: "The first fully synthetic plastic, Bakelite, arrived in 1907. Most plastics are long chains of carbon from oil and gas.",
    recipes: [
      {
        label: "from oil",
        f: ["crude oil"],
        w: ["refinery"],
      },
      {
        label: "from gas",
        f: ["natural gas"],
        w: ["refinery"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "rubber",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-1600",
    fact: "People in ancient Mexico were making rubber 3,600 years ago, mixing tree latex with morning glory juice to make it bouncy.",
    recipes: [
      {
        label: "natural",
        f: ["rubber tree"],
      },
      {
        label: "synthetic",
        f: ["crude oil"],
        w: ["refinery"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "asphalt",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "The black glue in asphalt is the heaviest leftover from refining crude oil.",
    recipes: [
      {
        f: ["crude oil","gravel"],
        w: ["refinery"],
      },
    ],
  },
  {
    name: "petrol",
    tier: "M",
    kind: "energy",
    firstAppeared: "~1855",
    fact: "Each litre of petrol comes from crude oil that took millions of years to form.",
    recipes: [
      {
        f: ["crude oil"],
        w: ["refinery"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cement",
    tier: "M",
    kind: "substance",
    firstAppeared: "1824",
    fact: "Making cement produces about 8% of the world's carbon dioxide emissions.",
    recipes: [
      {
        f: ["limestone","clay"],
        w: ["kiln"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "concrete",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-300",
    fact: "The most used human-made material on Earth. Roman concrete has lasted 2,000 years.",
    recipes: [
      {
        f: ["cement","sand","gravel","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "brick",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-7000",
    fact: "The first bricks were mud dried in the sun. Firing them in a kiln came thousands of years later.",
    recipes: [
      {
        label: "fired",
        f: ["clay"],
        w: ["kiln"],
      },
      {
        label: "sun-dried",
        f: ["clay"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "silicon wafer",
    tier: "M",
    kind: "substance",
    firstAppeared: "1954",
    fact: "A slice of a single silicon crystal, less than a millimetre thick and polished flatter than almost anything else people make.",
    recipes: [
      {
        f: ["silicon ingot","polishing slurry"],
        w: ["wire saw"],
        n: ["ultrapure water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "ink",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-2500",
    fact: "Black ink gets its colour from fine carbon soot.",
    recipes: [
      {
        f: ["carbon","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "paint",
    tier: "M",
    kind: "substance",
    firstAppeared: "~100ka",
    fact: "People mixed red ochre paint at least 100,000 years ago. Most modern paint is pigment in liquid plastic.",
    recipes: [
      {
        label: "modern",
        f: ["plastic","dye","water"],
      },
      {
        label: "earth pigment",
        f: ["rock","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "glue",
    tier: "M",
    kind: "substance",
    firstAppeared: "~200ka",
    fact: "Neanderthals made glue from birch bark tar about 200,000 years ago.",
    recipes: [
      {
        label: "modern",
        f: ["plastic","water"],
      },
      {
        label: "hide glue",
        f: ["cow","water"],
      },
      {
        label: "birch tar",
        f: ["tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "solder",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Mostly tin. It holds every part on a circuit board in place.",
    recipes: [
      {
        f: ["tin"],
      },
    ],
  },
  {
    name: "screw",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Screws were made by hand until the 1760s, so each one was slightly different.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "nail",
    tier: "C",
    kind: "part",
    firstAppeared: "~-3400",
    fact: "Nails were once so valuable that people burned down old buildings to recover them.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "button",
    tier: "C",
    kind: "part",
    firstAppeared: "~-2800",
    fact: "Buttons were used as ornaments for thousands of years before anyone used them to fasten clothes.",
    recipes: [
      {
        label: "plastic",
        f: ["plastic"],
      },
      {
        label: "wooden",
        f: ["wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "zipper",
    tier: "C",
    kind: "part",
    firstAppeared: "1917",
    fact: "Patented in 1917. It was named after the sound it makes.",
    recipes: [
      {
        f: ["steel","fabric"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "gear",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Two gears of different sizes trade speed for force.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "chain",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A bicycle chain transfers almost all of your pedalling energy to the wheel.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "magnet",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Every magnet has a north and south pole. Cut one in half and you get two magnets.",
    recipes: [
      {
        f: ["iron"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lens",
    tier: "C",
    kind: "part",
    firstAppeared: "~-750",
    fact: "A curved piece of glass that bends light. The same idea works in eyes, cameras and telescopes.",
    recipes: [
      {
        f: ["glass"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "battery",
    tier: "C",
    kind: "part",
    firstAppeared: "1991",
    fact: "Lithium-ion batteries went on sale in 1991. They store energy by shuttling lithium between two layers.",
    recipes: [
      {
        f: ["lithium brine","graphite","aluminium metal","copper wire","plastic"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "microchip",
    tier: "C",
    kind: "part",
    firstAppeared: "1958",
    fact: "A modern chip holds billions of transistors, each smaller than a virus. Making one takes over 1,000 steps and several months, in factories spread across several continents.",
    recipes: [
      {
        f: ["die","package substrate","solder","gold"],
        w: ["packaging plant"],
      },
    ],
    tags: ["combine-everyday", "fab-chain"],
  },
  {
    name: "circuit board",
    tier: "C",
    kind: "part",
    firstAppeared: "1936",
    fact: "The flat board that connects a device's parts with thin copper tracks.",
    recipes: [
      {
        f: ["copper wire","plastic","solder"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "screen",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A phone screen has millions of tiny lights, each switched on and off many times a second.",
    recipes: [
      {
        f: ["glass","plastic","copper wire"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "electric motor",
    tier: "C",
    kind: "part",
    firstAppeared: "1821",
    fact: "Uses magnetism to turn electricity into spinning motion. Michael Faraday showed the idea in 1821.",
    recipes: [
      {
        f: ["copper wire","magnet","steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "engine",
    tier: "C",
    kind: "part",
    firstAppeared: "1876",
    fact: "A car engine burns small explosions of fuel thousands of times a minute.",
    recipes: [
      {
        f: ["steel","aluminium metal"],
        n: ["petrol"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tyre",
    tier: "C",
    kind: "part",
    firstAppeared: "1888",
    fact: "John Dunlop, a vet, patented an air-filled tyre in 1888 after fitting one to his son's tricycle. Robert Thomson had patented a similar idea in 1845.",
    recipes: [
      {
        f: ["rubber","steel","fabric"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "fibre optic cable",
    tier: "C",
    kind: "part",
    firstAppeared: "1970",
    fact: "Sends data as flashes of light through glass strands about as thick as a human hair.",
    recipes: [
      {
        f: ["glass","plastic"],
      },
    ],
  },
  {
    name: "solar panel",
    tier: "C",
    kind: "part",
    firstAppeared: "1954",
    fact: "Sunlight knocks electrons loose in the silicon, which makes an electric current.",
    recipes: [
      {
        f: ["silicon wafer","glass","aluminium metal","copper wire"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "shears",
    tier: "P",
    kind: "tool",
    firstAppeared: "~-1000",
    fact: "Hand shears for sheep have barely changed in 2,000 years.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "spinning wheel",
    tier: "P",
    kind: "tool",
    firstAppeared: "~1000",
    fact: "Invented in Asia and reached Europe around the 1200s. It sped up the slowest step in making cloth.",
    recipes: [
      {
        f: ["wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "loom",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "The Jacquard loom of 1804 was programmed with punched cards, an ancestor of computer code.",
    recipes: [
      {
        label: "hand loom",
        f: ["wood"],
      },
      {
        label: "power loom",
        f: ["steel","electric motor"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cotton gin",
    tier: "P",
    kind: "tool",
    firstAppeared: "1793",
    fact: "Invented in 1793. It pulled the seeds out of cotton far faster than any hand could.",
    recipes: [
      {
        f: ["wood","steel"],
      },
    ],
  },
  {
    name: "sewing machine",
    tier: "P",
    kind: "tool",
    firstAppeared: "1846",
    fact: "Most sewing machines make a lockstitch, looping a thread from the needle above with a thread from a bobbin below.",
    recipes: [
      {
        f: ["steel","electric motor"],
      },
    ],
  },
  {
    name: "saw",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "The teeth of a saw are bent slightly outwards so the blade doesn't jam in the cut.",
    recipes: [
      {
        f: ["steel","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "mill",
    tier: "P",
    kind: "tool",
    firstAppeared: "~-300",
    fact: "For thousands of years, millstones were turned by water, wind or animals.",
    recipes: [
      {
        f: ["rock","wood"],
      },
    ],
  },
  {
    name: "oven",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Ovens bake by surrounding food with hot air and radiating heat.",
    recipes: [
      {
        label: "electric",
        f: ["steel","brick"],
      },
      {
        label: "wood-fired",
        f: ["brick"],
        n: ["wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "furnace",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Early furnaces were brick or clay burning charcoal. Modern ones are built from steel, which is itself made in a furnace.",
    recipes: [
      {
        label: "brick",
        f: ["brick"],
        n: ["charcoal"],
      },
      {
        label: "steel",
        f: ["brick","steel"],
        n: ["natural gas"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "blast furnace",
    tier: "P",
    kind: "tool",
    firstAppeared: "~-500",
    fact: "A blast furnace runs day and night, often for many years, stopping only when its heat-proof lining wears out.",
    recipes: [
      {
        f: ["brick","steel"],
      },
    ],
    linksN: ["coke","air"],
  },
  {
    name: "kiln",
    tier: "P",
    kind: "tool",
    firstAppeared: "~-6000",
    fact: "A kiln is an oven for clay. Firing changes clay into a new, stone-like material.",
    recipes: [
      {
        label: "charcoal",
        f: ["brick"],
        n: ["charcoal"],
      },
      {
        label: "gas",
        f: ["brick"],
        n: ["natural gas"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "printing press",
    tier: "P",
    kind: "tool",
    firstAppeared: "1440",
    fact: "Gutenberg's press, around 1440, made books cheap enough for ordinary people.",
    recipes: [
      {
        f: ["steel","wood"],
      },
    ],
  },
  {
    name: "kettle",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Most of an electric kettle's energy goes into the water itself, which makes it very efficient.",
    recipes: [
      {
        label: "electric",
        f: ["steel","plastic","copper wire"],
      },
      {
        label: "stovetop",
        f: ["steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tractor",
    tier: "P",
    kind: "tool",
    firstAppeared: "1892",
    fact: "A modern tractor does the work of hundreds of farm labourers.",
    recipes: [
      {
        f: ["steel","engine","tyre"],
        n: ["petrol"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "wind turbine",
    tier: "P",
    kind: "tool",
    firstAppeared: "1887",
    fact: "The first wind turbine to make electricity was built in Scotland in 1887. One large turbine can now power over a thousand homes.",
    recipes: [
      {
        f: ["steel","plastic","copper wire","magnet"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "shirt",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "A cotton T-shirt takes about 2,700 litres of water to make, mostly to grow the cotton.",
    recipes: [
      {
        label: "machine-sewn",
        f: ["fabric","thread","button","dye"],
        w: ["sewing machine"],
      },
      {
        label: "hand-sewn",
        f: ["fabric","thread","button"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "sweater",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Wool can soak up about a third of its weight in water before it feels wet.",
    recipes: [
      {
        f: ["thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "jeans",
    tier: "P",
    kind: "object",
    firstAppeared: "1873",
    fact: "Copper rivets were added in 1873 to stop the pockets of miners' trousers tearing.",
    recipes: [
      {
        f: ["fabric","thread","dye","zipper","copper wire"],
        w: ["sewing machine"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "shoe",
    tier: "P",
    kind: "object",
    firstAppeared: "~-3500",
    fact: "The oldest known leather shoe, found in an Armenian cave, is about 5,500 years old.",
    recipes: [
      {
        label: "leather",
        f: ["leather","thread","glue"],
      },
      {
        label: "trainer",
        f: ["rubber","fabric","thread","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bread",
    tier: "P",
    kind: "food",
    firstAppeared: "14ka",
    fact: "The oldest known bread is a flatbread baked about 14,000 years ago.",
    recipes: [
      {
        label: "leavened",
        f: ["flour","water","yeast","salt"],
        w: ["oven"],
      },
      {
        label: "flatbread",
        f: ["flour","water"],
        w: ["oven"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "butter",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "It takes about 21 litres of milk to make one kilogram of butter.",
    recipes: [
      {
        f: ["milk"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cheese",
    tier: "P",
    kind: "food",
    firstAppeared: "~7.5ka",
    fact: "About 10 litres of milk go into each kilogram of hard cheese. Traces of cheese-making have been found on 7,200-year-old pottery.",
    recipes: [
      {
        f: ["milk","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cake",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Baking powder, invented in the 1840s, replaced hours of beating air into the batter.",
    recipes: [
      {
        f: ["flour","sugar","egg","butter","milk"],
        w: ["oven"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "chocolate",
    tier: "P",
    kind: "food",
    firstAppeared: "1847",
    fact: "For most of its history chocolate was a bitter drink. The first solid bar was made in 1847.",
    recipes: [
      {
        label: "milk",
        f: ["cocoa","sugar","milk"],
      },
      {
        label: "dark",
        f: ["cocoa","sugar"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "coffee",
    tier: "P",
    kind: "food",
    firstAppeared: "~1450",
    fact: "People in Yemen were brewing coffee by the 1400s.",
    recipes: [
      {
        f: ["coffee beans","water"],
        w: ["kettle"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pizza",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Pizza only took off outside Naples after World War II.",
    recipes: [
      {
        f: ["flour","water","yeast","tomato","cheese"],
        w: ["oven"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "candle",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Most candles today are paraffin wax from oil. Beeswax candles burn cleaner.",
    recipes: [
      {
        label: "beeswax",
        f: ["beeswax","thread"],
      },
      {
        label: "paraffin",
        f: ["crude oil","thread"],
        w: ["refinery"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "book",
    tier: "P",
    kind: "information",
    firstAppeared: "?",
    fact: "Before printing, a single book could take a scribe months to copy.",
    recipes: [
      {
        label: "printed",
        f: ["paper","ink","glue","thread"],
        w: ["printing press"],
      },
      {
        label: "handwritten",
        f: ["paper","ink","thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pencil",
    tier: "P",
    kind: "object",
    firstAppeared: "~1565",
    fact: "A famous 1958 essay, \"I, Pencil\", pointed out that no single person on Earth knows how to make one from scratch.",
    recipes: [
      {
        f: ["wood","graphite","clay","paint","rubber","aluminium metal"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "table",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "One of the oldest pieces of furniture there is.",
    recipes: [
      {
        label: "glued",
        f: ["wood","screw","glue"],
        w: ["saw"],
      },
      {
        label: "nailed",
        f: ["wood","nail"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "window",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Large flat window panes only became cheap after the 1950s, when molten glass was floated on tin.",
    recipes: [
      {
        label: "timber",
        f: ["glass","wood"],
      },
      {
        label: "aluminium",
        f: ["glass","aluminium metal"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "light bulb",
    tier: "P",
    kind: "object",
    firstAppeared: "1879",
    fact: "An LED bulb uses about a sixth of the energy of an old filament bulb.",
    recipes: [
      {
        label: "LED",
        f: ["glass","copper wire","microchip"],
      },
      {
        label: "filament",
        f: ["glass","copper wire"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "smartphone",
    tier: "P",
    kind: "object",
    firstAppeared: "1994",
    fact: "The first smartphone went on sale in 1994. A modern one uses dozens of elements from across the periodic table.",
    recipes: [
      {
        f: ["microchip","battery","screen","circuit board","lens","aluminium metal","glass","plastic"],
        w: ["factory"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "laptop",
    tier: "P",
    kind: "object",
    firstAppeared: "1982",
    fact: "A laptop holds billions of transistors on chips smaller than a fingernail.",
    recipes: [
      {
        f: ["microchip","battery","screen","circuit board","aluminium metal","plastic"],
        w: ["factory"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bicycle",
    tier: "P",
    kind: "object",
    firstAppeared: "1817",
    fact: "The first bicycle, in 1817, had no pedals. Riders pushed it along with their feet.",
    recipes: [
      {
        f: ["steel","tyre","chain","gear"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "car",
    tier: "P",
    kind: "object",
    firstAppeared: "1886",
    fact: "Counting every screw, a car has around 30,000 parts.",
    recipes: [
      {
        f: ["steel","engine","tyre","glass","plastic","battery","fabric"],
        w: ["factory"],
      },
    ],
    linksN: ["petrol"],
    tags: ["combine-everyday"],
  },
  {
    name: "electric car",
    tier: "P",
    kind: "object",
    firstAppeared: "~1890",
    fact: "Around 1900, about a third of cars on US roads were electric, and more electric cars were built than petrol ones, before cheap oil took over.",
    recipes: [
      {
        f: ["steel","electric motor","battery","tyre","glass","microchip"],
        w: ["factory"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "house",
    tier: "P",
    kind: "place",
    firstAppeared: "?",
    fact: "A house is the place where most of the things in this map end up.",
    recipes: [
      {
        label: "brick",
        f: ["brick","concrete","wood","nail","window"],
      },
      {
        label: "timber",
        f: ["wood","nail","window","concrete"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "farm",
    tier: "S",
    kind: "place",
    firstAppeared: "~12ka",
    fact: "About a third of Earth's land is used for farming.",
    recipes: [
      {
        label: "traditional",
        f: ["soil"],
      },
      {
        label: "modern",
        f: ["soil"],
        w: ["tractor"],
      },
    ],
    linksN: ["water","humans"],
    tags: ["combine-everyday"],
  },
  {
    name: "mine",
    tier: "S",
    kind: "place",
    firstAppeared: "~43ka",
    fact: "The oldest known mine, in southern Africa, was dug for red ochre about 43,000 years ago.",
    recipes: [
      {
        label: "early",
        f: ["rock"],
      },
      {
        label: "modern",
        f: ["steel"],
        w: ["tractor"],
      },
    ],
    linksN: ["humans"],
  },
  {
    name: "oil well",
    tier: "S",
    kind: "place",
    firstAppeared: "1859",
    fact: "The first commercial oil well was drilled in Pennsylvania in 1859. The longest wells now stretch more than 13 kilometres through the rock.",
    recipes: [
      {
        f: ["steel","concrete"],
      },
    ],
  },
  {
    name: "refinery",
    tier: "S",
    kind: "place",
    firstAppeared: "1856",
    fact: "A refinery boils crude oil and separates it into fuels and chemicals by their boiling points.",
    recipes: [
      {
        f: ["steel","concrete"],
      },
    ],
  },
  {
    name: "chip fab",
    tier: "S",
    kind: "place",
    firstAppeared: "?",
    fact: "A leading-edge chip factory can cost around $20 billion and use as much electricity as a small town.",
    recipes: [
      {
        f: ["steel","concrete","glass"],
      },
    ],
    linksN: ["ultrapure water"],
    tags: ["fab-chain"],
  },
  {
    name: "factory",
    tier: "S",
    kind: "place",
    firstAppeared: "1771",
    fact: "The first factories, in the 1770s, were built beside rivers to use water power.",
    recipes: [
      {
        label: "water-powered",
        f: ["brick","wood"],
        n: ["water"],
      },
      {
        label: "modern",
        f: ["steel","concrete","electric motor"],
      },
    ],
    linksN: ["humans"],
    tags: ["combine-everyday"],
  },
  {
    name: "power plant",
    tier: "S",
    kind: "place",
    firstAppeared: "1882",
    fact: "Most power plants boil water to spin a turbine, just as they did over a century ago.",
    recipes: [
      {
        label: "coal",
        f: ["steel","concrete","copper wire"],
        n: ["coal","water"],
      },
      {
        label: "gas",
        f: ["steel","concrete","copper wire"],
        n: ["natural gas","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "power grid",
    tier: "S",
    kind: "place",
    firstAppeared: "?",
    fact: "Often called the largest machine ever built.",
    recipes: [
      {
        f: ["copper wire","steel"],
      },
    ],
  },
  {
    name: "road",
    tier: "S",
    kind: "place",
    firstAppeared: "~-4000",
    fact: "The Romans built about 80,000 km of paved roads.",
    recipes: [
      {
        label: "asphalt",
        f: ["asphalt","gravel"],
      },
      {
        label: "concrete",
        f: ["concrete"],
      },
      {
        label: "stone",
        f: ["rock"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "data centre",
    tier: "S",
    kind: "information",
    firstAppeared: "?",
    fact: "Data centres use about 1 to 2% of the world's electricity.",
    recipes: [
      {
        f: ["laptop","steel","concrete","fibre optic cable"],
      },
    ],
    linksN: ["water"],
  },
  {
    name: "city",
    tier: "S",
    kind: "place",
    firstAppeared: "~-4000",
    fact: "About 45% of people live in cities, up from 20% in 1950, and many more live in towns.",
    recipes: [
      {
        label: "ancient",
        f: ["house","road"],
      },
      {
        label: "modern",
        f: ["house","road","power grid"],
      },
    ],
    linksN: ["farm","water"],
    tags: ["combine-everyday"],
  },
  {
    name: "boron",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "B",
    fact: "Most boron isn't made inside stars at all. It forms when cosmic rays smash heavier atoms apart in space.",
    recipes: [
      {
        f: ["carbon","oxygen"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "phosphorus",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "P",
    fact: "Essential to DNA and bones. In chips, a pinch of it gives silicon spare electrons.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
  },
  {
    name: "fluorine",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "F",
    fact: "The most reactive element of all. It attacks almost everything, even glass.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "argon",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Ar",
    fact: "About 1% of the air you breathe. Its name comes from the Greek for \"lazy\", because it reacts with almost nothing.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "neon",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Ne",
    fact: "Rare on Earth but common in the universe. Chip-making lasers depend on it.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "sulfur",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "S",
    fact: "Known since ancient times as brimstone. The acid made from it is one of the most produced chemicals in the world.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "chromium",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Cr",
    fact: "Gives rubies their red and stainless steel its shine.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "cobalt",
    tier: "F",
    kind: "element",
    firstAppeared: "13.6bya",
    symbol: "Co",
    fact: "Named after kobolds, the goblins German miners blamed for \"bewitched\" ore.",
    recipes: [
      {
        f: ["supernova"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "zirconium",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "Zr",
    fact: "Barely absorbs neutrons, so it wraps the fuel inside nuclear reactors.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "hafnium",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "Hf",
    fact: "Always found mixed with zirconium, and very hard to separate from it.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "molybdenum",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "Mo",
    fact: "Melts at over 2,600 °C. Layers of it, alternating with silicon, make mirrors for extreme ultraviolet light.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "tantalum",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "Ta",
    fact: "Almost immune to corrosion. Much of it ends up in tiny capacitors inside electronics.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "tungsten",
    tier: "F",
    kind: "element",
    firstAppeared: "?",
    symbol: "W",
    fact: "The metal with the highest melting point, about 3,400 °C.",
    recipes: [
      {
        f: ["star"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "carbon dioxide",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Only about 0.04% of the air, yet plants build almost everything from it.",
    recipes: [
      {
        f: ["carbon","oxygen"],
      },
    ],
  },
  {
    name: "high-purity quartz",
    tier: "N",
    kind: "mineral",
    firstAppeared: "~380mya",
    fact: "Most of the quartz pure enough for chip-making crucibles, roughly 70 to 90%, comes from one small town: Spruce Pine, North Carolina.",
    recipes: [
      {
        f: ["quartz"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "fluorite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Glows under ultraviolet light. The word \"fluorescence\" comes from its name.",
    recipes: [
      {
        f: ["calcium","fluorine"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "phosphate rock",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Most of it becomes fertiliser. A tiny, ultra-pure share ends up inside chips.",
    recipes: [
      {
        f: ["phosphorus","calcium","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "borax",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Found in dried-up desert lakes. In the 1880s, teams of twenty mules hauled it out of Death Valley.",
    recipes: [
      {
        f: ["boron","sodium","oxygen","water"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "tungsten ore",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "About 80% of the world's tungsten is mined in China.",
    recipes: [
      {
        f: ["tungsten","iron","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "molybdenite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Soft, silvery and greasy. For centuries it was mistaken for graphite and lead ore.",
    recipes: [
      {
        f: ["molybdenum","sulfur"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "zircon",
    tier: "N",
    kind: "mineral",
    firstAppeared: "4.4bya",
    fact: "The oldest known fragments of Earth are zircon crystals about 4.4 billion years old.",
    recipes: [
      {
        f: ["zirconium","hafnium","silicon","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "cobalt ore",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "Nearly three quarters of the world's cobalt comes from the Democratic Republic of the Congo, mostly as a by-product of copper mining.",
    recipes: [
      {
        f: ["cobalt","copper ore"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "coltan",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "A dull black ore that became known as a conflict mineral, mined to fund wars in central Africa.",
    recipes: [
      {
        f: ["tantalum","iron","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "chromite",
    tier: "N",
    kind: "mineral",
    firstAppeared: "?",
    fact: "The main ore of chromium. Most of it goes into stainless steel.",
    recipes: [
      {
        f: ["chromium","iron","oxygen"],
      },
    ],
    linksS: ["mine"],
    tags: ["fab-chain"],
  },
  {
    name: "metallurgical silicon",
    tier: "M",
    kind: "substance",
    firstAppeared: "~1900",
    fact: "Quartz and carbon heated to about 2,000 °C. It comes out about 99% pure, nowhere near pure enough for chips.",
    recipes: [
      {
        f: ["quartz","coke","wood"],
        w: ["arc furnace"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "hydrogen gas",
    tier: "M",
    kind: "energy",
    firstAppeared: "1766",
    fact: "Most hydrogen is made from natural gas. Splitting water with electricity is cleaner but costs more.",
    recipes: [
      {
        label: "steam reforming",
        f: ["natural gas","water"],
      },
      {
        label: "electrolysis",
        f: ["water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "chlorine gas",
    tier: "M",
    kind: "substance",
    firstAppeared: "1774",
    fact: "Made by passing electricity through salty water. In 1915 it became the first poison gas used in war.",
    recipes: [
      {
        f: ["salt","water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "hydrogen chloride",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Hydrogen burned in chlorine makes this sharp gas. Dissolved in water it becomes hydrochloric acid, which is also in your stomach.",
    recipes: [
      {
        f: ["hydrogen gas","chlorine gas"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "trichlorosilane",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Turning silicon into a liquid lets it be distilled again and again, leaving the impurities behind.",
    recipes: [
      {
        f: ["metallurgical silicon","hydrogen chloride"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "polysilicon",
    tier: "M",
    kind: "substance",
    firstAppeared: "~1955",
    fact: "Silicon purified to as much as 99.999999999%, \"eleven nines\". That's about one stray atom in 100 billion.",
    recipes: [
      {
        f: ["trichlorosilane","hydrogen gas"],
        w: ["siemens reactor"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "argon gas",
    tier: "M",
    kind: "substance",
    firstAppeared: "1894",
    fact: "Separated from liquefied air. It surrounds a growing silicon crystal so that nothing can react with it.",
    recipes: [
      {
        f: ["air"],
        w: ["air separation unit"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "neon gas",
    tier: "M",
    kind: "substance",
    firstAppeared: "1898",
    fact: "About 55,000 litres of air hold one litre of neon. Ukraine supplied roughly half the chip industry's neon until 2022, when the war caused a shortage.",
    recipes: [
      {
        f: ["air"],
        w: ["air separation unit"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "fluorine gas",
    tier: "M",
    kind: "substance",
    firstAppeared: "1886",
    fact: "So dangerous to isolate that several chemists were injured or killed trying, before Henri Moissan succeeded in 1886.",
    recipes: [
      {
        f: ["hydrofluoric acid"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "sulfuric acid",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Made in vast amounts. Economists once used a country's sulfuric acid output to measure its industrial strength.",
    recipes: [
      {
        f: ["sulfur","air","water"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "hydrofluoric acid",
    tier: "M",
    kind: "substance",
    firstAppeared: "1771",
    fact: "One of the few acids that dissolves glass. Chip makers use it to clean wafers between steps.",
    recipes: [
      {
        f: ["fluorite","sulfuric acid"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "etching gas",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Fluorine-based gases that, turned into plasma, carve trenches into silicon only a few atoms wide.",
    recipes: [
      {
        f: ["fluorine gas","nitrogen"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "dopant gases",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Gases carrying boron or phosphorus. A few atoms per million turn silicon from a poor conductor into a switch.",
    recipes: [
      {
        f: ["borax","phosphate rock","hydrogen gas"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "silicon ingot",
    tier: "M",
    kind: "substance",
    firstAppeared: "~1950",
    fact: "A single, flawless crystal about 2 metres long and 30 cm across, pulled slowly from molten silicon over several days.",
    recipes: [
      {
        f: ["polysilicon","dopant gases"],
        w: ["czochralski puller","quartz crucible"],
        n: ["argon gas"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "polishing slurry",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Water full of microscopic silica grains. Polishing leaves a wafer flat to within a few nanometres.",
    recipes: [
      {
        f: ["sand","soda ash","water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "synthetic diamond",
    tier: "M",
    kind: "substance",
    firstAppeared: "1954",
    fact: "First made by General Electric in 1954. Diamond-studded wire is what slices silicon crystals into wafers.",
    recipes: [
      {
        label: "pressed",
        f: ["graphite"],
        w: ["diamond press"],
      },
      {
        label: "grown",
        f: ["natural gas","hydrogen gas"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "ultrapure water",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Water so pure it pulls minerals out of anything it touches. A large chip factory uses millions of litres a day.",
    recipes: [
      {
        f: ["water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "solvent",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Liquids that dissolve other chemicals so they can be spread in perfectly even films.",
    recipes: [
      {
        f: ["crude oil"],
        w: ["refinery"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "photoresist",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "A light-sensitive coating. Where light hits it, it changes, so a pattern can be printed onto the wafer. Japanese companies make most of the world's supply.",
    recipes: [
      {
        f: ["plastic","solvent"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "fused silica",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Pure glassy quartz. It barely expands when heated, so patterns printed through it stay sharp.",
    recipes: [
      {
        f: ["high-purity quartz"],
        w: ["furnace"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "photomask",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A plate carrying one layer of the chip's design. A leading-edge chip needs dozens of them, often more than 60.",
    recipes: [
      {
        f: ["fused silica","chromite","photoresist"],
        w: ["electron beam writer"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "refined copper",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-5000",
    fact: "People were smelting copper from ore 7,000 years ago. Today it's purified to 99.99% by dissolving it in acid and plating it back out with electricity.",
    recipes: [
      {
        label: "smelted",
        f: ["copper ore"],
        w: ["furnace"],
      },
      {
        label: "electrolytic",
        f: ["copper ore","sulfuric acid"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "tantalum metal",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Inside a chip, a layer just a few nanometres thick stops copper atoms leaking into the silicon.",
    recipes: [
      {
        f: ["coltan","hydrofluoric acid"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "cobalt metal",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Used for the tiniest wires in the newest chips, where copper stops working well.",
    recipes: [
      {
        f: ["cobalt ore","sulfuric acid"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "tungsten metal",
    tier: "M",
    kind: "substance",
    firstAppeared: "1783",
    fact: "Fills billions of tiny vertical holes that connect a chip's transistors to the wiring above.",
    recipes: [
      {
        f: ["tungsten ore","hydrogen gas"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "molybdenum metal",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Mostly used to toughen steel. In chip-making it forms the layers of the most precise mirrors ever made.",
    recipes: [
      {
        f: ["molybdenite","hydrogen gas"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "hafnium oxide",
    tier: "M",
    kind: "substance",
    firstAppeared: "2007",
    fact: "Since 2007, a layer of it a few atoms thick has insulated each transistor's gate, stopping current leaking through.",
    recipes: [
      {
        f: ["zircon","chlorine gas"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "ABF film",
    tier: "M",
    kind: "substance",
    firstAppeared: "1999",
    fact: "The insulating film inside nearly all computer processor packages comes from Ajinomoto, a Japanese company best known for MSG seasoning.",
    recipes: [
      {
        f: ["plastic","solvent"],
        w: ["chemical plant"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "transistor layer",
    tier: "C",
    kind: "part",
    firstAppeared: "~1959",
    fact: "Billions of transistors built up through hundreds of rounds of coating, printing, etching and doping. It takes about three months.",
    recipes: [
      {
        f: ["silicon wafer","photoresist","photomask","dopant gases","hafnium oxide","etching gas","tungsten metal"],
        w: ["lithography scanner","ion implanter","plasma etcher","chip fab"],
        n: ["ultrapure water"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "finished wafer",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A dozen or more layers of copper wiring sit above the transistors. Laid end to end, a large chip's wires could stretch for kilometres.",
    recipes: [
      {
        f: ["transistor layer","refined copper","tantalum metal","cobalt metal","photoresist","photomask"],
        w: ["lithography scanner","plasma etcher","chip fab"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "die",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "The wafer is cut into hundreds of individual chips, called dies. Faulty ones are marked and thrown away.",
    recipes: [
      {
        f: ["finished wafer"],
        w: ["dicing saw"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "package substrate",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A tiny circuit board that spreads a die's microscopic connections out to a size a phone's board can use.",
    recipes: [
      {
        f: ["ABF film","refined copper","glass"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "quartz crucible",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "A bowl of ultra-pure quartz that holds the molten silicon. Each one is used for a single crystal, then thrown away.",
    recipes: [
      {
        f: ["high-purity quartz"],
        w: ["furnace"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "EUV mirror",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Made by Zeiss with more than 100 alternating layers. Scaled up to the size of Germany, its biggest bump would be about 0.1 millimetres high.",
    recipes: [
      {
        f: ["molybdenum metal","polysilicon","fused silica"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "CO2 laser",
    tier: "C",
    kind: "part",
    firstAppeared: "1964",
    fact: "Fires at 50,000 droplets of molten tin every second, turning each into a flash of extreme ultraviolet light.",
    recipes: [
      {
        f: ["carbon dioxide","helium","nitrogen","copper wire","steel"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "argon fluoride laser",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Makes deep ultraviolet light at 193 nanometres. Neon makes up most of the gas inside it.",
    recipes: [
      {
        f: ["argon gas","fluorine gas","neon gas","steel"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "arc furnace",
    tier: "P",
    kind: "tool",
    firstAppeared: "~1900",
    fact: "Melts its load with a giant electric spark leaping between graphite rods.",
    recipes: [
      {
        f: ["steel","brick","graphite"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "siemens reactor",
    tier: "P",
    kind: "tool",
    firstAppeared: "~1955",
    fact: "Thin silicon rods glowing at about 1,100 °C slowly grow fat as pure silicon settles on them from a gas.",
    recipes: [
      {
        f: ["steel","copper wire"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "czochralski puller",
    tier: "P",
    kind: "tool",
    firstAppeared: "1916",
    fact: "The method dates from 1916. The story goes that Jan Czochralski dipped his pen into molten tin instead of his inkwell and pulled out a thread of metal crystal.",
    recipes: [
      {
        f: ["steel","graphite","copper wire"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "air separation unit",
    tier: "P",
    kind: "tool",
    firstAppeared: "1895",
    fact: "Cools air to about −190 °C until it turns liquid, then boils off each gas at its own temperature.",
    recipes: [
      {
        f: ["steel","electric motor"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "wire saw",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "One long wire studded with diamond, looped hundreds of times, slices a whole crystal into wafers at once.",
    recipes: [
      {
        f: ["steel","synthetic diamond"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "dicing saw",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "A diamond blade thinner than a hair cuts the finished wafer into chips.",
    recipes: [
      {
        f: ["steel","synthetic diamond"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "diamond press",
    tier: "P",
    kind: "tool",
    firstAppeared: "1954",
    fact: "Squeezes graphite at about 50,000 times atmospheric pressure and 1,500 °C until it becomes diamond.",
    recipes: [
      {
        f: ["steel"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "electron beam writer",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Draws a chip's design onto a photomask with beams of electrons. Writing one advanced mask can take 10 hours or more.",
    recipes: [
      {
        f: ["steel","magnet","copper wire"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "ion implanter",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "A small particle accelerator that fires boron and phosphorus atoms into the silicon.",
    recipes: [
      {
        f: ["steel","magnet","copper wire"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "plasma etcher",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Turns gas into a glowing plasma that eats away exactly the parts of the wafer left unprotected.",
    recipes: [
      {
        f: ["steel","fused silica","copper wire"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "lithography scanner",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "The EUV version, made only by the Dutch company ASML, costs about $250 million, weighs about 150 tonnes and ships in about 40 containers on cargo jets.",
    recipes: [
      {
        label: "EUV",
        f: ["EUV mirror","CO2 laser","tin","steel","magnet"],
      },
      {
        label: "DUV",
        f: ["argon fluoride laser","fused silica","steel"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "chemical plant",
    tier: "S",
    kind: "place",
    firstAppeared: "?",
    fact: "Turns raw materials into the pure chemicals industry runs on. Making a chip takes hundreds of them.",
    recipes: [
      {
        f: ["steel","concrete"],
      },
    ],
    linksN: ["water"],
    tags: ["fab-chain"],
  },
  {
    name: "packaging plant",
    tier: "S",
    kind: "place",
    firstAppeared: "?",
    fact: "Where dies are mounted, wired and sealed into the chips you'd recognise. Much of this work happens in Taiwan, China and Malaysia.",
    recipes: [
      {
        f: ["steel","concrete"],
      },
    ],
    tags: ["fab-chain"],
  },
  {
    name: "apple tree",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Apple trees grown from seed rarely taste like their parents, so every named apple variety is grafted from one original tree.",
    tags: ["combine-everyday"],
  },
  {
    name: "olive tree",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Some olive trees still bearing fruit today are over 2,000 years old.",
    tags: ["combine-everyday"],
  },
  {
    name: "grape vine",
    tier: "N",
    kind: "living",
    firstAppeared: "~-6000",
    fact: "Grapes were among the first fruits people farmed, about 8,000 years ago in the Caucasus.",
    tags: ["combine-everyday"],
  },
  {
    name: "rice plant",
    tier: "N",
    kind: "living",
    firstAppeared: "~-7000",
    fact: "Rice feeds more people than any other crop. It grows best standing in flooded paddies.",
    tags: ["combine-everyday"],
  },
  {
    name: "potato plant",
    tier: "N",
    kind: "living",
    firstAppeared: "~-6000",
    fact: "Potatoes were first farmed in the Andes about 8,000 years ago. Thousands of varieties still grow there.",
    tags: ["combine-everyday"],
  },
  {
    name: "soybean plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Soybean roots host bacteria that pull nitrogen from the air, so the plant fertilises its own soil.",
    tags: ["combine-everyday"],
  },
  {
    name: "tea plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Green, black and oolong tea all come from the same plant. Only the processing is different.",
    tags: ["combine-everyday"],
  },
  {
    name: "maize plant",
    tier: "N",
    kind: "living",
    firstAppeared: "~-7000",
    fact: "Maize was bred from a wild grass called teosinte in Mexico about 9,000 years ago.",
    tags: ["combine-everyday"],
  },
  {
    name: "barley",
    tier: "N",
    kind: "living",
    firstAppeared: "~-8000",
    fact: "One of the first grains ever farmed, around 10,000 years ago in the Fertile Crescent.",
    tags: ["combine-everyday"],
  },
  {
    name: "lemon tree",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Lemons are a cross between a bitter orange and a citron.",
    tags: ["combine-everyday"],
  },
  {
    name: "pepper plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Black pepper was once so valuable it was used as money and paid as rent.",
    tags: ["combine-everyday"],
  },
  {
    name: "flax plant",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Flax gives two things: fibres for linen from its stem, and linseed oil from its seeds.",
    tags: ["combine-everyday"],
  },
  {
    name: "bamboo",
    tier: "N",
    kind: "living",
    firstAppeared: "?",
    fact: "Some bamboo grows almost a metre in a single day, faster than any other plant.",
    tags: ["combine-everyday"],
  },
  {
    name: "pig",
    tier: "N",
    kind: "living",
    firstAppeared: "~-7000",
    fact: "Pigs were domesticated from wild boar about 9,000 years ago.",
    tags: ["combine-everyday"],
  },
  {
    name: "apple",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "An apple floats because about a quarter of it is air.",
    recipes: [
      {
        f: ["apple tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "olives",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Fresh olives are far too bitter to eat. They have to be cured in brine first.",
    recipes: [
      {
        f: ["olive tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "grapes",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "A single grape vine can keep producing fruit for over 100 years.",
    recipes: [
      {
        f: ["grape vine"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "rice",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Brown and white rice are the same grain. White rice has had its outer layers polished off.",
    recipes: [
      {
        f: ["rice plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "potato",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Potatoes were the first vegetable grown in space, in 1995.",
    recipes: [
      {
        f: ["potato plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "soybeans",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Soybeans are about 40% protein, more than almost any other plant food.",
    recipes: [
      {
        f: ["soybean plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tea leaves",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "A skilled picker takes only the top two leaves and a bud from each shoot.",
    recipes: [
      {
        f: ["tea plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "corn",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "An ear of corn almost always has an even number of rows.",
    recipes: [
      {
        f: ["maize plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lemon",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Sailors ate lemons to prevent scurvy long before anyone knew about vitamin C.",
    recipes: [
      {
        f: ["lemon tree"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pepper",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Black, white and green peppercorns come from the same vine, picked and dried in different ways.",
    recipes: [
      {
        f: ["pepper plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "malt",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Malt is grain that has been left to sprout and then dried, which turns its starch into sugar.",
    recipes: [
      {
        f: ["barley","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "flax fibre",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Flax stems are soaked for weeks so bacteria loosen the fibres inside.",
    recipes: [
      {
        f: ["flax plant"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "straw",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Straw is the dry stalk left over once the grain has been harvested.",
    recipes: [
      {
        f: ["wheat"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "feathers",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "A chicken has about 8,000 feathers.",
    recipes: [
      {
        f: ["chicken"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cream",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Leave fresh milk to stand and the cream rises to the top, because fat is lighter than water.",
    recipes: [
      {
        f: ["milk"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "yogurt",
    tier: "M",
    kind: "food",
    firstAppeared: "~-5000",
    fact: "Yogurt is milk that friendly bacteria have turned thick and sour.",
    recipes: [
      {
        f: ["milk","bacteria"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "ash",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Ash is what's left when wood burns: the minerals that can't go up in smoke. It's rich in potassium, which is why gardeners spread it on soil.",
    recipes: [
      {
        f: ["wood","air"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lye",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Lye is made by trickling water through wood ash. It is strong enough to dissolve fat.",
    recipes: [
      {
        f: ["ash","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "glaze",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "A glaze is a thin coat of glass melted onto pottery, which makes it waterproof and shiny.",
    recipes: [
      {
        f: ["sand","ash","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "felt",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Felt is the oldest fabric. Rub wet, soapy wool and the fibres lock together, no weaving needed.",
    recipes: [
      {
        f: ["wool","water","soap"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "linen",
    tier: "M",
    kind: "substance",
    firstAppeared: "~-8000",
    fact: "Linen is one of the oldest fabrics. Egyptian mummies were wrapped in it.",
    recipes: [
      {
        f: ["flax fibre"],
        w: ["spinning wheel","loom"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cardboard",
    tier: "M",
    kind: "substance",
    firstAppeared: "1856",
    fact: "Corrugated cardboard was first patented in 1856, as a lining for tall hats.",
    recipes: [
      {
        f: ["paper","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "compost",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "A handful of compost holds more living things than there are people on Earth.",
    recipes: [
      {
        f: ["leaf litter","soil"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "olive oil",
    tier: "M",
    kind: "food",
    firstAppeared: "~-6000",
    fact: "It takes about five kilograms of olives to make one litre of olive oil.",
    recipes: [
      {
        f: ["olives"],
        w: ["press"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "grape juice",
    tier: "M",
    kind: "food",
    firstAppeared: "1869",
    fact: "Grape juice was first bottled unfermented in 1869, by a dentist who wanted a wine-free drink for church.",
    recipes: [
      {
        f: ["grapes"],
        w: ["press"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tortilla",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Corn for tortillas is soaked in lime water first, which makes it far more nutritious.",
    recipes: [
      {
        f: ["corn","water","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "caramel",
    tier: "M",
    kind: "food",
    firstAppeared: "?",
    fact: "Caramel is sugar heated until it breaks apart and recombines into hundreds of new flavours.",
    recipes: [
      {
        f: ["sugar","butter","cream"],
        w: ["cooking pot"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "ice",
    tier: "M",
    kind: "substance",
    firstAppeared: "?",
    fact: "Water is one of very few things that gets lighter when it freezes, which is why ice floats.",
    recipes: [
      {
        f: ["water"],
        w: ["fridge"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "rope",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Rope gets its strength from twisting: each layer is twisted the opposite way to the one inside it.",
    recipes: [
      {
        f: ["flax fibre"],
        w: ["spinning wheel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "wheel",
    tier: "C",
    kind: "part",
    firstAppeared: "~-3500",
    fact: "The wheel was invented about 5,500 years ago, surprisingly late. Potters may have used it before carts did.",
    recipes: [
      {
        f: ["wood","steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "sail",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Sails carried people across oceans for thousands of years before engines.",
    recipes: [
      {
        f: ["linen","rope"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "mattress",
    tier: "C",
    kind: "part",
    firstAppeared: "?",
    fact: "Early mattresses were sacks stuffed with straw, wool or feathers.",
    recipes: [
      {
        f: ["fabric","wool","cotton"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "press",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "The screw press was built to squeeze grapes and olives, and later inspired the printing press.",
    recipes: [
      {
        f: ["wood","steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "barrel",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "A barrel's curved sides let one person roll a heavy load and turn it on the spot.",
    recipes: [
      {
        f: ["wood","steel"],
        w: ["saw"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cooking pot",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Pots let people boil food for the first time, opening up grains and beans that are hard to eat raw.",
    recipes: [
      {
        f: ["steel"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "frying pan",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "A well-kept cast iron pan can last for generations.",
    recipes: [
      {
        f: ["steel"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "fridge",
    tier: "P",
    kind: "tool",
    firstAppeared: "1913",
    fact: "A fridge doesn't make cold. It pumps heat out of the box and lets it out at the back.",
    recipes: [
      {
        f: ["steel","plastic","copper wire","electric motor"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "knitting needles",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "A sweater takes tens of thousands of stitches, every one made with two needles.",
    recipes: [
      {
        f: ["wood"],
        w: ["saw"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "knife",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "The oldest stone knives are over 2.5 million years old, older than our species.",
    recipes: [
      {
        f: ["steel","wood"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "hammer",
    tier: "P",
    kind: "tool",
    firstAppeared: "?",
    fact: "Hammers are among the oldest tools. The first were just stones held in the hand.",
    recipes: [
      {
        f: ["steel","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "wine",
    tier: "P",
    kind: "food",
    firstAppeared: "~-6000",
    fact: "Yeast eats the sugar in grape juice and leaves alcohol behind.",
    recipes: [
      {
        f: ["grape juice","yeast"],
        w: ["barrel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "vinegar",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Vinegar is wine that bacteria have soured. The name comes from the French for sour wine.",
    recipes: [
      {
        f: ["wine","bacteria"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "beer",
    tier: "P",
    kind: "food",
    firstAppeared: "~-5000",
    fact: "Beer is one of the oldest drinks. The workers who built the pyramids were partly paid in it.",
    recipes: [
      {
        f: ["malt","water","yeast"],
        w: ["barrel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cider",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Cider was so common in old England that farm workers were partly paid in it.",
    recipes: [
      {
        f: ["apple","yeast"],
        w: ["press"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "ham",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Salting meat draws the water out, so the bacteria that spoil it can't grow.",
    recipes: [
      {
        f: ["pig","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "ice cream",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Before freezers, ice cream was churned in a bucket of ice and salt, which gets colder than ice alone.",
    recipes: [
      {
        f: ["cream","sugar","egg"],
        w: ["fridge"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "soy sauce",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Traditional soy sauce ferments for months, sometimes years, in wooden barrels.",
    recipes: [
      {
        f: ["soybeans","wheat","salt"],
        w: ["barrel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tofu",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Tofu is made a lot like cheese, by curdling soy milk and pressing the curds.",
    recipes: [
      {
        f: ["soybeans","water","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "noodles",
    tier: "P",
    kind: "food",
    firstAppeared: "~-2000",
    fact: "The oldest known noodles, found in China, are about 4,000 years old.",
    recipes: [
      {
        f: ["flour","water","salt"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pasta",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "There are over 300 named pasta shapes, each made to hold sauce differently.",
    recipes: [
      {
        f: ["flour","egg"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "sushi",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Sushi began as a way to keep fish in fermenting rice. The rice was thrown away.",
    recipes: [
      {
        f: ["rice","fish","vinegar"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "french fries",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Both Belgium and France claim to have invented fries.",
    recipes: [
      {
        f: ["potato","olive oil","salt"],
        w: ["frying pan"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "jam",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Jam sets because of pectin, a natural glue in fruit that thickens when boiled with sugar.",
    recipes: [
      {
        f: ["apple","sugar"],
        w: ["cooking pot"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "apple pie",
    tier: "P",
    kind: "food",
    firstAppeared: "1381",
    fact: "An apple pie recipe was written down in England in 1381.",
    recipes: [
      {
        f: ["apple","flour","butter","sugar"],
        w: ["oven"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tea",
    tier: "P",
    kind: "food",
    firstAppeared: "~-2700",
    fact: "After water, tea is the most drunk drink in the world.",
    recipes: [
      {
        f: ["tea leaves","water"],
        w: ["kettle"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lemonade",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Lemonade sellers in 1600s Paris carried tanks on their backs and poured cups in the street.",
    recipes: [
      {
        f: ["lemon","sugar","water"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tomato sauce",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Tomatoes only reached Italian cooking in the late 1600s, after arriving from the Americas.",
    recipes: [
      {
        f: ["tomato","olive oil","salt"],
        w: ["cooking pot"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "soup",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Soup may be one of the oldest cooked dishes, possible once people had pots that could hold water over a fire.",
    recipes: [
      {
        f: ["potato","water","salt","pepper"],
        w: ["cooking pot"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "popcorn",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Each kernel holds a drop of water. Heat turns it to steam and bursts the kernel inside out.",
    recipes: [
      {
        f: ["corn","olive oil","salt"],
        w: ["cooking pot"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "taco",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "People in the Valley of Mexico were eating tacos long before the Spanish arrived.",
    recipes: [
      {
        f: ["tortilla","cheese","tomato"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "sandwich",
    tier: "P",
    kind: "food",
    firstAppeared: "1762",
    fact: "Named after the Earl of Sandwich, who is said to have eaten meat between bread so he could keep playing cards.",
    recipes: [
      {
        f: ["bread","cheese","butter"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pancake",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "People have been cooking flat cakes of ground grain for at least 30,000 years.",
    recipes: [
      {
        f: ["flour","egg","milk"],
        w: ["frying pan"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "omelette",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "A classic French omelette is cooked in under a minute.",
    recipes: [
      {
        f: ["egg","butter","cheese"],
        w: ["frying pan"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cookies",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "The first cookies were small test cakes, baked to check if the oven was hot enough.",
    recipes: [
      {
        f: ["flour","butter","sugar","egg"],
        w: ["oven"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "latte",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Latte just means milk in Italian.",
    recipes: [
      {
        f: ["coffee","milk"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "hot chocolate",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "The Maya drank chocolate cold, frothy and spiced with chilli, not sweet.",
    recipes: [
      {
        f: ["cocoa","milk","sugar"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "birthday cake",
    tier: "P",
    kind: "food",
    firstAppeared: "?",
    fact: "Candles on birthday cakes go back at least to 18th-century Germany.",
    recipes: [
      {
        f: ["cake","candle"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "soap",
    tier: "P",
    kind: "object",
    firstAppeared: "~-2800",
    fact: "One end of a soap molecule grabs water and the other grabs grease. That's how it washes.",
    recipes: [
      {
        f: ["olive oil","lye"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bowl",
    tier: "P",
    kind: "object",
    firstAppeared: "~-18000",
    fact: "The oldest pottery ever found, in China, is about 20,000 years old.",
    recipes: [
      {
        f: ["clay"],
        w: ["kiln"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "plate",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Before plates, many people ate off thick slices of stale bread called trenchers.",
    recipes: [
      {
        f: ["clay","glaze"],
        w: ["kiln"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cup",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Handles on cups became common in Europe in the 1700s, once people drank hot tea and coffee.",
    recipes: [
      {
        f: ["clay","glaze"],
        w: ["kiln"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "teapot",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Teapots were invented in China in the 1500s, once tea was brewed from loose leaves.",
    recipes: [
      {
        f: ["clay","glaze"],
        w: ["kiln"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "jar",
    tier: "P",
    kind: "object",
    firstAppeared: "1810",
    fact: "Sealing food in jars was invented to feed Napoleon's armies.",
    recipes: [
      {
        f: ["glass"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bottle",
    tier: "P",
    kind: "object",
    firstAppeared: "1903",
    fact: "Bottles were blown by hand, one at a time, until a machine was invented in 1903.",
    recipes: [
      {
        f: ["glass"],
        w: ["furnace"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "mirror",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Early glass mirrors were backed with tin and mercury. Before that, people used polished metal or stone.",
    recipes: [
      {
        f: ["glass","tin"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "hat",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Hat makers once used mercury to make felt, which poisoned them. Hence \"mad as a hatter\".",
    recipes: [
      {
        f: ["felt","thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "socks",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The oldest known knitted socks, from Egypt, are about 1,500 years old and have a split for the big toe.",
    recipes: [
      {
        f: ["wool"],
        w: ["knitting needles"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "scarf",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Roman soldiers wore scarves to wipe away sweat, not to keep warm.",
    recipes: [
      {
        f: ["wool","dye"],
        w: ["knitting needles"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "rug",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The oldest known rug, found frozen in a Siberian tomb, is about 2,500 years old.",
    recipes: [
      {
        f: ["wool","dye"],
        w: ["loom"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "towel",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Towels are woven with tiny loops that hugely increase the surface that soaks up water.",
    recipes: [
      {
        f: ["cotton","thread"],
        w: ["loom"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "t-shirt",
    tier: "P",
    kind: "object",
    firstAppeared: "1913",
    fact: "The T-shirt began as underwear issued to US sailors around 1913.",
    recipes: [
      {
        f: ["fabric","thread","dye"],
        w: ["sewing machine"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "dress",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The oldest known woven dress, made of linen in Egypt, is over 5,000 years old.",
    recipes: [
      {
        f: ["linen","thread","button"],
        w: ["sewing machine"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "gloves",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Gloves were found in Tutankhamun's tomb, over 3,000 years old.",
    recipes: [
      {
        f: ["leather","thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "belt",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "A leather belt was found with Ötzi the Iceman, who lived about 5,300 years ago.",
    recipes: [
      {
        f: ["leather","steel"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bag",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Ötzi the Iceman carried a leather pouch on his belt, with tools and tinder inside.",
    recipes: [
      {
        f: ["leather","thread","button"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "pillow",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "In ancient Mesopotamia some pillows were made of stone, to keep insects out of sleepers' hair.",
    recipes: [
      {
        f: ["fabric","feathers"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "bed",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Raised beds go back to ancient Egypt, partly to keep sleepers away from scorpions.",
    recipes: [
      {
        f: ["wood","mattress","nail"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "teddy bear",
    tier: "P",
    kind: "object",
    firstAppeared: "1902",
    fact: "The teddy bear is named after US President Theodore Roosevelt, who refused to shoot a captured bear.",
    recipes: [
      {
        f: ["fabric","cotton","thread","button"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "ball",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The Olmecs played ball games with solid rubber balls over 3,000 years ago.",
    recipes: [
      {
        f: ["leather","rubber","thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "tent",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "People have made tents for at least 40,000 years, from hides stretched over bones or wood.",
    recipes: [
      {
        f: ["fabric","rope","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "boat",
    tier: "P",
    kind: "object",
    firstAppeared: "~-8000",
    fact: "The oldest known boat, a dugout canoe from the Netherlands, is about 10,000 years old.",
    recipes: [
      {
        f: ["wood","nail","sail"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "cart",
    tier: "P",
    kind: "object",
    firstAppeared: "~-3500",
    fact: "Early carts were pulled by oxen at about walking pace.",
    recipes: [
      {
        f: ["wood","wheel","nail"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "skateboard",
    tier: "P",
    kind: "object",
    firstAppeared: "1950",
    fact: "Skateboards were invented by Californian surfers who wanted to surf when the waves were flat.",
    recipes: [
      {
        f: ["wood","wheel","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "wheelbarrow",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The wheelbarrow was used in China about 2,000 years ago, over 1,000 years before it reached Europe.",
    recipes: [
      {
        f: ["steel","wheel","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "chair",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "For most of history chairs were for important people. Everyone else sat on benches or stools.",
    recipes: [
      {
        f: ["wood","nail","glue"],
        w: ["saw"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "broom",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Brooms were the most common household tool, which may be why stories put witches on them.",
    recipes: [
      {
        f: ["wood","straw"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "basket",
    tier: "P",
    kind: "object",
    firstAppeared: "~-8000",
    fact: "Basket weaving is older than pottery. The earliest baskets are over 10,000 years old.",
    recipes: [
      {
        f: ["bamboo","rope"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "kite",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Kites were invented in China over 2,000 years ago and were used to send military signals.",
    recipes: [
      {
        f: ["bamboo","paper","thread"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "flute",
    tier: "P",
    kind: "object",
    firstAppeared: "~-40000",
    fact: "The oldest known instruments are flutes carved from bird bone over 40,000 years ago.",
    recipes: [
      {
        f: ["bamboo"],
        w: ["knife"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "drum",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Drums are among the oldest instruments, used for music, dance and sending messages over distance.",
    recipes: [
      {
        f: ["wood","leather","rope"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "guitar",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "A guitar's hollow body vibrates along with the strings, which makes them much louder.",
    recipes: [
      {
        f: ["wood","steel","glue"],
        w: ["saw"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "crayon",
    tier: "P",
    kind: "object",
    firstAppeared: "1903",
    fact: "Modern crayons first went on sale in 1903, in a box of eight colours.",
    recipes: [
      {
        f: ["beeswax","dye"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "envelope",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Envelopes with ready-gummed flaps only appeared in the 1800s. Before that, letters were folded and sealed with wax.",
    recipes: [
      {
        f: ["paper","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "notebook",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The stitched spine of a notebook lets it open flat without pages falling out.",
    recipes: [
      {
        f: ["paper","thread","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "newspaper",
    tier: "P",
    kind: "information",
    firstAppeared: "1605",
    fact: "The first newspaper was printed in Strasbourg in 1605.",
    recipes: [
      {
        f: ["paper","ink"],
        w: ["printing press"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "box",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The folding cardboard box was invented by accident in 1879, when a printing machine cut and creased a paper bag.",
    recipes: [
      {
        f: ["cardboard","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "board game",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "The oldest known board game, Senet, was played in Egypt over 5,000 years ago.",
    recipes: [
      {
        f: ["cardboard","paper","ink","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "umbrella",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Umbrellas were first used for shade. The name comes from the Latin for shadow.",
    recipes: [
      {
        f: ["fabric","steel","wood"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "matches",
    tier: "P",
    kind: "object",
    firstAppeared: "1826",
    fact: "The friction match was invented in 1826 by accident, when a chemist scraped a stirring stick on his hearth.",
    recipes: [
      {
        f: ["wood","sulfur","glue"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "lamp",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Before electric lamps, people burned oil, wax or fat for light after dark.",
    recipes: [
      {
        f: ["light bulb","glass","copper wire"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "washing machine",
    tier: "P",
    kind: "object",
    firstAppeared: "1908",
    fact: "The washing machine gave many families back a whole day of work every week.",
    recipes: [
      {
        f: ["steel","electric motor","plastic","rubber"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "fireplace",
    tier: "P",
    kind: "object",
    firstAppeared: "?",
    fact: "Chimneys only became common in Europe around the 1100s. Before that, smoke left through a hole in the roof.",
    recipes: [
      {
        f: ["brick","cement"],
      },
    ],
    tags: ["combine-everyday"],
  },
  {
    name: "garden",
    tier: "S",
    kind: "place",
    firstAppeared: "?",
    fact: "The oldest known gardens were planted in Egypt and Mesopotamia over 4,000 years ago.",
    recipes: [
      {
        f: ["soil","compost","flower"],
      },
    ],
    tags: ["combine-everyday"],
  },
];
