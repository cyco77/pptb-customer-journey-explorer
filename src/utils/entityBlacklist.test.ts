import { describe, expect, it } from "vitest";
import { isEntityBlacklisted } from "./entityBlacklist";

describe("isEntityBlacklisted", () => {
  it("matches configured names case-insensitively and ignores surrounding whitespace", () => {
    expect(isEntityBlacklisted("  UserQuery ")).toBe(true);
    expect(isEntityBlacklisted("MSDYN_SERVICECOPILOTPLUGIN")).toBe(true);
  });

  it("allows names that are not in the blacklist", () => {
    expect(isEntityBlacklisted("account")).toBe(false);
    expect(isEntityBlacklisted("")).toBe(false);
  });
});
