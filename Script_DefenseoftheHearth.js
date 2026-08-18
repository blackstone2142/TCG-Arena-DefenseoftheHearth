// Script_DefenseoftheHearth.js
// Converts the "Supply" Google Sheet (published as CSV) into DefenseoftheHearthCards.json
// Run with: node Script_DefenseoftheHearth.js
// Requires Node 18+ (uses built-in fetch). No external dependencies.

const fs = require("fs");

const GITHUB_OWNER = "blackstone2142";
const GITHUB_REPO = "TCG-Arena-DefenseoftheHearth";

// The shared generic back used for every card that isn't double-faced.
const SHARED_CARDBACK = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/Images/Card_Sets/Hearthland/Supply/_back/DotH_Cardback.png`;

// Published CSV link for the Supply front sheet (File > Share > Publish to web > CSV)
const SUPPLY_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9-ZfmbbzWNF1-sRtMYVi0PHMa511o92aKfZCs6J-N6dJnEe-Fz2uzhCA7gqgj6ze74slXvsODPXqu/pub?gid=0&single=true&output=csv";

// Add more {name, url} entries here as you add Creature / Hero sheets later.
const SHEETS = [
  { name: "Supply", url: SUPPLY_CSV_URL }
];

/**
 * Minimal, dependency-free CSV parser.
 * Handles quoted fields, embedded commas, and embedded newlines (e.g. "Balista\n(Repeater)").
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Normalize line endings but keep embedded \n inside quoted fields intact
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

function convertSupplyRow(row) {
  const id = row["Card ID"];
  const doubleFaced = (row["Double-faced"] || "").toUpperCase() === "TRUE";
  const frontImage = blobToPages(row["Card Image"]);
  const keywords = [row["Keyword 1"], row["Keyword 2"], row["Keyword 3"]].filter(
    (k) => k && k.trim() !== ""
  );
  const superType = row["SuperType"];

  // Internal-only field (never shown to players) that routes cards to the correct
  // deckbuilding zone/legality bucket at setup, independent of SuperType/subType used for display.
  // Supply = regular player cards, Keep = the Hearth card, Token = created-in-play cards
  // excluded from deckbuilding entirely. Read directly from the sheet's own CardType column.
  const cardType = row["CardType"] || (superType === "Hearth" ? "Keep" : "Supply");

  return {
    id,
    face: {
      front: {
        name: row["Name"],
        type: superType,
        cost: toNumberOrNull(row["Cost"]),
        image: frontImage,
        isHorizontal: false
      },
      back: {
        name: doubleFaced ? row["Name"] : "",
        image: doubleFaced ? frontImage : SHARED_CARDBACK, // TODO: wire in unique back image once double-faced cards exist
        isHorizontal: false
      }
    },
    name: row["Name"],
    type: superType,
    subType: row["SubType"] || null,
    cardType,
    set: row["Set"] || "",
    level: toNumberOrNull(row["Level"]),
    cost: toNumberOrNull(row["Cost"]),
    rounds: toNumberOrNull(row["Rounds"]),
    power: toNumberOrNull(row["Power"]),
    range: toNumberOrNull(row["Range"]),
    augmentAtkRange: row["Augment/AtkRange"] || null,
    leaderLock: row["Leader Lock"] || null,
    faction: row["Faction Name"] || null,
    keywords,
    cardInfo: row["Card Info"] || "",
    rarity: row["Rarity"] || null,
    doubleFaced
  };
}

async function main() {
  const allCards = {};

  for (const sheet of SHEETS) {
    console.log(`Fetching ${sheet.name} sheet...`);
    const res = await fetch(sheet.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${sheet.name} CSV: ${res.status} ${res.statusText}`);
    }
    const csvText = await res.text();
    const rows = parseCSV(csvText);

    for (const row of rows) {
      if (!row["Card ID"]) continue;
      // Only the Supply converter is implemented so far.
      // Add "else if (sheet.name === 'Creature') { ... }" etc. as those sheets come online.
      allCards[row["Card ID"]] = convertSupplyRow(row);
    }
    console.log(`  -> ${rows.length} rows processed`);
  }

  fs.writeFileSync(
    "DefenseoftheHearthCards.json",
    JSON.stringify(allCards, null, 2),
    "utf-8"
  );
  console.log(`Wrote DefenseoftheHearthCards.json with ${Object.keys(allCards).length} total cards.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
