/// <reference types="bun" />
import { expect, test } from "bun:test";
import { discoverAgents } from "../packages/claude-code/src/agents";
import type { HostFs } from "../packages/claude-code/src/host";
import { agentKey } from "../packages/claude-code/src/keys";

interface Entry {
  name: string;
  kind: string;
  isLink?: boolean;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

/**
 * A filesystem with directories, readable files, unreadable files and links.
 * It answers `list` and `read` the way the engine's `$.fs` does.
 */
function memoryFs(
  files: Record<string, string>,
  unreadable: readonly string[] = [],
  links: readonly string[] = []
): HostFs {
  const fileMap = new Map(Object.entries(files));
  const directories = new Set<string>();
  for (const path of fileMap.keys()) {
    let current = dirname(path);
    while (current !== "/" && current !== "") {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    directories.add("/");
  }
  const unreadableSet = new Set(unreadable);
  const linkSet = new Set(links);

  return {
    async read(path) {
      if (unreadableSet.has(path)) throw new Error(`EACCES: ${path}`);
      const content = fileMap.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async list(path) {
      const normalized = path.replace(/\/+$/g, "") || "/";
      if (!directories.has(normalized)) throw new Error(`ENOENT: ${normalized}`);
      const prefix = normalized === "/" ? "/" : `${normalized}/`;
      const entries = new Map<string, Entry>();

      for (const file of fileMap.keys()) {
        if (!file.startsWith(prefix)) continue;
        const parts = file.slice(prefix.length).split("/");
        const name = parts[0];
        if (!name) continue;
        const kind = parts.length === 1 ? "file" : "dir";
        if (!entries.has(name)) {
          entries.set(name, {
            name,
            kind,
            ...(kind === "file" && linkSet.has(file) ? { isLink: true } : {}),
          });
        }
      }

      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue;
        const parts = directory.slice(prefix.length).split("/");
        const name = parts[0];
        if (!name) continue;
        if (!entries.has(name)) entries.set(name, { name, kind: "dir" });
      }

      return [...entries.values()];
    },
    async exists(path) {
      return directories.has(path) || fileMap.has(path);
    },
  };
}

/**
 * G2: discovery must read frontmatter, tolerate malformed or unreadable files,
 * walk subfolders, keep project agents over user agents and expose stable ids.
 */
test("discovery reads project and user agents without throwing on broken input", async () => {
  const project = "/work/repo";
  const home = "/home/dev";
  const agents = `${project}/.claude/agents`;
  const userAgents = `${home}/.claude/agents`;

  const fs = memoryFs(
    {
      [`${agents}/aaa-planner.md`]:
        "---\nname: FlowTask Planner\nmodel: opus\ndescription: Plans the work\n---\nbody\n",
      [`${agents}/flowtask-planner.md`]: "---\nname: FlowTask Planner\n---\n",
      [`${agents}/flowtask_planner.md`]: "---\nname: flowtask_planner\n---\n",
      [`${agents}/sub/flowtask-reviewer.md`]:
        "---\ndescription: Reviews changes\n---\n",
      [`${agents}/bom.md`]: "\uFEFF---\nname: Bom Agent\n---\n",
      [`${agents}/zbad.md`]: "no frontmatter here\n",
      [`${agents}/unterminated.md`]: "---\nname: Half Agent\n",
      [`${agents}/broken-read.md`]: "---\nname: Broken Agent\n---\n",
      [`${agents}/link.md`]: "---\nname: Linked Agent\n---\n",
      [`${agents}/deep/a/b/c/at-limit.md`]: "---\nname: At Limit\n---\n",
      [`${agents}/deep/a/b/c/d/beyond-limit.md`]:
        "---\nname: Beyond Limit\n---\n",
      [`${userAgents}/flowtask-planner.md`]: "---\nname: FlowTask Planner\n---\n",
      [`${userAgents}/user-helper.md`]: "---\nname: User Helper\n---\n",
    },
    [`${agents}/broken-read.md`],
    [`${agents}/link.md`]
  );

  const log: string[] = [];
  const discovered = await discoverAgents(fs, project, home, {
    log: (message) => log.push(message),
  });

  expect(discovered.map((definition) => definition.id)).toEqual([
    "project:.:FlowTask Planner",
    "project:.:Bom Agent",
    "project:deep/a/b/c:At Limit",
    "project:sub:flowtask-reviewer",
    "user:.:User Helper",
  ]);

  const planner = discovered.find((definition) => definition.type === "FlowTask Planner");
  expect(planner?.source).toBe("project");
  expect(planner?.file).toBe(`${agents}/aaa-planner.md`);
  expect(planner?.model).toBe("opus");
  expect(planner?.shadowedBy).toContain(`${agents}/flowtask-planner.md`);
  expect(planner?.shadowedBy).toContain(`${agents}/flowtask_planner.md`);
  expect(planner?.shadowedBy).toContain(`${userAgents}/flowtask-planner.md`);
  expect(
    discovered.filter(
      (definition) => agentKey(definition.type) === agentKey("FlowTask Planner")
    )
  ).toHaveLength(1);

  expect(discovered.find((definition) => definition.id === "project:sub:flowtask-reviewer")?.type).toBe(
    "flowtask-reviewer"
  );
  expect(discovered.find((definition) => definition.id === "project:.:Bom Agent")?.name).toBe(
    "Bom Agent"
  );
  expect(discovered.some((definition) => definition.type === "Beyond Limit")).toBe(false);
  expect(discovered.some((definition) => definition.type === "Linked Agent")).toBe(false);
  expect(discovered.some((definition) => definition.type === "Broken Agent")).toBe(false);
  expect(log.some((message) => message.includes("broken-read.md"))).toBe(true);
  expect(log.some((message) => message.includes("shadowed"))).toBe(true);

  const missingLog: string[] = [];
  const missing = await discoverAgents(fs, "/workspace/missing", "/home/nobody", {
    log: (message) => missingLog.push(message),
  });
  expect(missing).toEqual([]);

  const projectOnlyLog: string[] = [];
  const projectOnly = await discoverAgents(fs, project, undefined, {
    log: (message) => projectOnlyLog.push(message),
  });
  expect(projectOnly.some((definition) => definition.id === "user:.:User Helper")).toBe(false);
  expect(projectOnlyLog).toContain(
    "user agent directory unavailable; project agents only"
  );

  const secondPass = await discoverAgents(fs, project, home);
  expect(secondPass.map((definition) => definition.id)).toEqual(
    discovered.map((definition) => definition.id)
  );
});
