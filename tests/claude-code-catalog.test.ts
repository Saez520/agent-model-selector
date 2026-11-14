/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  loadCatalog,
  normalizeReference,
  parseGatewayModels,
  parseProfile,
  qualityResult,
  selectSupportedModels,
  type CatalogDeps,
  type CatalogErrorKind,
  type CatalogResult,
} from "../packages/claude-code/src/catalog";
import type {
  HostFs,
  HostHttpInit,
  HostHttpResponse,
  HostProcessInit,
} from "../packages/claude-code/src/host";

const SONNET_TARGET = "Claude Code API/claude-sonnet-5-5";
const HAIKU_TARGET = "OpenCode Go/glm-5.3-flash";
const OPUS_TARGET = "OpenCode Go/glm-5.3";

const PROFILE = {
  model: "claude-sonnet-5-5",
  env: {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:3456",
    ANTHROPIC_MODEL: "Claude Code API/claude-sonnet-5-5[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "Claude Code API/claude-sonnet-5-5[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "OpenCode Go/glm-5.3-flash[1m]",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "OpenCode Go/glm-5.3[1m]",
  },
  apiKeyHelper: "/opt/ccr/api-key",
};

const GATEWAY = {
  object: "list",
  data: [
    {
      id: "Claude Code API/claude-sonnet-5-5",
      owned_by: "Claude Code API",
      display_name: "Claude Sonnet 5.5",
    },
    {
      id: "OpenCode Go/glm-5.3-flash",
      owned_by: "OpenCode Go",
      display_name: "GLM-5.3-Flash",
    },
    {
      id: "OpenCode Go/glm-5.3",
      owned_by: "OpenCode Go",
      display_name: "GLM-5.3",
    },
    {
      id: "OpenCode Go/deepseek-v4.1-flash",
      owned_by: "OpenCode Go",
      display_name: "DeepSeek V4.1 Flash",
    },
    {
      id: "OpenCode Go/GLM-5.3-Flash[1m]",
      owned_by: "OpenCode Go",
      display_name: "GLM-5.3-Flash",
    },
    { id: "no-provider", display_name: "No Provider" },
    "not-an-object",
    null,
  ],
};

function fsStub(
  read: (path: string) => Promise<string> = async (path) => {
    throw new Error(`ENOENT: ${path}`);
  }
): HostFs {
  return {
    read,
    list: async () => [],
    exists: async () => false,
  };
}

function deps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return { fs: fsStub(), ...overrides };
}

