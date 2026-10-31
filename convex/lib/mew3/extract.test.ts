import { describe, expect, it } from "vitest";
import { batchFiles } from "./extract";

const file = (name: string, mb: number) => ({ data: "", mimeType: "image/jpeg", fileName: name, byteLength: mb * 1024 * 1024 });

describe("batchFiles", () => {
  it("keeps a handful of small photos in one request", () => {
    expect(batchFiles([file("a", 1), file("b", 1), file("c", 1)]).map((b) => b.length)).toEqual([3]);
  });
  it("splits by count and by size, keeping order", () => {
    const small = Array.from({ length: 9 }, (_, i) => file(`s${i}`, 1));
    expect(batchFiles(small).map((b) => b.length)).toEqual([4, 4, 1]);
    expect(batchFiles([file("x", 7), file("y", 7), file("z", 1)]).map((b) => b.map((f) => f.fileName))).toEqual([["x"], ["y", "z"]]);
  });
  it("sends an oversized single file on its own", () => {
    expect(batchFiles([file("big", 20)]).length).toBe(1);
  });
});
