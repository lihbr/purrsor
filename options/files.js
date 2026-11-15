// Purrsor - turning uploaded files into cursors and click sounds.

// Chromium ignores cursor images over 128px, so pictures are stored at most
// this large and the Size choice only ever shrinks them.
const MAX_CURSOR_SIZE = 112;
const MAX_SOUND_BYTES = 1_000_000;
const MAX_SOUND_SECONDS = 3;

class FileProblem extends Error {}

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

// Draws the image scaled down to fit a size × size box, never up.
function drawFit(image, size) {
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

// An uploaded picture as a PNG data URL no larger than MAX_CURSOR_SIZE.
async function readPicture(file) {
  if (!file.type.startsWith('image/')) {
    throw new FileProblem(`${file.name} isn't a picture. Choose a PNG, JPEG, GIF, WebP or SVG.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url).catch(() => {
      throw new FileProblem(`${file.name} couldn't be opened as a picture.`);
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new FileProblem(`${file.name} has no size. SVGs need a width and height.`);
    }
    return drawFit(image, MAX_CURSOR_SIZE).src;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A CSS cursor value for one picture: full size, then half size for near
// the window's edges, where Chromium drops cursors that don't fit, then the
// system arrow.
async function cursorValue(src, hotspot, size) {
  const image = await loadImage(src);
  const parts = [size, size / 2].map((box) => {
    const drawn = drawFit(image, box);
    const x = Math.min(drawn.width - 1, Math.round(hotspot.x * drawn.width));
    const y = Math.min(drawn.height - 1, Math.round(hotspot.y * drawn.height));
    return `url('${drawn.src}') ${x} ${y}`;
  });
  return `${parts.join(', ')}, auto`;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// An uploaded sound, checked to play and to be short enough for every click.
async function readSound(file) {
  if (file.size > MAX_SOUND_BYTES) {
    throw new FileProblem(`${file.name} is over 1 MB. Choose a shorter or more compressed sound.`);
  }
  const data = await file.arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data.slice(0)).catch(() => {
    throw new FileProblem(`${file.name} couldn't be played. Choose an MP3, WAV or OGG file.`);
  });
  if (decoded.duration > MAX_SOUND_SECONDS) {
    throw new FileProblem(`${file.name} is ${decoded.duration.toFixed(1)} seconds long. Choose one under ${MAX_SOUND_SECONDS} seconds, since it plays on every click.`);
  }
  return { name: file.name, type: file.type, data: toBase64(data) };
}
