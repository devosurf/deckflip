export function baseStylesheet(width: number, height: number): string {
  return `html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial; }
body > section { position: relative; box-sizing: border-box; overflow: hidden; width: ${width}px; height: ${height}px; }
aside.notes { display: none !important; }`;
}
