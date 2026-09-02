function parseHex(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error('color must be a six-digit hex value such as #7A1F3D.');
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The wardrobe image could not be loaded.'));
    image.src = src;
  });
}

function saturation(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  return max ? (max - Math.min(red, green, blue)) / max : 0;
}

function luminance(red: number, green: number, blue: number) {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function morphology(source: Uint8Array, width: number, height: number, dilate: boolean) {
  const result = new Uint8Array(source.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let value = dilate ? 0 : 1;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighbor = source[(y + offsetY) * width + x + offsetX];
          value = dilate ? Math.max(value, neighbor) : Math.min(value, neighbor);
        }
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

function largestComponent(binary: Uint8Array, width: number) {
  const visited = new Uint8Array(binary.length);
  let largest: number[] = [];
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      component.push(index);
      const x = index % width;
      for (const neighbor of [index - width, index + width, index - 1, index + 1]) {
        if (neighbor < 0 || neighbor >= binary.length || visited[neighbor] || !binary[neighbor]) continue;
        if ((neighbor === index - 1 && x === 0) || (neighbor === index + 1 && x === width - 1)) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const result = new Uint8Array(binary.length);
  for (const index of largest) result[index] = 1;
  return result;
}

function foregroundMask(data: Uint8ClampedArray, width: number, height: number) {
  const border: number[][] = [];
  for (let x = 0; x < width; x += 4) border.push([data[x * 4], data[x * 4 + 1], data[x * 4 + 2]]);
  const background = border.reduce((total, pixel) => total.map((value, channel) => value + pixel[channel]), [0, 0, 0]).map((value) => value / border.length);
  const distanceMask = new Uint8Array(width * height);
  let transparent = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 128) transparent += 1;
  }
  const hasTransparency = transparent > width * height * 0.01;
  let colorful = 0;
  let foreground = 0;
  let usedChromaMask = false;
  let centerLuminance = 0;
  let centerPixels = 0;
  for (let index = 0; index < distanceMask.length; index += 1) {
    const offset = index * 4;
    if (hasTransparency && data[offset + 3] < 128) continue;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const distance = Math.hypot(red - background[0], green - background[1], blue - background[2]);
    if (!hasTransparency && distance <= 18) continue;
    distanceMask[index] = 1;
    foreground += 1;
    if (saturation(red, green, blue) > 0.05) colorful += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > width * 0.25 && x < width * 0.75 && y > height * 0.15 && y < height * 0.8) {
      centerLuminance += luminance(red, green, blue);
      centerPixels += 1;
    }
  }
  if (foreground && colorful / foreground > 0.6) {
    usedChromaMask = true;
    for (let index = 0; index < distanceMask.length; index += 1) {
      const offset = index * 4;
      if (distanceMask[index] && saturation(data[offset], data[offset + 1], data[offset + 2]) <= 0.05) distanceMask[index] = 0;
    }
  } else if (centerPixels && centerLuminance / centerPixels < 0.67) {
    usedChromaMask = true;
    const maximum = centerLuminance / centerPixels + 0.24;
    for (let index = 0; index < distanceMask.length; index += 1) {
      const offset = index * 4;
      if (distanceMask[index] && luminance(data[offset], data[offset + 1], data[offset + 2]) > maximum) distanceMask[index] = 0;
    }
  }
  let refined = distanceMask;
  if (usedChromaMask) {
    for (let pass = 0; pass < 3; pass += 1) refined = morphology(refined, width, height, true);
    for (let pass = 0; pass < 3; pass += 1) refined = morphology(refined, width, height, false);
  }
  const opened = morphology(morphology(refined, width, height, false), width, height, true);
  return largestComponent(opened, width);
}

export async function recolorImage(src: string, hex: string) {
  const target = parseHex(hex);
  const image = await loadImage(src);
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas recoloring is unavailable in this browser.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = foregroundMask(pixels.data, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (!mask[index / 4]) {
      pixels.data[index + 3] = 0;
      continue;
    }
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];

    const lightness = luminance(red, green, blue);
    const shade = 0.34 + lightness * 0.78;
    const mix = Math.min(0.92, Math.max(0.68, (saturation(red, green, blue) - 0.015) / 0.07));
    pixels.data[index] = red * (1 - mix) + Math.min(255, target[0] * shade) * mix;
    pixels.data[index + 1] = green * (1 - mix) + Math.min(255, target[1] * shade) * mix;
    pixels.data[index + 2] = blue * (1 - mix) + Math.min(255, target[2] * shade) * mix;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
