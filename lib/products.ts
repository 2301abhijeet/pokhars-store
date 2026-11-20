export type Product = {
  id: string;
  name: string;
  flavour: string;
  category: "Classic" | "Masala" | "Premium";
  price: number;
  weight: string;
  note: string;
  accent: string;
  symbol: string;
  tag?: string;
};

// Preview catalogue only. Replace names, ingredients and prices with approved
// production SKUs before accepting real customer orders.
export const products: Product[] = [
  {
    id: "classic-salted",
    name: "Classic Salted",
    flavour: "Classic",
    category: "Classic",
    price: 180,
    weight: "83 g",
    note: "A simple, satisfying everyday crunch.",
    accent: "#c9a66b",
    symbol: "✺",
    tag: "THE ORIGINAL",
  },
  {
    id: "peri-peri",
    name: "Peri Peri",
    flavour: "Fiery & tangy",
    category: "Masala",
    price: 180,
    weight: "83 g",
    note: "A lively kick for your snack breaks.",
    accent: "#b85f42",
    symbol: "✷",
    tag: "BOLD PICK",
  },
  {
    id: "pudina-mint",
    name: "Pudina Mint",
    flavour: "Fresh & herby",
    category: "Masala",
    price: 180,
    weight: "83 g",
    note: "A cooling, savoury twist.",
    accent: "#718268",
    symbol: "❋",
  },
  {
    id: "mithila-mix",
    name: "Mithila Special",
    flavour: "Signature blend",
    category: "Premium",
    price: 180,
    weight: "83 g",
    note: "A signature idea inspired by home.",
    accent: "#596887",
    symbol: "✳",
    tag: "SIGNATURE",
  },
];
