import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
import { pinIsWeak, sha256Hex } from "../lib/pin";

describe("pin hashing", () => {
  it("matches the SHA-256 test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("rejects guessable PINs", () => {
    expect(pinIsWeak("11111")).toBe(true);
    expect(pinIsWeak("12345")).toBe(true);
    expect(pinIsWeak("54321")).toBe(true);
    expect(pinIsWeak("1234")).toBe(true);
    expect(pinIsWeak("40817")).toBe(false);
  });
});
