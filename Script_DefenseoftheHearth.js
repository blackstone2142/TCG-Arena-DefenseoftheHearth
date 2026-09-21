// Script_DefenseoftheHearth.js
// Converts the Supply / Creature / Hero Google Sheets (each with a paired Back sheet,
// published as CSV) into DefenseoftheHearthCards.json.
// Run with: node Script_DefenseoftheHearth.js
// Requires Node 18+ (uses built-in fetch). No external dependencies.

const fs = require("fs");

const GITHUB_OWNER = "blackstone2142";
const GITHUB_REPO = "TCG-Arena-DefenseoftheHearth";

// Published CSV links (File > Share > Publish to web > CSV) for each sheet/tab.
const BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9-ZfmbbzWNF1-sRtMYVi0PHMa511o92aKfZCs6J-N6dJnEe-Fz2uzhCA7gqgj6ze74slXvsODPXqu/pub";
const SUPPLY_CSV_URL = `${BASE}?gid=0&single=true&output=csv`;
const SUPPLY_BACK_CSV_URL = `${BASE}?gid=77249058&single=true&output=csv`;
const CREATURE_CSV_URL = `${BASE}?gid=1785040501&single=true&output=csv`;
const CREATURE_BACK_CSV_URL = `${BASE}?gid=2117075324&single=true&output=csv`;
const HERO_CSV_URL = `${BASE}?gid=908871516&single=true&output=csv`;
const HERO_BACK_CSV_URL = `${BASE}?gid=2080564394&single=true&output=csv`;

/**
 * Minimal, dependency-free CSV parser.
 * Handles quoted fields, embedded commas, and embedded newlines (e.g. "Balista\n(Repeater)").
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\r") {
        // skip, handled by \n
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key.trim()] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

/**
 * Converts a GitHub "blob" viewer URL into a live GitHub Pages URL.
 * e.g. https://github.com/OWNER/REPO/blob/main/path/to/file.png
 *   -> https://OWNER.github.io/REPO/path/to/file.png
 * Works for both branch names and commit-hash blob URLs.
 * If the URL isn't a blob URL (already raw/Pages/external), it's returned unchanged.
 */
function blobToPages(url) {
  if (!url) return url;
  const match = url
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/);
  if (match) {
    const [, owner, repo, path] = match;
    return `https://${owner}.github.io/${repo}/${path}`;
  }
  return url;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n; // keep non-numeric values like "X" as-is
}

// Reads a value from the first present/non-empty of several possible column names
// (the sheets are inconsistent: "CardType" vs "Card Type", "Double-faced" vs "Double-sided").
function get(row, ...keys) {
  for (const k of keys) {
    if (row[k] && row[k].trim() !== "") return row[k].trim();
  }
  return "";
}

async function fetchCSV(url, label) {
  console.log(`Fetching ${label}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${label}: ${res.status} ${res.statusText}`);
  }
  return parseCSV(await res.text());
}

function indexById(rows) {
  const map = {};
  for (const r of rows) map[r["Card ID"]] = r;
  return map;
}

function convertSupplyRow(row, backRow) {
  const id = row["Card ID"];
  const doubleFaced = get(row, "Double-faced", "Double-sided").toUpperCase() === "TRUE";
  const frontImage = blobToPages(row["Card Image"]);
  const backImage = blobToPages((backRow && backRow["Card Image"]) || "") || frontImage;
  const keywords = [row["Keyword 1"], row["Keyword 2"], row["Keyword 3"]].filter(
    (k) => k && k.trim() !== ""
  );
  const superType = row["SuperType"];

  // `type` is the ONLY field the engine's categoriesAlreadyOnBoard/deckRulesets can match
  // against (dev-confirmed) - it routes cards to the correct deckbuilding zone/legality bucket.
  // `superType` holds the display classification (Building/Skill/Domain/Hearth/etc.).
  const cardType = get(row, "CardType", "Card Type") || (superType === "Hearth" ? "Keep" : "Supply");

  return {
    id,
    face: {
      front: { name: row["Name"], type: cardType, cost: toNumberOrNull(row["Cost"]), image: frontImage, isHorizontal: false },
      back: { name: doubleFaced ? row["Name"] : "", image: backImage, isHorizontal: false }
    },
    name: row["Name"],
    type: cardType,
    superType,
    subType: row["SubType"] || null,
    class: row["Class"] || null,
    set: row["Set"] || "",
    level: toNumberOrNull(row["Level"]),
    cost: toNumberOrNull(row["Cost"]),
    rounds: toNumberOrNull(row["Rounds"]),
    power: toNumberOrNull(row["Power"]),
    range: toNumberOrNull(row["Range"]),
    augmentAtkRange: row["Augment/AtkRange"] || null,
    faction: row["Faction Name"] || null,
    keywords,
    cardInfo: row["Card Info"] || "",
    rarity: row["Rarity"] || null, // display only - not enforceable as a deck-legality cap
    doubleFaced
  };
}

