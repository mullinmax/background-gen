const CANVAS_OPTIONS = {
  willReadFrequently: false,
  desynchronized: false,
  alpha: true,
};

export function createCanvas2DContext(canvas) {
  if (!canvas) {
    console.warn('Canvas element not provided.');
    return null;
  }

  const context = canvas.getContext('2d', CANVAS_OPTIONS);
  if (!context) {
    console.warn('Canvas2D context unavailable; rendering cannot proceed without it.');
    return null;
  }

  return context;
}
