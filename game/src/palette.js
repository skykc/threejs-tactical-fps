// The look plan for Depot 9, in one place. One dusk-industrial palette: cold slate
// surfaces, warm amber floodlights, rust containers, teal site markers. Every colour
// the game draws comes from these names; the same names are the CSS custom properties
// in index.html, so the HUD and the 3D scene never disagree about the look.
export const PALETTE = {
  canvas: '#15181d', // night sky / clear colour
  surface: '#23282f', // concrete floor and walls
  hairline: '#343c46', // crates, trim, dark metal
  ink: '#ece7db', // warm off-white: HUD text, tracer, light
  muted: '#8b939c', // secondary text, distant metal
  accent: '#ffb02e', // amber: floodlights, site A, muzzle flash
  rust: '#c65a28', // containers, attacker vests
  teal: '#2fa8a0', // site B, defender vests
  sand: '#b09a6a', // wooden crates
};

export function shade(name) {
  return PALETTE[name];
}
