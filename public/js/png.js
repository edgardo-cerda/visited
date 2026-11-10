/** Carga un PNG y devuelve sus pixeles (ImageData). */
export function loadImageData(src, { width, height } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = width || img.naturalWidth, h = height || img.naturalHeight;
      if ((width && img.naturalWidth !== width) || (height && img.naturalHeight !== height)) {
        console.warn(`${src} mide ${img.naturalWidth}×${img.naturalHeight}; se esperaba ${w}×${h}. Se ajusta el tamaño.`);
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen ${src}`));
    img.src = src;
  });
}
