export type Product = {
  id: string;
  isDemo?: boolean;
  name: string;
  flavour: string;
  category: "Classic" | "Masala" | "Fresh" | "Cheesy" | "Premium";
  price: number;
  weight: string;
  note: string;
  accent: string;
  ink: string;
  symbol: string;
  mood: string;
  tagline: string;
  tag?: string;
  imageUrl?: string;
  mrp?: number;
  slug?: string;
  sku?: string;
  ingredients?: string;
  allergenInfo?: string;
  nutritionInfo?: string;
  storageInstructions?: string;
  shelfLife?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  fssaiLicenseNumber?: string;
  countryOfOrigin?: string;
};

// Preview catalogue only. Replace flavour names, pack details, ingredients and
// prices with POKHAR'S approved production SKUs before taking real orders.
export const products: Product[] = [
  {
    id: "classic-salted",
    name: "Classic Salted",
    flavour: "The OG crunch",
    category: "Classic",
    price: 180,
    weight: "83 g",
    note: "For the days when simple just hits right.",
    accent: "#0b694f",
    ink: "#07543f",
    symbol: "✳",
    mood: "CLASSIC",
    tagline: "Old-school. All cool.",
    tag: "THE ORIGINAL",
  },
  {
    id: "masala-mix",
    name: "Chatpata Masala",
    flavour: "Spicy & chatpata",
    category: "Masala",
    price: 180,
    weight: "83 g",
    note: "A little masala. A whole lot of masti.",
    accent: "#a92725",
    ink: "#85201f",
    symbol: "✺",
    mood: "MASALA",
    tagline: "Too tasty to share.",
    tag: "BOLD PICK",
  },
  {
    id: "pudina-mint",
    name: "Pudina Mint",
    flavour: "Fresh & herby",
    category: "Fresh",
    price: 180,
    weight: "83 g",
    note: "A fresh little break from the usual.",
    accent: "#2e7955",
    ink: "#1d6041",
    symbol: "❋",
    mood: "MINTY",
    tagline: "Fresh mood only.",
  },
  {
    id: "cheesy-herbs",
    name: "Cheesy Herbs",
    flavour: "Cheesy & savoury",
    category: "Cheesy",
    price: 180,
    weight: "83 g",
    note: "A cosy, cheesy kind of snack break.",
    accent: "#e4b52c",
    ink: "#946b13",
    symbol: "✷",
    mood: "CHEESY",
    tagline: "Cheese the day.",
  },
  {
    id: "peri-peri",
    name: "Peri Peri",
    flavour: "Fiery & tangy",
    category: "Masala",
    price: 180,
    weight: "83 g",
    note: "Bringing the fire to your snack time.",
    accent: "#f05a32",
    ink: "#b83e24",
    symbol: "✹",
    mood: "PERI PERI",
    tagline: "Turn the heat up.",
    tag: "FAN FAVOURITE",
  },
  {
    id: "salt-pepper",
    name: "Salt & Pepper",
    flavour: "Peppery & bold",
    category: "Premium",
    price: 180,
    weight: "83 g",
    note: "A little kick. A lot of crunch.",
    accent: "#e98cab",
    ink: "#a54d70",
    symbol: "✿",
    mood: "SALTY",
    tagline: "Snack. Chill. Repeat.",
  },
];
