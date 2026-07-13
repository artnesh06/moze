const Jimp = require('jimp');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Generate CAPTCHA as PNG buffer using Jimp
 * Returns { code, pngBuffer }
 */
async function generateCaptcha() {
  const code = generateCode(5);
  const width = 200;
  const height = 70;

  // Create white background image
  const image = new Jimp(width, height, 0xf5f0e8ff);

  // Load a font
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

  // Add noise lines (draw random pixels)
  for (let i = 0; i < 800; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const color = Jimp.rgbaToInt(
      Math.floor(Math.random() * 200),
      Math.floor(Math.random() * 200),
      Math.floor(Math.random() * 200),
      180
    );
    image.setPixelColor(color, x, y);
  }

  // Draw each character with slight offset
  let x = 10;
  for (const char of code) {
    const offsetY = Math.floor(Math.random() * 15);
    image.print(font, x, 15 + offsetY, char);
    x += 36 + Math.floor(Math.random() * 4 - 2);
  }

  // Add more noise on top
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    image.setPixelColor(Jimp.rgbaToInt(100, 100, 100, 100), x, y);
  }

  const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
  return { code, pngBuffer };
}

module.exports = { generateCaptcha };
