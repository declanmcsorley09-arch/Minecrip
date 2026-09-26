import { PixelImage, rgb } from './PixelImage.js';

/**
 * Pixel-art definitions for non-block items. Each pattern is 16 rows of 16
 * characters; every character maps to a palette entry ('.' is transparent).
 * Tools share shapes and are recoloured per material tier.
 * @module renderer/textures/ItemTextures
 */

const TOOL_SHAPES = {
  pickaxe: [
    '................',
    '....HHHHHHH.....',
    '...HhhhhhhhH....',
    '..Hh.......hH...',
    '.Hh....S....hH..',
    '.H....S.....hH..',
    '.....S.......H..',
    '....S...........',
    '...S............',
    '..S.............',
    '.S..............',
    'S...............',
    '................',
    '................',
    '................',
    '................',
  ],
  axe: [
    '................',
    '......HHH.......',
    '.....HhhhH......',
    '....Hhhhhh......',
    '....HhhhSh......',
    '.....hhS........',
    '......S.........',
    '.....S..........',
    '....S...........',
    '...S............',
    '..S.............',
    '.S..............',
    'S...............',
    '................',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '..........HHH...',
    '.........HhhhH..',
    '.........HhhhH..',
    '..........hhH...',
    '.........S......',
    '........S.......',
    '.......S........',
    '......S.........',
    '.....S..........',
    '....S...........',
    '...S............',
    '..S.............',
    '.S..............',
    '................',
    '................',
  ],
  sword: [
    '...........HHH..',
    '..........HhhH..',
    '.........HhhH...',
    '........HhhH....',
    '.......HhhH.....',
    '......HhhH......',
    '..G..HhhH.......',
    '...GHhhH........',
    '....GhH.........',
    '....SGG.........',
    '...S..G.........',
    '..S.............',
    '.S..............',
    '................',
    '................',
    '................',
  ],
};

const TIER_COLORS = {
  wooden: ['#8a6a3a', '#b08a52'],
  stone: ['#5f5f5f', '#8f8f8f'],
  iron: ['#b8b8b8', '#eeeeee'],
  diamond: ['#1e9aa3', '#6ff2f0'],
};

