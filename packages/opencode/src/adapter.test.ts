import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyAgentModel,
  atomicWriteFile,
  buildAgentConfig,
  clearAgentModel,
  readConfig,
  resolveGlobalConfigFile,
  stripJsonBom,
  writeConfig,
} from "./adapter";

const fixtures: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-model-selector-"));
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe("resolveGlobalConfigFile", () => {
  test("uses XDG_CONFIG_HOME and prefers opencode.jsonc", () => {
    const directory = tempDir();
    const configDir = path.join(directory, "opencode");
    fs.mkdirSync(configDir, { recursive: true });

    expect(resolveGlobalConfigFile({ XDG_CONFIG_HOME: directory })).toBe(
      path.join(configDir, "opencode.json")
    );

    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), "{}\n");
    expect(resolveGlobalConfigFile({ XDG_CONFIG_HOME: directory })).toBe(
      path.join(configDir, "opencode.jsonc")
    );
  });
});

describe("readConfig and writeConfig", () => {
  test("returns an empty object for a missing file", () => {
    expect(readConfig(path.join(tempDir(), "missing.json"))).toEqual({});
  });

  test("round-trips a configuration and preserves unrelated fields", () => {
    const file = path.join(tempDir(), "opencode.json");
    const config = {
      $schema: "https://opencode.ai/config.json",
      model: "openai/gpt-4",
      agent: { planner: { model: "anthropic/opus", description: "kept" } },
      custom: { nested: true },
    };

    writeConfig(config, file);
    expect(readConfig(file)).toEqual(config);
    expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify(config, null, 2));
  });

  test("reports invalid JSON with the file path and leaves the file untouched", () => {
    const file = path.join(tempDir(), "opencode.json");
    fs.writeFileSync(file, "{ invalid");
    expect(() => readConfig(file)).toThrow(`invalid config ${file}`);
    expect(fs.readFileSync(file, "utf8")).toBe("{ invalid");
  });

  test("cleans temporary files after a successful write", () => {
    const directory = tempDir();
    const file = path.join(directory, "opencode.json");
    atomicWriteFile(file, '{"ok":true}');
    expect(fs.readdirSync(directory).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

describe("stripJsonBom", () => {
  test("removes a UTF-8 BOM", () => {
    expect(stripJsonBom('﻿{"test":true}')).toBe('{"test":true}');
    expect(stripJsonBom('{"test":true}')).toBe('{"test":true}');
  });
});

describe("buildAgentConfig", () => {
  test("merges live agents with explicit overrides", () => {
    const config = {
      agent: {
        planner: { model: "anthropic/opus", variant: "high", custom: "kept" },
      },
    };
    const agents = [
      { id: "planner", name: "planner", model: "openai/gpt-5" },
      { id: "builder" },
    ];

    expect(buildAgentConfig(config, agents)).toEqual({
      agent: {
        planner: { model: "openai/gpt-5", variant: "high", custom: "kept" },
        builder: { model: undefined },
      },
    });
  });
});

describe("applyAgentModel and clearAgentModel", () => {
  test("sets agent.{name}.model and keeps the rest intact", () => {
    const config = {
      model: "openai/gpt-4",
      agent: {
        planner: { description: "kept", variant: "low" },
        other: { model: "anthropic/opus" },
      },
    };

    const next = applyAgentModel(config, "planner", "anthropic/claude-opus", "high");
    expect(next).toEqual({
      model: "openai/gpt-4",
      agent: {
        planner: { description: "kept", model: "anthropic/claude-opus", variant: "high" },
        other: { model: "anthropic/opus" },
      },
    });
    expect(config.agent.planner).toEqual({ description: "kept", variant: "low" });
  });

  test("removes model and variant without deleting the agent", () => {
    const config = {
      agent: { planner: { model: "anthropic/opus", variant: "high", description: "kept" } },
    };

    expect(clearAgentModel(config, "planner")).toEqual({
      agent: { planner: { description: "kept" } },
    });
  });
});
