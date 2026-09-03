export function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function attr(value: string): string {
  return text(value).replace(/"/g, '&quot;');
}
