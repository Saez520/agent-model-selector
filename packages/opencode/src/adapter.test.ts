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

  test("falls back to opencode.json and then config.json", () => {
    const directory = tempDir();
    const configDir = path.join(directory, "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), "{}\n");
    expect(resolveGlobalConfigFile({ XDG_CONFIG_HOME: directory })).toBe(
      path.join(configDir, "config.json")
    );

    fs.writeFileSync(path.join(configDir, "opencode.json"), "{}\n");
    expect(resolveGlobalConfigFile({ XDG_CONFIG_HOME: directory })).toBe(
      path.join(configDir, "opencode.json")
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

  test("throws without leaving a partial file when the directory does not exist", () => {
    const directory = tempDir();
    const file = path.join(directory, "missing", "opencode.json");
    expect(() => atomicWriteFile(file, '{"ok":true}')).toThrow();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  test("reads a configuration written with a UTF-8 BOM", () => {
    const file = path.join(tempDir(), "opencode.json");
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ model: "openai/gpt-4" })}`);
    expect(readConfig(file)).toEqual({ model: "openai/gpt-4" });
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

  test("creates an agent entry when it does not exist yet", () => {
    const config = { agent: { planner: { model: "anthropic/opus" } }, custom: { keep: true } };
    const next = applyAgentModel(config, "builder", "openai/gpt-5", "high");
    expect(next).toEqual({
      agent: {
        planner: { model: "anthropic/opus" },
        builder: { model: "openai/gpt-5", variant: "high" },
      },
      custom: { keep: true },
    });
    expect(config.agent).not.toHaveProperty("builder");
  });

  test("clearing an unknown agent leaves the configuration unchanged", () => {
    const config = { agent: { planner: { model: "anthropic/opus" } } };
    expect(clearAgentModel(config, "missing")).toEqual(config);
  });

  test("updates and clears one of two agents on disk without touching the other", () => {
    const file = path.join(tempDir(), "opencode.json");
    const initial = {
      $schema: "https://opencode.ai/config.json",
      model: "openai/gpt-4",
      agent: {
        planner: { description: "kept" },
        builder: { model: "anthropic/opus", variant: "low", custom: "kept" },
      },
      custom: { nested: true },
    };
    writeConfig(initial, file);

    writeConfig(applyAgentModel(readConfig(file), "planner", "anthropic/claude-opus", "max"), file);
    expect(readConfig(file)).toEqual({
      ...initial,
      agent: {
        planner: { description: "kept", model: "anthropic/claude-opus", variant: "max" },
        builder: { model: "anthropic/opus", variant: "low", custom: "kept" },
      },
    });

    writeConfig(clearAgentModel(readConfig(file), "planner"), file);
    expect(readConfig(file)).toEqual({
      ...initial,
      agent: {
        planner: { description: "kept" },
        builder: { model: "anthropic/opus", variant: "low", custom: "kept" },
      },
    });
  });
});
