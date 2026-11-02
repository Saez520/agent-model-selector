import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const coreDir = path.join(packageRoot, "packages", "core");
const opencodeDir = path.join(packageRoot, "packages", "opencode");
const uxPattern = /flowtask[.a-z-]*|FlowTask/g;

function read(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8");
}

function productionSources(directory: string): string[] {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => read(path.join(directory, name)));
}

function uxTokens(text: string): string[] {
  return [...new Set(text.match(uxPattern) ?? [])].sort();
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("agnostic core boundary", () => {
  test("core sources contain no FlowTask, host package or host config reference", () => {
    const source = productionSources(path.join(coreDir, "src")).join("\n");
    expect(source).not.toMatch(/flowtask/i);
    expect(source).not.toMatch(/@opencode/);
    expect(source).not.toMatch(/claude-code/);
    expect(source).not.toMatch(/opencode\.json/);
  });

  test("core package declares no FlowTask or host dependency", () => {
    const manifest = read(path.join(coreDir, "package.json"));
    expect(manifest).not.toMatch(/flowtask/i);
    expect(manifest).not.toMatch(/@opencode|claude-code/);
  });

  test("no package imports FlowTask or points at FlowTask paths", () => {
    const sources = [
      ...productionSources(path.join(coreDir, "src")),
      read(path.join(opencodeDir, "tui.tsx")),
      read(path.join(opencodeDir, "src", "adapter.ts")),
    ].join("\n");
    expect(sources).not.toMatch(/@flowtask/);
    expect(sources).not.toMatch(/from\s+["'][^"']*flowtask/);
    expect(sources).not.toMatch(/\.flowtask\//);
    expect(sources).not.toMatch(/flowtask\//);
  });
});

describe("OpenCode UX parity", () => {
  test("the source keeps the command, keymap, action id and toast contract", () => {
    const tui = read(path.join(opencodeDir, "tui.tsx"));
    expect(tui).toContain('name: "flowtask-model"');
    expect(tui).toContain("flowtask.model.open");
    expect(tui).toContain('bind: "alt+m"');
    expect(tui).toContain("FlowTask Model");
    expect(tui).toContain('group: "FlowTask"');
  });

  test("FlowTask strings are limited to the allowed UX tokens", () => {
    const source = [
      read(path.join(opencodeDir, "tui.tsx")),
      read(path.join(opencodeDir, "README.md")),
      read(path.join(opencodeDir, "src", "adapter.ts")),
    ].join("\n");
    expect(uxTokens(source)).toEqual(["FlowTask", "flowtask-model", "flowtask.model.open"]);
  });

  test("the tracked dist preserves the same UX tokens", () => {
    const dist = read(path.join(opencodeDir, "dist", "tui.js"));
    expect(dist.length).toBeGreaterThan(0);
    expect(uxTokens(dist)).toEqual(["FlowTask", "flowtask-model", "flowtask.model.open"]);
  });
});

describe("OpenCode host boundary", () => {
  test("the adapter imports only Node builtins and the agnostic core", () => {
    const adapter = read(path.join(opencodeDir, "src", "adapter.ts"));
    const specifiers = importSpecifiers(adapter);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith("node:") || specifier === "@agent-model-selector/core"
      ).toBe(true);
    }
    expect(adapter).not.toMatch(/flowtask/i);
  });

  test("the package manifest keeps the installation contract", () => {
    const manifest = JSON.parse(read(path.join(opencodeDir, "package.json"))) as {
      name: string;
      exports: Record<string, string>;
      peerDependencies: Record<string, string>;
      files: string[];
    };
    expect(manifest.name).toBe("agent-model-selector-opencode");
    expect(manifest.exports["./tui"]).toBe("./dist/tui.js");
    expect(manifest.peerDependencies["@opencode/plugin"]).toBe("2.0.29");
    expect(manifest.files).toEqual(["dist", "package.json", "README.md"]);
    expect(JSON.stringify(manifest)).not.toMatch(/flowtask/i);
  });

  test("the workspace root has no FlowTask dependency", () => {
    const manifest = read(path.join(packageRoot, "package.json"));
    expect(manifest).not.toMatch(/flowtask/i);
  });
});
