/**
 * Simple text-based CAPTCHA generator
 * Generates a distorted text image using Canvas (or fallback text)
 */

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Generate CAPTCHA as a simple SVG image (no canvas dep needed)
 * Returns { code, svgBuffer }
 */
function generateCaptcha() {
  const code = generateCode(5);
  const width = 200;
  const height = 70;

  // Random noise lines
  const lines = Array.from({ length: 6 }, () => ({
    x1: Math.random() * width,
    y1: Math.random() * height,
    x2: Math.random() * width,
    y2: Math.random() * height,
    color: `hsl(${Math.random() * 360},60%,50%)`,
  }));

  // Random dots
  const dots = Array.from({ length: 30 }, () => ({
    cx: Math.random() * width,
    cy: Math.random() * height,
    r: Math.random() * 2 + 1,
    color: `hsl(${Math.random() * 360},60%,60%)`,
  }));

  const letters = code.split('').map((char, i) => ({
    char,
    x: 20 + i * 34 + (Math.random() * 8 - 4),
    y: 48 + (Math.random() * 10 - 5),
    rotate: Math.random() * 30 - 15,
    size: 28 + Math.random() * 8,
    color: `hsl(${Math.random() * 360},70%,30%)`,
  }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:#f5f0e8">
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feBlend in="SourceGraphic" mode="overlay" result="blend"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#noise)" opacity="0.15"/>
    ${lines.map(l => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.color}" stroke-width="1.5" opacity="0.6"/>`).join('')}
    ${dots.map(d => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${d.color}" opacity="0.5"/>`).join('')}
    ${letters.map(l => `<text x="${l.x}" y="${l.y}" font-size="${l.size}" font-family="monospace" font-weight="bold" fill="${l.color}" transform="rotate(${l.rotate},${l.x},${l.y})">${l.char}</text>`).join('')}
  </svg>`;

  return {
    code,
    svgBuffer: Buffer.from(svg),
  };
}

module.exports = { generateCaptcha };
