import { describe, expect, it } from "vitest";
import { isHeif, sniffImageType } from "@/lib/heic";

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap(part => typeof part === "string" ? [...part].map(char => char.charCodeAt(0)) : part));

describe("fotos HEIC", () => {
  it("reconoce una foto del iPhone por su contenido, aunque venga como .jpg", () => {
    expect(isHeif(bytes([0, 0, 0, 0x24], "ftypheic", [0, 0, 0, 0], "mif1"))).toBe(true);
    expect(isHeif(bytes([0, 0, 0, 0x18], "ftypmif1", [0, 0, 0, 0]))).toBe(true);
    expect(isHeif(bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 0, 0]))).toBe(false); // un video MP4
    expect(isHeif(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });

  it("sirve cada imagen con su tipo real", () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(bytes([0x89], "PNG", [0x0d, 0x0a]))).toBe("image/png");
    expect(sniffImageType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(bytes([0, 0, 0, 0x24], "ftypheic"))).toBeUndefined();
  });
});
