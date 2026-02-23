/**
 * NSS Standard Cave Cartography Symbol Library
 *
 * SVG icons for annotating survey maps based on shot comments.
 * All icons use a 24x24 viewBox with currentColor for theming.
 *
 * Usage:
 *   Canvas:  const img = new Image(); img.src = symbolToDataURL(SYMBOLS.flowstone, '#ff9800')
 *   Leaflet: L.divIcon({ html: colorize(SYMBOLS.flowstone, '#00e5ff'), className: '' })
 *   React:   <span dangerouslySetInnerHTML={{ __html: SYMBOLS.flowstone }} />
 */

// Helpers: wrap SVG inner content with standard attributes
const S = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const F = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="none" fill="currentColor">${d}</svg>`

const M = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`


// ═══════════════════════════════════════════════════════════════
//  SYMBOL DEFINITIONS — organized by NSS legend categories
// ═══════════════════════════════════════════════════════════════

export const SYMBOLS = {

  // ── PASSAGES ──────────────────────────────────────────────

  passage_walls: S(
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<line x1="6" y1="8" x2="6" y2="12" stroke-width="1"/>' +
    '<line x1="10" y1="8" x2="10" y2="12" stroke-width="1"/>' +
    '<line x1="14" y1="8" x2="14" y2="12" stroke-width="1"/>' +
    '<line x1="18" y1="8" x2="18" y2="12" stroke-width="1"/>'
  ),

  lower_level: S(
    '<line x1="2" y1="8" x2="22" y2="8" stroke-dasharray="3 2"/>' +
    '<line x1="2" y1="16" x2="22" y2="16" stroke-dasharray="3 2"/>'
  ),

  pillar: M(
    '<path d="M8 7Q12 5 16 7Q18 10 17 14Q14 18 10 17Q6 15 7 11Q6 8 8 7Z" fill="currentColor" stroke="currentColor" stroke-width="1.5"/>'
  ),

  ledge: S(
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<line x1="5" y1="12" x2="5" y2="17" stroke-width="1"/>' +
    '<line x1="9" y1="12" x2="9" y2="17" stroke-width="1"/>' +
    '<line x1="13" y1="12" x2="13" y2="17" stroke-width="1"/>' +
    '<line x1="17" y1="12" x2="17" y2="17" stroke-width="1"/>'
  ),

  ceiling_ledge: S(
    '<line x1="2" y1="14" x2="22" y2="14"/>' +
    '<line x1="5" y1="14" x2="5" y2="9" stroke-width="1"/>' +
    '<line x1="9" y1="14" x2="9" y2="9" stroke-width="1"/>' +
    '<line x1="13" y1="14" x2="13" y2="9" stroke-width="1"/>' +
    '<line x1="17" y1="14" x2="17" y2="9" stroke-width="1"/>'
  ),

  pit: S(
    '<circle cx="12" cy="12" r="8"/>' +
    '<line x1="12" y1="4" x2="12" y2="7" stroke-width="1"/>' +
    '<line x1="12" y1="20" x2="12" y2="17" stroke-width="1"/>' +
    '<line x1="4" y1="12" x2="7" y2="12" stroke-width="1"/>' +
    '<line x1="20" y1="12" x2="17" y2="12" stroke-width="1"/>' +
    '<line x1="6.3" y1="6.3" x2="8.4" y2="8.4" stroke-width="1"/>' +
    '<line x1="17.7" y1="6.3" x2="15.6" y2="8.4" stroke-width="1"/>' +
    '<line x1="6.3" y1="17.7" x2="8.4" y2="15.6" stroke-width="1"/>' +
    '<line x1="17.7" y1="17.7" x2="15.6" y2="15.6" stroke-width="1"/>'
  ),

  dome: S(
    '<circle cx="12" cy="12" r="8"/>' +
    '<line x1="12" y1="4" x2="12" y2="1" stroke-width="1"/>' +
    '<line x1="12" y1="20" x2="12" y2="23" stroke-width="1"/>' +
    '<line x1="4" y1="12" x2="1" y2="12" stroke-width="1"/>' +
    '<line x1="20" y1="12" x2="23" y2="12" stroke-width="1"/>'
  ),

  natural_bridge: S(
    '<path d="M4 18V12Q4 4 12 4Q20 4 20 12V18"/>' +
    '<line x1="2" y1="18" x2="22" y2="18"/>'
  ),

  slope: S(
    '<path d="M6 6L12 12L6 18"/>' +
    '<path d="M12 6L18 12L12 18"/>'
  ),

  entrance_dripline: S(
    '<path d="M4 18Q12 2 20 18" stroke-dasharray="2 3"/>'
  ),

  breakdown_wall: S(
    '<path d="M2 14L5 10L8 15L11 8L14 14L17 9L20 13L22 10"/>'
  ),

  ceiling_channel: S(
    '<path d="M2 9Q7 6 12 9Q17 12 22 9" stroke-dasharray="3 2"/>' +
    '<path d="M2 15Q7 12 12 15Q17 18 22 15" stroke-dasharray="3 2"/>'
  ),

  narrow_ceiling_channel: S(
    '<path d="M2 10Q7 8 12 10Q17 12 22 10" stroke-dasharray="2 2" stroke-width="1"/>' +
    '<path d="M2 14Q7 12 12 14Q17 16 22 14" stroke-dasharray="2 2" stroke-width="1"/>'
  ),

  // ── SPELEOTHEMS ───────────────────────────────────────────

  flowstone: S(
    '<path d="M2 14Q5 8 8 14Q11 8 14 14Q17 8 22 14"/>' +
    '<path d="M4 19Q7 13 10 19Q13 13 16 19Q19 13 20 19"/>'
  ),

  stalactites: M(
    '<line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
    '<path d="M5 5L7 14L9 5" fill="currentColor" stroke="none"/>' +
    '<path d="M11 5L13 16L15 5" fill="currentColor" stroke="none"/>' +
    '<path d="M16 5L18 12L20 5" fill="currentColor" stroke="none"/>'
  ),

  stalagmites: M(
    '<line x1="2" y1="19" x2="22" y2="19" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
    '<path d="M5 19L7 10L9 19" fill="currentColor" stroke="none"/>' +
    '<path d="M11 19L13 8L15 19" fill="currentColor" stroke="none"/>' +
    '<path d="M16 19L18 12L20 19" fill="currentColor" stroke="none"/>'
  ),

  stalagmites_large: M(
    '<line x1="2" y1="20" x2="22" y2="20" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
    '<path d="M4 20L8 4L12 20" fill="currentColor" stroke="none"/>' +
    '<path d="M13 20L17 6L21 20" fill="currentColor" stroke="none"/>'
  ),

  columns: F(
    '<circle cx="8" cy="12" r="4"/>' +
    '<circle cx="17" cy="12" r="3"/>'
  ),

  columns_large: F(
    '<circle cx="12" cy="12" r="7"/>'
  ),

  soda_straws: S(
    '<line x1="6" y1="3" x2="6" y2="17"/>' +
    '<line x1="10" y1="3" x2="10" y2="19"/>' +
    '<line x1="14" y1="3" x2="14" y2="15"/>' +
    '<line x1="18" y1="3" x2="18" y2="18"/>' +
    '<circle cx="6" cy="18" r="1" fill="currentColor"/>' +
    '<circle cx="10" cy="20" r="1" fill="currentColor"/>' +
    '<circle cx="14" cy="16" r="1" fill="currentColor"/>' +
    '<circle cx="18" cy="19" r="1" fill="currentColor"/>'
  ),

  helictites: S(
    '<path d="M4 14Q6 8 9 11Q11 14 10 18"/>' +
    '<path d="M10 12Q13 8 15 11Q17 14 15 18"/>' +
    '<path d="M15 10Q18 6 20 10Q21 14 19 17"/>'
  ),

  rimstone: S(
    '<path d="M2 8Q6 4 10 8Q14 4 18 8Q21 4 22 8"/>' +
    '<path d="M2 14Q6 10 10 14Q14 10 18 14Q21 10 22 14"/>' +
    '<path d="M4 20Q8 16 12 20Q16 16 20 20"/>'
  ),

  crystals: S(
    '<line x1="7" y1="4" x2="7" y2="14" stroke-width="1.2"/>' +
    '<line x1="2" y1="9" x2="12" y2="9" stroke-width="1.2"/>' +
    '<line x1="3.5" y1="5" x2="10.5" y2="13" stroke-width="1.2"/>' +
    '<line x1="3.5" y1="13" x2="10.5" y2="5" stroke-width="1.2"/>' +
    '<line x1="17" y1="10" x2="17" y2="20" stroke-width="1.2"/>' +
    '<line x1="12" y1="15" x2="22" y2="15" stroke-width="1.2"/>' +
    '<line x1="13.5" y1="11" x2="20.5" y2="19" stroke-width="1.2"/>' +
    '<line x1="13.5" y1="19" x2="20.5" y2="11" stroke-width="1.2"/>'
  ),

  popcorn: F(
    '<circle cx="5" cy="6" r="1.5"/><circle cx="10" cy="4" r="1.2"/>' +
    '<circle cx="15" cy="7" r="1.8"/><circle cx="19" cy="5" r="1.3"/>' +
    '<circle cx="4" cy="12" r="1.4"/><circle cx="9" cy="11" r="1.6"/>' +
    '<circle cx="14" cy="13" r="1.2"/><circle cx="20" cy="12" r="1.5"/>' +
    '<circle cx="6" cy="18" r="1.3"/><circle cx="12" cy="19" r="1.5"/>' +
    '<circle cx="17" cy="17" r="1.4"/>'
  ),

  calcite_rafts: S(
    '<path d="M3 8Q7 6 11 8Q15 10 19 8" stroke-width="1"/>' +
    '<path d="M5 12Q9 10 13 12Q17 14 21 12" stroke-width="1"/>' +
    '<path d="M3 16Q7 14 11 16Q15 18 19 16" stroke-width="1"/>'
  ),

  calcite_spar: F(
    '<path d="M6 8L9 4L12 8L9 12Z"/>' +
    '<path d="M14 14L17 10L20 14L17 18Z"/>' +
    '<path d="M4 16L6 13L8 16L6 19Z"/>'
  ),

  anthodites: S(
    '<line x1="12" y1="12" x2="12" y2="2"/>' +
    '<line x1="12" y1="12" x2="12" y2="22"/>' +
    '<line x1="12" y1="12" x2="2" y2="12"/>' +
    '<line x1="12" y1="12" x2="22" y2="12"/>' +
    '<line x1="12" y1="12" x2="5" y2="5" stroke-width="1.2"/>' +
    '<line x1="12" y1="12" x2="19" y2="5" stroke-width="1.2"/>' +
    '<line x1="12" y1="12" x2="5" y2="19" stroke-width="1.2"/>' +
    '<line x1="12" y1="12" x2="19" y2="19" stroke-width="1.2"/>' +
    '<line x1="12" y1="12" x2="3" y2="8" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="21" y2="8" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="8" y2="21" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="16" y2="3" stroke-width="1"/>'
  ),

  gypsum_flowers: S(
    '<path d="M12 12Q8 6 4 9"/>' +
    '<path d="M12 12Q16 6 20 9"/>' +
    '<path d="M12 12Q6 16 4 20"/>' +
    '<path d="M12 12Q18 16 20 20"/>' +
    '<path d="M12 12Q10 5 12 2"/>' +
    '<path d="M12 12Q14 19 12 22"/>'
  ),

  aragonite: S(
    '<path d="M4 20L12 4L20 20"/>' +
    '<path d="M8 12L4 8" stroke-width="1"/>' +
    '<path d="M16 12L20 8" stroke-width="1"/>' +
    '<path d="M10 8L7 4" stroke-width="1"/>' +
    '<path d="M14 8L17 4" stroke-width="1"/>' +
    '<path d="M6 16L3 14" stroke-width="1"/>' +
    '<path d="M18 16L21 14" stroke-width="1"/>'
  ),

  shield: S(
    '<path d="M6 18Q6 4 18 4Q18 18 6 18Z"/>' +
    '<line x1="12" y1="18" x2="12" y2="22"/>'
  ),

  gypsum_chandelier: S(
    '<line x1="12" y1="2" x2="12" y2="8"/>' +
    '<path d="M5 8H19"/>' +
    '<path d="M5 8Q3 14 5 20"/>' +
    '<path d="M19 8Q21 14 19 20"/>' +
    '<line x1="12" y1="8" x2="12" y2="22"/>' +
    '<path d="M8 8Q7 13 8 18" stroke-width="1"/>' +
    '<path d="M16 8Q17 13 16 18" stroke-width="1"/>'
  ),

  pool_spar: M(
    '<path d="M2 14Q7 12 12 14Q17 12 22 14" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M5 14L7 7L9 14" fill="currentColor" stroke="none"/>' +
    '<path d="M13 14L15 5L17 14" fill="currentColor" stroke="none"/>'
  ),

  boxwork: S(
    '<line x1="2" y1="5" x2="22" y2="5" stroke-width="1"/>' +
    '<line x1="2" y1="12" x2="22" y2="12" stroke-width="1"/>' +
    '<line x1="2" y1="19" x2="22" y2="19" stroke-width="1"/>' +
    '<line x1="5" y1="2" x2="5" y2="22" stroke-width="1"/>' +
    '<line x1="12" y1="2" x2="12" y2="22" stroke-width="1"/>' +
    '<line x1="19" y1="2" x2="19" y2="22" stroke-width="1"/>'
  ),

  draperies: S(
    '<path d="M5 3Q3 10 5 17Q7 22 5 22"/>' +
    '<path d="M10 3Q8 12 10 18Q12 22 10 22"/>' +
    '<path d="M15 3Q13 10 15 17Q17 22 15 22"/>' +
    '<path d="M20 3Q18 12 20 18Q22 22 20 22"/>'
  ),

  moonmilk: M(
    '<path d="M4 16Q4 10 8 8Q10 6 14 8Q18 6 20 10Q22 14 18 16Z" fill="currentColor" stroke="currentColor" stroke-width="1" opacity="0.5"/>'
  ),

  cave_pearls: F(
    '<circle cx="8" cy="10" r="2.5"/><circle cx="14" cy="8" r="2"/>' +
    '<circle cx="12" cy="14" r="2.5"/><circle cx="6" cy="16" r="2"/>' +
    '<circle cx="17" cy="14" r="2.2"/>'
  ),

  gypsum_needles: S(
    '<line x1="12" y1="12" x2="12" y2="1" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="22" y2="5" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="23" y2="12" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="22" y2="19" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="12" y2="23" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="2" y2="19" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="1" y2="12" stroke-width="1"/>' +
    '<line x1="12" y1="12" x2="2" y2="5" stroke-width="1"/>'
  ),

  // ── SPELEOCLASTS ──────────────────────────────────────────

  breakdown: S(
    '<path d="M3 10L7 6L11 9L8 14Z"/>' +
    '<path d="M12 5L17 4L19 8L15 10Z"/>' +
    '<path d="M10 14L15 12L18 16L13 18Z"/>' +
    '<path d="M4 16L8 18L6 21Z"/>'
  ),

  small_rocks: F(
    '<path d="M4 8L7 6L9 9L6 10Z"/><path d="M12 5L15 4L16 7L13 8Z"/>' +
    '<path d="M18 8L21 7L22 10L19 11Z"/><path d="M3 14L6 13L7 16L4 16Z"/>' +
    '<path d="M10 13L13 12L14 15L11 15Z"/><path d="M16 14L19 13L20 16L17 16Z"/>' +
    '<path d="M6 18L9 17L10 20L7 20Z"/><path d="M14 18L17 17L18 20L15 20Z"/>'
  ),

  sediment_floor: F(
    '<circle cx="3" cy="5" r=".8"/><circle cx="8" cy="4" r=".8"/>' +
    '<circle cx="14" cy="6" r=".8"/><circle cx="19" cy="4" r=".8"/>' +
    '<circle cx="5" cy="9" r=".8"/><circle cx="11" cy="10" r=".8"/>' +
    '<circle cx="16" cy="8" r=".8"/><circle cx="21" cy="10" r=".8"/>' +
    '<circle cx="3" cy="14" r=".8"/><circle cx="9" cy="15" r=".8"/>' +
    '<circle cx="13" cy="13" r=".8"/><circle cx="18" cy="14" r=".8"/>' +
    '<circle cx="6" cy="19" r=".8"/><circle cx="11" cy="18" r=".8"/>' +
    '<circle cx="16" cy="20" r=".8"/><circle cx="20" cy="18" r=".8"/>'
  ),

  mud_clay: S(
    '<line x1="3" y1="5" x2="8" y2="5" stroke-width="1"/>' +
    '<line x1="13" y1="5" x2="18" y2="5" stroke-width="1"/>' +
    '<line x1="6" y1="9" x2="11" y2="9" stroke-width="1"/>' +
    '<line x1="15" y1="9" x2="20" y2="9" stroke-width="1"/>' +
    '<line x1="3" y1="13" x2="8" y2="13" stroke-width="1"/>' +
    '<line x1="13" y1="13" x2="18" y2="13" stroke-width="1"/>' +
    '<line x1="6" y1="17" x2="11" y2="17" stroke-width="1"/>' +
    '<line x1="15" y1="17" x2="20" y2="17" stroke-width="1"/>'
  ),

  gravel: F(
    '<circle cx="5" cy="6" r="1.5"/><circle cx="12" cy="5" r="1.8"/>' +
    '<circle cx="19" cy="7" r="1.5"/><circle cx="4" cy="13" r="1.6"/>' +
    '<circle cx="11" cy="12" r="1.5"/><circle cx="18" cy="13" r="1.7"/>' +
    '<circle cx="7" cy="19" r="1.5"/><circle cx="15" cy="18" r="1.6"/>'
  ),

  bedrock_floor: S(
    '<line x1="6" y1="4" x2="6" y2="10" stroke-width="1"/>' +
    '<line x1="3" y1="7" x2="9" y2="7" stroke-width="1"/>' +
    '<line x1="16" y1="4" x2="16" y2="10" stroke-width="1"/>' +
    '<line x1="13" y1="7" x2="19" y2="7" stroke-width="1"/>' +
    '<line x1="11" y1="14" x2="11" y2="20" stroke-width="1"/>' +
    '<line x1="8" y1="17" x2="14" y2="17" stroke-width="1"/>'
  ),

  corrosion_residue: S(
    '<path d="M4 4L8 8M8 4L4 8"/>' +
    '<path d="M14 4L18 8M18 4L14 8"/>' +
    '<path d="M9 12L13 16M13 12L9 16"/>' +
    '<path d="M4 16L8 20M8 16L4 20"/>' +
    '<path d="M16 15L20 19M20 15L16 19"/>'
  ),

  mud_cracks: S(
    '<path d="M2 2L10 4L12 12L4 10Z"/>' +
    '<path d="M10 4L22 2L22 10L12 12Z"/>' +
    '<path d="M4 10L12 12L10 22L2 20Z"/>' +
    '<path d="M12 12L22 10L20 22L10 22Z"/>'
  ),

  calcite_crust: S(
    '<path d="M2 7Q7 4 12 7Q17 10 22 7"/>' +
    '<path d="M2 12Q7 9 12 12Q17 15 22 12"/>' +
    '<path d="M2 17Q7 14 12 17Q17 20 22 17"/>'
  ),

  // ── HYDROLOGY ─────────────────────────────────────────────

  pools: S(
    '<path d="M2 8Q7 5 12 8Q17 11 22 8"/>' +
    '<path d="M2 13Q7 10 12 13Q17 16 22 13"/>' +
    '<path d="M2 18Q7 15 12 18Q17 21 22 18"/>'
  ),

  pool_with_sump: M(
    '<path d="M2 6Q7 3 12 6Q17 9 22 6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M2 11Q7 8 12 11Q17 14 22 11" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<line x1="12" y1="13" x2="12" y2="21" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M9 18L12 21L15 18" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  ),

  flowing_water: M(
    '<path d="M2 8Q7 5 12 8Q17 11 20 8" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M2 14Q7 11 12 14Q17 17 20 14" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M18 6L22 11L18 16" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  ),

  ephemeral_stream: S(
    '<path d="M2 8Q7 5 12 8Q17 11 22 8" stroke-dasharray="3 2"/>' +
    '<path d="M2 14Q7 11 12 14Q17 17 22 14" stroke-dasharray="3 2"/>'
  ),

  waterfall: S(
    '<path d="M6 2Q4 7 6 12Q8 17 6 22"/>' +
    '<path d="M12 2Q10 7 12 12Q14 17 12 22"/>' +
    '<path d="M18 2Q16 7 18 12Q20 17 18 22"/>'
  ),

  // ── CROSS SECTION ─────────────────────────────────────────

  leader_lines: S(
    '<line x1="4" y1="12" x2="18" y2="12"/>' +
    '<path d="M16 9L20 12L16 15"/>' +
    '<circle cx="4" cy="12" r="1.5" fill="currentColor"/>'
  ),

  bedrock_limestone: S(
    '<rect x="2" y="2" width="20" height="20"/>' +
    '<line x1="2" y1="8" x2="22" y2="8" stroke-width="1"/>' +
    '<line x1="2" y1="14" x2="22" y2="14" stroke-width="1"/>' +
    '<line x1="12" y1="2" x2="12" y2="8" stroke-width="1"/>' +
    '<line x1="7" y1="8" x2="7" y2="14" stroke-width="1"/>' +
    '<line x1="17" y1="8" x2="17" y2="14" stroke-width="1"/>' +
    '<line x1="12" y1="14" x2="12" y2="22" stroke-width="1"/>'
  ),

  // ── GEOLOGY ───────────────────────────────────────────────

  strike_and_dip: S(
    '<line x1="4" y1="12" x2="20" y2="12"/>' +
    '<line x1="12" y1="12" x2="12" y2="20"/>'
  ),

  fault: S(
    '<line x1="2" y1="10" x2="10" y2="10"/>' +
    '<path d="M10 10L14 14"/>' +
    '<line x1="14" y1="14" x2="22" y2="14"/>'
  ),

  airflow: M(
    '<circle cx="6" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<line x1="10" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M17 9L20 12L17 15" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  ),

  // ── TEXT / MARKERS ────────────────────────────────────────

  passage_height: M(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<text x="12" y="16" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">H</text>'
  ),

  pit_depth: M(
    '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<text x="12" y="16" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">D</text>'
  ),

  lead: M(
    '<text x="12" y="20" text-anchor="middle" font-size="22" font-weight="bold" fill="currentColor" stroke="none" font-family="serif">?</text>'
  ),

  too_tight: M(
    '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">TT</text>'
  ),

  survey_station: M(
    '<path d="M12 4L20 20H4Z" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  ),

  // ── BIOLOGY ───────────────────────────────────────────────

  guano: M(
    '<path d="M4 18Q8 10 12 14Q14 8 18 12Q20 10 20 18Z" fill="currentColor" stroke="currentColor" stroke-width="1"/>'
  ),

  bones: M(
    '<path d="M5 5L19 19" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M19 5L5 19" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="5" cy="5" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="5" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="5" cy="19" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="19" r="2" fill="currentColor" stroke="none"/>'
  ),

  organic_debris: S(
    '<path d="M5 5L9 9M9 5L5 9" stroke-width="1.2"/>' +
    '<path d="M15 5L19 9M19 5L15 9" stroke-width="1.2"/>' +
    '<path d="M10 12L14 16M14 12L10 16" stroke-width="1.2"/>' +
    '<path d="M5 17L9 21M9 17L5 21" stroke-width="1.2"/>' +
    '<path d="M15 17L19 21M19 17L15 21" stroke-width="1.2"/>'
  ),

  // ── PROFILE ───────────────────────────────────────────────

  rigging: S(
    '<line x1="12" y1="2" x2="12" y2="22"/>' +
    '<line x1="8" y1="6" x2="12" y2="6" stroke-width="1"/>' +
    '<line x1="8" y1="10" x2="12" y2="10" stroke-width="1"/>' +
    '<line x1="8" y1="14" x2="12" y2="14" stroke-width="1"/>' +
    '<line x1="8" y1="18" x2="12" y2="18" stroke-width="1"/>'
  ),

  formations_profile: S(
    '<line x1="2" y1="4" x2="22" y2="4"/>' +
    '<path d="M6 4L7 10L8 4" stroke-width="1"/>' +
    '<path d="M12 4L13 12L14 4" stroke-width="1"/>' +
    '<path d="M18 4L19 8L20 4" stroke-width="1"/>' +
    '<line x1="2" y1="20" x2="22" y2="20"/>' +
    '<path d="M8 20L9 14L10 20" stroke-width="1"/>' +
    '<path d="M15 20L16 16L17 20" stroke-width="1"/>'
  ),

  // ── TERMINATIONS ──────────────────────────────────────────

  sediment_termination: F(
    '<circle cx="4" cy="12" r="1.5"/><circle cx="8" cy="10" r="1.3"/>' +
    '<circle cx="8" cy="14" r="1.3"/><circle cx="12" cy="11" r="1"/>' +
    '<circle cx="12" cy="13" r="1"/><circle cx="15" cy="12" r=".8"/>' +
    '<circle cx="18" cy="12" r=".5"/>'
  ),

  breakdown_termination: F(
    '<path d="M3 8L7 6L9 10L5 11Z"/>' +
    '<path d="M8 12L11 10L13 13L10 14Z"/>' +
    '<path d="M13 11L15 10L16 12L14 13Z" opacity=".7"/>' +
    '<path d="M16 11L17 10.5L17.5 11.5L16.5 12Z" opacity=".4"/>'
  ),

  flowstone_termination: S(
    '<path d="M2 10Q5 6 8 10Q11 6 14 10" stroke-width="1.2"/>' +
    '<path d="M6 14Q8 11 10 14Q12 11 14 14" stroke-width="1" opacity=".7"/>' +
    '<path d="M8 18Q10 16 12 18" stroke-width=".8" opacity=".4"/>'
  ),

  pools_termination: S(
    '<path d="M2 8Q6 5 10 8Q14 11 18 8" stroke-width="1.2"/>' +
    '<path d="M4 13Q8 10 12 13Q14 15 16 13" stroke-width="1" opacity=".7"/>' +
    '<path d="M6 18Q9 16 12 18" stroke-width=".8" opacity=".4"/>'
  ),

  natural_bridge_termination: S(
    '<path d="M4 18V14Q4 6 12 6Q20 6 20 14V18"/>'
  ),
}


// ═══════════════════════════════════════════════════════════════
//  KEYWORD → SYMBOL MAPPING
// ═══════════════════════════════════════════════════════════════

// Each entry: symbol key → array of keyword triggers (matched case-insensitive)
const KEYWORD_TRIGGERS = {
  // Passages
  pillar:             ['pillar'],
  ledge:              ['ledge'],
  pit:                ['pit', 'vertical shaft'],
  dome:               ['dome'],
  natural_bridge:     ['natural bridge', 'bridge'],
  slope:              ['slope', 'incline', 'ramp'],

  // Speleothems
  flowstone:          ['flowstone', 'flow stone', 'flowstn'],
  stalactites:        ['stalactite', 'stals', 'ceiling formation'],
  stalagmites:        ['stalagmite', 'mite', 'floor formation'],
  columns:            ['column', 'col '],
  soda_straws:        ['soda straw', 'straw'],
  helictites:         ['helictite', 'helic'],
  rimstone:           ['rimstone', 'rim stone', 'rimdam', 'rim dam'],
  crystals:           ['crystal', 'xtal'],
  popcorn:            ['popcorn', 'pop corn', 'coralloid'],
  calcite_rafts:      ['calcite raft', 'raft'],
  calcite_spar:       ['calcite spar', 'spar'],
  anthodites:         ['anthodite'],
  gypsum_flowers:     ['gypsum flower', 'gyp flower'],
  aragonite:          ['aragonite', 'frostwork', 'frost work'],
  shield:             ['shield', 'palette'],
  gypsum_chandelier:  ['chandelier'],
  pool_spar:          ['pool spar'],
  boxwork:            ['boxwork', 'box work'],
  draperies:          ['drapery', 'draperies', 'drape', 'curtain', 'bacon'],
  moonmilk:           ['moonmilk', 'moon milk', 'mondmilch'],
  cave_pearls:        ['cave pearl', 'pearl'],
  gypsum_needles:     ['gypsum needle', 'needle'],

  // Speleoclasts
  breakdown:          ['breakdown', 'collapse', 'rubble'],
  small_rocks:        ['small rock', 'cobble'],
  sediment_floor:     ['sediment', 'silt'],
  mud_clay:           ['mud', 'clay'],
  gravel:             ['gravel'],
  bedrock_floor:      ['bedrock'],
  corrosion_residue:  ['corrosion', 'residue'],
  mud_cracks:         ['mud crack', 'desiccation'],
  calcite_crust:      ['calcite crust', 'crust'],

  // Hydrology
  pools:              ['pool', 'standing water', 'lake'],
  pool_with_sump:     ['sump'],
  flowing_water:      ['flowing water', 'stream', 'river', 'creek'],
  ephemeral_stream:   ['ephemeral', 'seasonal stream', 'intermittent'],
  waterfall:          ['waterfall', 'cascade'],

  // Geology
  fault:              ['fault'],
  airflow:            ['airflow', 'air flow', 'breeze', 'wind', 'draft', 'draught'],

  // Text/Markers
  lead:               ['lead', 'unexplored', 'continues'],
  too_tight:          ['too tight', 'impassable', 'squeeze'],
  survey_station:     ['station'],

  // Biology
  guano:              ['guano', 'bat droppings'],
  bones:              ['bone', 'skeleton', 'fossil'],
  organic_debris:     ['organic', 'debris', 'roots', 'wood'],
}

/**
 * Find all matching symbol keys for a shot comment.
 * Returns array of symbol keys (may be empty).
 */
export function matchSymbols(comment) {
  if (!comment) return []
  const lower = comment.toLowerCase().trim()
  if (!lower) return []
  const matches = []
  for (const [symbolKey, keywords] of Object.entries(KEYWORD_TRIGGERS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matches.push(symbolKey)
        break // only match each symbol once
      }
    }
  }
  return matches
}

/**
 * Get the SVG string for a symbol key.
 */
export function getSymbol(key) {
  return SYMBOLS[key] || null
}

/**
 * Replace currentColor in an SVG string with a specific color.
 */
export function colorize(svgString, color) {
  return svgString.replace(/currentColor/g, color)
}

/**
 * Convert an SVG string to a data URL (for Canvas drawImage or Leaflet icon).
 */
export function symbolToDataURL(svgString, color) {
  const colored = color ? colorize(svgString, color) : svgString
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(colored)
}

/**
 * Symbol categories for legend display.
 */
export const SYMBOL_CATEGORIES = {
  'Passages': [
    'passage_walls', 'lower_level', 'pillar', 'ledge', 'ceiling_ledge',
    'pit', 'dome', 'natural_bridge', 'slope', 'entrance_dripline',
    'breakdown_wall', 'ceiling_channel', 'narrow_ceiling_channel',
  ],
  'Speleothems': [
    'flowstone', 'stalactites', 'stalagmites', 'stalagmites_large',
    'columns', 'columns_large', 'soda_straws', 'helictites', 'rimstone',
    'crystals', 'popcorn', 'calcite_rafts', 'calcite_spar', 'anthodites',
    'gypsum_flowers', 'aragonite', 'shield', 'gypsum_chandelier',
    'pool_spar', 'boxwork', 'draperies', 'moonmilk', 'cave_pearls',
    'gypsum_needles',
  ],
  'Speleoclasts': [
    'breakdown', 'small_rocks', 'sediment_floor', 'mud_clay', 'gravel',
    'bedrock_floor', 'corrosion_residue', 'mud_cracks', 'calcite_crust',
  ],
  'Hydrology': [
    'pools', 'pool_with_sump', 'flowing_water', 'ephemeral_stream', 'waterfall',
  ],
  'Cross Section': ['leader_lines', 'bedrock_limestone'],
  'Geology': ['strike_and_dip', 'fault', 'airflow'],
  'Text': ['passage_height', 'pit_depth', 'lead', 'too_tight', 'survey_station'],
  'Biology': ['guano', 'bones', 'organic_debris'],
  'Profile': ['rigging', 'formations_profile'],
  'Terminations': [
    'sediment_termination', 'breakdown_termination',
    'flowstone_termination', 'pools_termination', 'natural_bridge_termination',
  ],
}

/**
 * Human-readable label for a symbol key.
 */
export function symbolLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
