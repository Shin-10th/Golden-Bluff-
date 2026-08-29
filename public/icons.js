// Golden Bluff - hand-drawn SVG icons for each Character.
// Single-tone (fill="currentColor") so CSS color/theming controls the tint;
// "cutout" details use var(--panel-2) to match the surrounding card interior.
const CHAR_ICON_SVG = {
  ROYAL: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8,46 L8,52 L56,52 L56,46 L50,22 L40,36 L32,16 L24,36 L14,22 Z" fill="currentColor"/>
    <circle cx="14" cy="22" r="3.4" fill="currentColor"/>
    <circle cx="32" cy="16" r="3.8" fill="currentColor"/>
    <circle cx="50" cy="22" r="3.4" fill="currentColor"/>
  </svg>`,

  THIEF: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32,6 C46,6 54,20 54,34 L54,49 C54,53 50,55 46,53 C40,57 24,57 18,53 C14,55 10,53 10,49 L10,34 C10,20 18,6 32,6 Z" fill="currentColor"/>
    <ellipse cx="24" cy="30" rx="3.4" ry="4.4" fill="var(--panel-2)"/>
    <ellipse cx="40" cy="30" rx="3.4" ry="4.4" fill="var(--panel-2)"/>
  </svg>`,

  GUARD: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32,5 L55,13 L55,31 C55,46 45,56 32,60 C19,56 9,46 9,31 L9,13 Z" fill="currentColor"/>
    <path d="M32,15 L32,50 M19,26 L45,26" stroke="var(--panel-2)" stroke-width="4.5" fill="none"/>
  </svg>`,

  SEER: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="32" y1="6" x2="32" y2="13" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="13" y1="13" x2="18" y2="18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="51" y1="13" x2="46" y2="18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M4,34 C15,17 49,17 60,34 C49,51 15,51 4,34 Z" fill="currentColor"/>
    <circle cx="32" cy="34" r="8.5" fill="var(--panel-2)"/>
    <circle cx="32" cy="34" r="3.6" fill="currentColor"/>
  </svg>`,

  TRICKSTER: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12,20 C12,9 21,3 32,3 C43,3 52,9 52,20 L52,38 C52,50 43,59 32,59 C21,59 12,50 12,38 Z" fill="currentColor"/>
    <circle cx="22.5" cy="26" r="3.6" fill="var(--panel-2)"/>
    <circle cx="41.5" cy="26" r="3.6" fill="var(--panel-2)"/>
    <path d="M17,39 C23,48 41,48 47,39" stroke="var(--panel-2)" stroke-width="4.2" fill="none" stroke-linecap="round"/>
  </svg>`,

  ASSASSIN: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.5,3 L34.5,3 L34.5,35 L29.5,35 Z" fill="currentColor"/>
    <path d="M16,35 L48,35 L48,41.5 L16,41.5 Z" fill="currentColor"/>
    <path d="M32,41.5 L41,53 L32,61 L23,53 Z" fill="currentColor"/>
  </svg>`,
};

function charIconHTML(key) {
  return CHAR_ICON_SVG[key] || '';
}