function convertCreatureRow(row, backRow) {
  const id = row["Card ID"];
  const doubleFaced = get(row, "Double-sided", "Double-faced").toUpperCase() === "TRUE";
  const frontImage = blobToPages(row["Card Image"]);
  const backImage = blobToPages((backRow && backRow["Card Image"]) || "") || frontImage;
  const keywords = [row["Keyword 1"], row["Keyword 2"], row["Keyword 3"]].filter(
    (k) => k && k.trim() !== ""
  );
  const superType = row["SuperType"];
  const sheetCardType = get(row, "Card Type", "CardType");
  // Token SuperType is always forced to Token cardType (excluded from deckbuilding),
  // overriding whatever the sheet's Card Type column says - confirmed intent 2026-08-18.
  const cardType = superType === "Token" ? "Token" : sheetCardType;

  return {
    id,
    face: {
      front: { name: row["Name"], type: cardType, cost: null, image: frontImage, isHorizontal: false },
      back: { name: doubleFaced ? row["Name"] : "", image: backImage, isHorizontal: false }
    },
    name: row["Name"],
    type: cardType,
    superType,
    subType: row["SubType"] || null,
    class: row["Class"] || null,
    set: row["Set"] || "",
    power: toNumberOrNull(row["Power"]),
    health: toNumberOrNull(row["Health"]),
    speed: toNumberOrNull(row["Speed"]),
    range: toNumberOrNull(row["Range"]),
    faction: row["Faction Name"] || null,
    keywords,
    cardInfo: row["Card Info"] || "",
    rarity: row["Rarity"] || null,
    doubleFaced
  };
}

function convertHeroRow(row, backRow) {
  const id = row["Card ID"];
  const doubleFaced = get(row, "Double-sided", "Double-faced").toUpperCase() === "TRUE";
  const frontImage = blobToPages(row["Card Image"]);
  const backImage = blobToPages((backRow && backRow["Card Image"]) || "") || frontImage;
  const superType = row["SuperType"];
  // Hero sheet has no Card Type column - derived from SuperType (confirmed 2026-08-18):
  // Hero -> Leader (the singleton pick), Hero Token -> Token (created by in-play leveling effects).
  const cardType = superType === "Hero" ? "Leader" : superType === "Hero Token" ? "Token" : superType;

  return {
    id,
    face: {
      front: { name: row["Name"], type: cardType, cost: null, image: frontImage, isHorizontal: false },
      back: { name: doubleFaced ? row["Name"] : "", image: backImage, isHorizontal: false }
    },
    name: row["Name"],
    type: cardType,
    superType,
    class: row["Class"] || null,
    set: row["Set"] || "",
    faction: row["Faction Name"] || null,
    cardInfo: row["Card Info"] || "",
    rarity: row["Rarity"] || null,
    doubleFaced
  };
}

async function main() {
  const allCards = {};

  const [supplyRows, supplyBackRows, creatureRows, creatureBackRows, heroRows, heroBackRows] = await Promise.all([
    fetchCSV(SUPPLY_CSV_URL, "Supply"),
    fetchCSV(SUPPLY_BACK_CSV_URL, "Supply-Back"),
    fetchCSV(CREATURE_CSV_URL, "Creature"),
    fetchCSV(CREATURE_BACK_CSV_URL, "Creature-Back"),
    fetchCSV(HERO_CSV_URL, "Hero"),
    fetchCSV(HERO_BACK_CSV_URL, "Hero-Back")
  ]);

  const supplyBackById = indexById(supplyBackRows);
  const creatureBackById = indexById(creatureBackRows);
  const heroBackById = indexById(heroBackRows);

  for (const row of supplyRows) {
    if (!row["Card ID"]) continue;
    allCards[row["Card ID"]] = convertSupplyRow(row, supplyBackById[row["Card ID"]]);
  }
  for (const row of creatureRows) {
    if (!row["Card ID"]) continue;
    allCards[row["Card ID"]] = convertCreatureRow(row, creatureBackById[row["Card ID"]]);
  }
  for (const row of heroRows) {
    if (!row["Card ID"]) continue;
    allCards[row["Card ID"]] = convertHeroRow(row, heroBackById[row["Card ID"]]);
  }

  console.log(`Supply: ${supplyRows.length} | Creature: ${creatureRows.length} | Hero: ${heroRows.length}`);

  fs.writeFileSync("DefenseoftheHearthCards.json", JSON.stringify(allCards, null, 2), "utf-8");
  console.log(`Wrote DefenseoftheHearthCards.json with ${Object.keys(allCards).length} total cards.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