const ITEM_PATTERNS = {
  stick: {
    palette: { S: '#6b4c2a', s: '#8f6a3c' },
    rows: [
      '................', '................', '................', '...........Ss...',
      '..........Ss....', '.........Ss.....', '........Ss......', '.......Ss.......',
      '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........',
      '................', '................', '................', '................',
    ],
  },
  coal: {
    palette: { a: '#1f1f1f', b: '#3a3a3a', c: '#555555' },
    rows: [
      '................', '................', '................', '......aaaa......',
      '....aabbbbaa....', '...abbcbbbbba...', '...abcbbbbbba...', '..abbbbbbcbba...',
      '..abbbbbbbbba...', '..aabbbcbbbaa...', '...abbbbbbba....', '....aabbbaa.....',
      '......aaa.......', '................', '................', '................',
    ],
  },
  charcoal: {
    palette: { a: '#2a2018', b: '#43352a', c: '#5e4a3a' },
    rows: 'coal',
  },
  iron_ingot: {
    palette: { a: '#8a8a8a', b: '#d8d8d8', c: '#f5f5f5', d: '#6a6a6a' },
    rows: [
      '................', '................', '................', '................',
      '................', '......cccccc....', '....cbbbbbbbc...', '...cbbbbbbbbba..',
      '..cbbbbbbbbbad..', '.abbbbbbbbbad...', '.aaaaaaaaaad....', '..dddddddddd....',
      '................', '................', '................', '................',
    ],
  },
  gold_ingot: {
    palette: { a: '#c9912a', b: '#f7d74a', c: '#fff5a0', d: '#9a6a18' },
    rows: 'iron_ingot',
  },
  diamond: {
    palette: { a: '#177a80', b: '#3fd6dd', c: '#b8fcff', d: '#0f5a60' },
    rows: [
      '................', '................', '................', '.....aaaaaa.....',
      '....abcbbcba....', '...abccbbccba...', '..abbbbbbbbbba..', '..dabbbbbbbbad..',
      '...dabbbbbbad...', '....dabbbbad....', '.....dabbad.....', '......dbbd......',
      '.......dd.......', '................', '................', '................',
    ],
  },
  leather: {
    palette: { a: '#6b3f22', b: '#96582f', c: '#b87040' },
    rows: [
      '................', '................', '...aa......aa...', '..abbaaaaaabba..',
      '..abbbbbbbbbba..', '...abbbcbbbba...', '...abbbbbbbba...', '...abbbbcbbba...',
      '...abbbbbbbba...', '..abbbbbbbbbba..', '..abbcbbbbbbba..', '..aabbbbbbbbaa..',
      '....aaaaaaaa....', '................', '................', '................',
    ],
  },
  bone: {
    palette: { a: '#bdb8a6', b: '#ecead9', c: '#fffef5' },
    rows: [
      '................', '................', '...........cb...', '..........cbba..',
      '..........bbba..', '.........bba....', '........bba.....', '.......bba......',
      '......bba.......', '.....bba........', '..cbbba.........', '..cbba..........',
      '...ba...........', '................', '................', '................',
    ],
  },
  arrow: {
    palette: { a: '#8f8f8f', b: '#dddddd', s: '#6b4c2a', f: '#eeeeee', g: '#b0b0b0' },
    rows: [
      '................', '...........bb...', '..........bab....', '.........bab.....',
      '........sb......', '.......s........', '......s.........', '.....s..........',
      '....s...........', '...s............', '.ffs............', '.fgf............',
      '..f.............', '................', '................', '................',
    ],
  },
  rotten_flesh: {
    palette: { a: '#5a6b2a', b: '#8a9a3a', c: '#b35a3a', d: '#6e2f22' },
    rows: [
      '................', '................', '.....aaaa.......', '....abbbbaa.....',
      '...abcbbbbba....', '...abbbcbbbba...', '....abbbbbcbba..', '....abcbbbbbba..',
      '...abbbbcbbba...', '..abbdbbbbba....', '..abbbbbcba.....', '...aabbbaa......',
      '.....aaa........', '................', '................', '................',
    ],
  },
  apple: {
    palette: { a: '#8f1a1a', b: '#d42a2a', c: '#ff6a6a', s: '#6b4c2a', l: '#3f8a2a' },
    rows: [
      '................', '.......s........', '.......sll......', '........ll......',
      '....aaa.aaa.....', '...abbbabbba....', '..abcbbbbbbba...', '..abcbbbbbbba...',
      '..abbbbbbbbba...', '..abbbbbbbbba...', '..abbbbbbbbba...', '...abbbbbbba....',
      '....aabbbaa.....', '......aaa.......', '................', '................',
    ],
  },
  raw_beef: {
    palette: { a: '#8a2020', b: '#c83a3a', c: '#f08080', w: '#f0d8d0' },
    rows: [
      '................', '................', '......aaaa......', '....aabbbbaa....',
      '...abbcbbbbba...', '..abbbbwbbcbba..', '..abcbbbbbbbba..', '..abbbwbbbbbba..',
      '..abbbbbbcbbba..', '...abbbbbbbba...', '....aabbbbaa....', '......aaaa......',
      '................', '................', '................', '................',
    ],
  },
  cooked_beef: { palette: { a: '#4a2a18', b: '#7a4a2a', c: '#a0683a', w: '#c09060' }, rows: 'raw_beef' },
  raw_porkchop: { palette: { a: '#b0606a', b: '#f0a0a8', c: '#ffd0d8', w: '#ffffff' }, rows: 'raw_beef' },
  cooked_porkchop: { palette: { a: '#6a4020', b: '#b07a48', c: '#d8a870', w: '#f0d8b0' }, rows: 'raw_beef' },
  raw_mutton: { palette: { a: '#8a3030', b: '#d05050', c: '#f09090', w: '#f8e8e0' }, rows: 'raw_beef' },
  cooked_mutton: { palette: { a: '#5a3020', b: '#8a5030', c: '#b07048', w: '#d8b090' }, rows: 'raw_beef' },
};

/**
 * Paints a pattern.
 * @param {string[]} rows
 * @param {Record<string, string>} palette
 * @returns {PixelImage}
 */
function paintPattern(rows, palette) {
  const img = new PixelImage(16);
  img.data.fill(0);
  const colors = {};
  for (const [k, v] of Object.entries(palette)) colors[k] = rgb(v);
  for (let y = 0; y < 16; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const c = colors[ch];
      if (c) img.set(x, y, c);
    }
  }
  return img;
}

/**
 * Paints an item icon from its icon key ("tool:<type>:<tier>" or an item name).
 * @param {string} icon
 * @returns {PixelImage|null} null when the key refers to a block
 */
export function paintItemTexture(icon) {
  if (icon.startsWith('tool:')) {
    const [, type, tier] = icon.split(':');
    const [dark, light] = TIER_COLORS[tier];
    return paintPattern(TOOL_SHAPES[type], { H: dark, h: light, S: '#6b4c2a', G: '#4a3a2a' });
  }
  const def = ITEM_PATTERNS[icon];
  if (!def) return null;
  const rows = typeof def.rows === 'string' ? ITEM_PATTERNS[def.rows].rows : def.rows;
  return paintPattern(rows, def.palette);
}
