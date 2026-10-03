import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";

describe("release workflow", () => {
  it("sets up pnpm and Node.js and installs dependencies before selecting release mode", () => {
    const selectionJob = releaseWorkflow.split("  select-release-mode:")[1].split("\n  version:")[0];
    const requiredSteps = [
      "uses: actions/checkout@v4",
      "uses: pnpm/action-setup@v4",
      "uses: actions/setup-node@v4",
      "run: pnpm install --frozen-lockfile",
      "uses: changesets/action/select-mode@v2",
    ];

    let previousPosition = -1;
    for (const step of requiredSteps) {
      const position = selectionJob.indexOf(step);
      expect(position, step).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }

    expect(selectionJob).toContain("version: 11.0.0");
    expect(selectionJob).toContain('node-version: "24.x"');
    expect(selectionJob).toContain('cache: "pnpm"');
  });
});
