// Purrsor - turning uploaded files into cursor pictures and click sounds.

const MAX_SOUND_BYTES = 1_000_000;
const MAX_SOUND_SECONDS = 3;

class FileProblem extends Error {}

// An uploaded picture as a PNG data URL no larger than MAX_CURSOR_SIZE.
async function readPicture(file) {
  if (!file.type.startsWith('image/')) {
    throw new FileProblem(`${file.name} isn't a picture. Choose a PNG, JPEG, GIF, WebP or SVG.`);
  }
  const image = new Image();
  image.src = URL.createObjectURL(file);
  try {
    await image.decode();
  } catch {
    throw new FileProblem(`${file.name} couldn't be opened as a picture.`);
  } finally {
    URL.revokeObjectURL(image.src);
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new FileProblem(`${file.name} has no size. SVGs need a width and height.`);
  }
  const scale = Math.min(1, MAX_CURSOR_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// An uploaded sound as a data URL, checked to play and to be short enough for every click.
async function readSound(file) {
  if (file.size > MAX_SOUND_BYTES) {
    throw new FileProblem(`${file.name} is over 1 MB. Choose a shorter or more compressed sound.`);
  }
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer()).catch(() => {
    throw new FileProblem(`${file.name} couldn't be played. Choose an MP3, WAV or OGG file.`);
  });
  if (decoded.duration > MAX_SOUND_SECONDS) {
    throw new FileProblem(`${file.name} is ${decoded.duration.toFixed(1)} seconds long. Choose one under ${MAX_SOUND_SECONDS} seconds, since it plays on every click.`);
  }
  return toDataUrl(file);
}
