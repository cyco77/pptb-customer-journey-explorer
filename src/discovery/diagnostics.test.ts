import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDiagnostics, getDiagnosticEventName, getDiagnostics, logDiagnostic } from "./diagnostics";

describe("diagnostics", () => {
  beforeEach(() => {
    clearDiagnostics();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("redacts GUIDs from queries, records context, and dispatches the diagnostic event", () => {
    const diagnostic = logDiagnostic({
      level: "info",
      phase: "query",
      entity: "account",
      message: "Loaded account",
      query: "accounts(11111111-1111-1111-1111-111111111111)?$select=name",
      sourceArtifactId: "artifact-1",
      sourceDisplayName: "Welcome account",
    });

    expect(diagnostic.query).toBe("accounts(<guid>)?$select=name");
    expect(getDiagnostics()).toEqual([diagnostic]);
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
    const event = vi.mocked(window.dispatchEvent).mock.calls[0]?.[0] as CustomEvent;
    expect(event.type).toBe(getDiagnosticEventName());
    expect(event.detail).toBe(diagnostic);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("item=Welcome account"), expect.objectContaining({ sourceArtifactId: "artifact-1" }));
  });

  it("routes warnings and errors to matching console methods, sanitizing custom errors", () => {
    class DataverseError extends Error {
      code = "0x123";
      accessToken = "do-not-record";
      payload = { nested: true };
    }

    const warning = logDiagnostic({ level: "warning", phase: "metadata", message: "Fallback used", error: { code: "bad", password: "secret", nested: { value: 1 }, reason: new Error("inner") } });
    const error = logDiagnostic({ level: "error", phase: "query", message: "Request failed", error: new DataverseError("failed") });

    expect(warning.error).toEqual({ code: "bad", reason: { name: "Error", message: "inner", stack: expect.any(String) } });
    expect(error.error).toMatchObject({ name: "Error", message: "failed", code: "0x123" });
    expect(error.error).not.toHaveProperty("accessToken");
    expect(error.error).not.toHaveProperty("payload");
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("serializes primitive and ordinary object errors", () => {
    const primitive = logDiagnostic({ level: "info", phase: "primitive", message: "Primitive", error: "network down" });
    const object = logDiagnostic({ level: "info", phase: "object", message: "Object", error: { status: 503, token: "secret", ok: true } });

    expect(primitive.error).toEqual({ message: "network down" });
    expect(object.error).toEqual({ status: 503, ok: true });
  });

  it("caps retained entries and clearDiagnostics resets entries and emits a clear event", () => {
    for (let index = 0; index < 505; index += 1) {
      logDiagnostic({ level: "info", phase: "bounded", message: `entry-${index}` });
    }
    expect(getDiagnostics()).toHaveLength(500);
    expect(getDiagnostics()[0]?.message).toBe("entry-5");

    clearDiagnostics();

    expect(getDiagnostics()).toEqual([]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(506);
    const clearEvent = vi.mocked(window.dispatchEvent).mock.calls.at(-1)?.[0] as CustomEvent;
    expect(clearEvent.detail).toBeNull();
  });

  it("works when no browser window is available", () => {
    vi.unstubAllGlobals();
    expect(() => logDiagnostic({ level: "info", phase: "node", message: "No window" })).not.toThrow();
    expect(getDiagnostics()).toHaveLength(1);
    expect(() => clearDiagnostics()).not.toThrow();
    expect(getDiagnostics()).toEqual([]);
  });
});
