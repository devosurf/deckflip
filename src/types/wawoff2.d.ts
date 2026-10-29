declare module 'wawoff2/decompress.js' {
  /** google/woff2 `ConvertWOFF2ToTTF`, compiled to WebAssembly; rejects when the input is not valid WOFF2. */
  export default function decompress(input: Uint8Array): Promise<Uint8Array>;
}

declare module 'wawoff2/compress.js' {
  /** google/woff2 `ConvertTTFToWOFF2`; the tests use it to make WOFF2 fixtures from pinned TTFs. */
  export default function compress(input: Uint8Array): Promise<Uint8Array>;
}
