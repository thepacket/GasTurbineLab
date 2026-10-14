/** Rasterise an SVG element (or capture a WebGL canvas) to PNG and download it. */
export async function svgToPng(svg: SVGSVGElement, name: string, scale = 2) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // inline the CSS variables actually used so the standalone SVG renders with the theme colours
  const cs = getComputedStyle(document.documentElement);
  const vars = ['--bg', '--surface-1', '--surface-2', '--surface-3', '--line', '--line-strong', '--text-primary', '--text-secondary', '--text-muted', '--accent', '--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--good', '--warn', '--bad', '--seq-100', '--seq-400', '--seq-700'];
  let css = ':root{'; for (const v of vars) css += `${v}:${cs.getPropertyValue(v).trim()};`; css += '} text{font-family:ui-sans-serif,system-ui,sans-serif}';
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = css; clone.insertBefore(style, clone.firstChild);
  const rect = svg.getBoundingClientRect();
  const w = Math.max(rect.width, 600), h = Math.max(rect.height, 300);
  clone.setAttribute('width', String(w)); clone.setAttribute('height', String(h));
  clone.style.background = cs.getPropertyValue('--bg').trim();
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg render failed')); img.src = url; });
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!; ctx.fillStyle = cs.getPropertyValue('--bg').trim(); ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  downloadCanvas(c, name);
}
export function downloadCanvas(c: HTMLCanvasElement, name: string) {
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = name; a.click();
}
/** Capture a WebGL canvas (requires preserveDrawingBuffer or a fresh render first). */
export function canvasToPng(canvas: HTMLCanvasElement, name: string) { downloadCanvas(canvas, name); }