function fetchStub(response: HostHttpResponse | Error): {
  calls: { url: string; init?: HostHttpInit }[];
  fetch: NonNullable<CatalogDeps["httpFetch"]>;
} {
  const calls: { url: string; init?: HostHttpInit }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function jsonResponse(input: unknown): HostHttpResponse {
  return { status: 200, text: JSON.stringify(input) };
}

function expectQualityOnly(result: CatalogResult, kind: CatalogErrorKind): void {
  expect(result.error?.kind).toBe(kind);
  expect(result.models.map((model) => model.target)).toEqual([SONNET_TARGET]);
  expect(result.mainModel?.target).toBe(SONNET_TARGET);
  expect(result.providers.map((provider) => provider.id)).toEqual([
    "Claude Code API",
  ]);
}

// gap: G1 — payload malformado, settings ausente, 401/403, no_supported o timeout degradan el catálogo
test("the catalog parses every discovery shape and falls back to quality on each failure", async () => {
  expect(normalizeReference(" Claude Code API/claude-sonnet-5-5[1m] ")).toBe(
    "claude code api/claude-sonnet-5-5"
  );
  expect(normalizeReference("OpenCode Go/glm-5.3-flash (1m context)")).toBe(
    "opencode go/glm-5.3-flash"
  );
  expect(normalizeReference("OpenCode Go/GLM 5.3   Flash")).toBe(
    "opencode go/glm 5.3 flash"
  );

  const profile = parseProfile(PROFILE);
  expect(profile.main?.ref).toBe(SONNET_TARGET);
  expect(profile.sonnet?.ref).toBe(SONNET_TARGET);
  expect(profile.haiku?.ref).toBe(HAIKU_TARGET);
  expect(profile.opus?.ref).toBe(OPUS_TARGET);
  expect(profile.haiku?.normalized).toBe("opencode go/glm-5.3-flash");
  expect(parseProfile({})).toEqual({});
  expect(parseProfile(undefined, "claude-sonnet-5-5").main).toMatchObject({
    provider: "",
    model: "claude-sonnet-5-5",
    ref: "claude-sonnet-5-5",
  });
  expect(
    parseProfile({ env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "   " } })
  ).toEqual({});

  expect(parseGatewayModels(GATEWAY)).toEqual([
    {
      providerID: "Claude Code API",
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      target: SONNET_TARGET,
      selection: "",
    },
    {
      providerID: "OpenCode Go",
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      target: HAIKU_TARGET,
      selection: "",
    },
    {
      providerID: "OpenCode Go",
      id: "glm-5.3",
      name: "GLM-5.3",
      target: OPUS_TARGET,
      selection: "",
    },
    {
      providerID: "OpenCode Go",
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      target: "OpenCode Go/deepseek-v4.1-flash",
      selection: "",
    },
  ]);

  const single = {
    id: "OpenCode Go/glm-5.3-flash",
    owned_by: "OpenCode Go",
    display_name: "GLM-5.3-Flash",
  };
  expect(parseGatewayModels([single]).map((model) => model.target)).toEqual([
    HAIKU_TARGET,
  ]);
  expect(
    parseGatewayModels({ models: [single] }).map((model) => model.target)
  ).toEqual([HAIKU_TARGET]);
  expect(
    parseGatewayModels({ items: [single] }).map((model) => model.target)
  ).toEqual([HAIKU_TARGET]);
  expect(parseGatewayModels({ data: { id: "x" } })).toEqual([]);
  expect(parseGatewayModels(null)).toEqual([]);
  expect(parseGatewayModels("nope")).toEqual([]);
  expect(
    parseGatewayModels({
      data: [{ target_model: HAIKU_TARGET, display_name: "GLM-5.3-Flash" }],
    }).map((model) => model.target)
  ).toEqual([HAIKU_TARGET]);
  expect(
    parseGatewayModels({
      data: [
        {
          target_model: "glm-5.3-flash",
          provider: "OpenCode Go",
          display_name: "GLM-5.3-Flash",
        },
      ],
    }).map((model) => model.target)
  ).toEqual([HAIKU_TARGET]);

  const supplied = selectSupportedModels(parseGatewayModels(GATEWAY), profile);
  expect(
    supplied.map((model) => [model.target, model.selection])
  ).toEqual([
    [SONNET_TARGET, "sonnet"],
    [HAIKU_TARGET, "haiku"],
  ]);

  const shared = parseProfile({
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: HAIKU_TARGET,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: HAIKU_TARGET,
    },
  });
  expect(
    selectSupportedModels(parseGatewayModels(GATEWAY), shared).map(
      (model) => [model.target, model.selection]
    )
  ).toEqual([[HAIKU_TARGET, "sonnet"]]);

  const fallback = qualityResult(profile);
  expect(fallback.models.map((model) => [model.target, model.selection])).toEqual(
    [[SONNET_TARGET, "sonnet"]]
  );
  expect(fallback.mainModel?.target).toBe(SONNET_TARGET);
  expect(fallback.providers).toEqual([
    { id: "Claude Code API", name: "Claude Code API" },
  ]);
  const offTier = qualityResult(
    parseProfile({ env: { ANTHROPIC_MODEL: "Other/strong-model" } })
  );
  expect(
    offTier.models.map((model) => [model.target, model.selection])
  ).toEqual([["Other/strong-model", "strong-model"]]);

  expectQualityOnly(
    await loadCatalog(
      { env: { ANTHROPIC_MODEL: PROFILE.env.ANTHROPIC_MODEL } },
      deps()
    ),
    "unconfigured"
  );
  expectQualityOnly(await loadCatalog(PROFILE, deps()), "unconfigured");
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub({ status: 401, text: "" }).fetch })
    ),
    "credential"
  );
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub({ status: 403, text: "" }).fetch })
    ),
    "credential"
  );
  const serverError = await loadCatalog(
    PROFILE,
    deps({ httpFetch: fetchStub({ status: 500, text: "" }).fetch })
  );
  expectQualityOnly(serverError, "unreachable");
  expect(serverError.error?.message).toContain("500");
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub(new Error("gateway request timed out")).fetch })
    ),
    "unreachable"
  );
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub({ status: 200, text: undefined as any }).fetch })
    ),
    "invalid_response"
  );
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub({ status: 200, text: "not json" }).fetch })
    ),
    "invalid_response"
  );
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({ httpFetch: fetchStub({ status: 200, text: '{"object":"list"}' }).fetch })
    ),
    "invalid_response"
  );
  expectQualityOnly(
    await loadCatalog(PROFILE, deps({ httpFetch: fetchStub(jsonResponse({ data: [] })).fetch })),
    "no_supported"
  );
  expectQualityOnly(
    await loadCatalog(
      PROFILE,
      deps({
        httpFetch: fetchStub(
          jsonResponse({
            data: [
              {
                id: "OpenCode Go/deepseek-v4.1-flash",
                owned_by: "OpenCode Go",
                display_name: "DeepSeek V4.1 Flash",
              },
            ],
          })
        ).fetch,
      })
    ),
    "no_supported"
  );

  const captured = fetchStub(jsonResponse(GATEWAY));
  const processCalls: { argv: readonly string[]; init?: HostProcessInit }[] = [];
  const live = await loadCatalog(
    PROFILE,
    deps({
      httpFetch: captured.fetch,
      processRun: async (argv, init) => {
        processCalls.push({ argv, init });
        return { exitCode: 0, stdout: "helper-key\n", stderr: "" };
      },
    })
  );
  expect(live.error).toBeUndefined();
  expect(captured.calls).toHaveLength(1);
  expect(captured.calls[0]?.url).toBe("http://127.0.0.1:3456/v1/models");
  expect(captured.calls[0]?.init?.method).toBe("GET");
  expect(captured.calls[0]?.init?.headers?.["anthropic-version"]).toBe(
    "2023-06-01"
  );
  expect(captured.calls[0]?.init?.headers?.["x-api-key"]).toBe("helper-key");
  expect(processCalls).toEqual([
    { argv: ["/opt/ccr/api-key"], init: { timeoutMs: 5000 } },
  ]);
  expect(JSON.stringify(live)).not.toContain("helper-key");
  expect(live.models.map((model) => [model.target, model.selection])).toEqual([
    [SONNET_TARGET, "sonnet"],
    [HAIKU_TARGET, "haiku"],
  ]);
  expect(live.models.map((model) => model.name)).toEqual([
    "Claude Sonnet 5.5",
    "GLM-5.3-Flash",
  ]);
  expect(live.mainModel?.target).toBe(SONNET_TARGET);
  expect(live.providers).toEqual([
    { id: "Claude Code API", name: "Claude Code API" },
    { id: "OpenCode Go", name: "OpenCode Go" },
  ]);

  const fromFile = fetchStub(jsonResponse({ data: [] }));
  await loadCatalog(
    PROFILE,
    deps({
      httpFetch: fromFile.fetch,
      processRun: async () => {
        throw new Error("process surface unavailable");
      },
      fs: fsStub(
        async () =>
          '#!/bin/sh\nKEY="$(cat /run/key)"\necho "$SOME_ENV"\nprintf \'%s\\n\' "literal-key"\n'
      ),
    })
  );
  expect(fromFile.calls[0]?.init?.headers?.["x-api-key"]).toBe("literal-key");

  const nonzero = fetchStub(jsonResponse({ data: [] }));
  await loadCatalog(
    PROFILE,
    deps({
      httpFetch: nonzero.fetch,
      processRun: async () => ({
        exitCode: 1,
        stdout: "not-the-key",
        stderr: "denied",
      }),
      fs: fsStub(async () => 'echo "file-key"'),
    })
  );
  expect(nonzero.calls[0]?.init?.headers?.["x-api-key"]).toBe("file-key");

  const anonymous = fetchStub(jsonResponse({ data: [] }));
  await loadCatalog(
    { model: PROFILE.model, env: PROFILE.env },
    deps({ httpFetch: anonymous.fetch, fs: fsStub(async () => 'echo "unused"') })
  );
  expect(anonymous.calls[0]?.init?.headers?.["x-api-key"]).toBeUndefined();
});
