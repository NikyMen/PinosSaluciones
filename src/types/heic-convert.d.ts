declare module "heic-convert" {
  type Options = { buffer: Uint8Array | ArrayBuffer; format: "JPEG" | "PNG"; quality?: number };
  export default function convert(options: Options): Promise<ArrayBuffer>;
}
