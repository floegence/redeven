package protocol

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type openAPIContract struct {
	OpenAPI    string                     `yaml:"openapi"`
	Info       openAPIInfo                `yaml:"info"`
	Paths      map[string]openAPIPathItem `yaml:"paths"`
	Components openAPIComponents          `yaml:"components"`
}

type openAPIInfo struct {
	Title   string `yaml:"title"`
	Version string `yaml:"version"`
}

type openAPIComponents struct {
	SecuritySchemes map[string]any             `yaml:"securitySchemes"`
	Responses       map[string]openAPIResponse `yaml:"responses"`
	Schemas         map[string]openAPISchema   `yaml:"schemas"`
}

type openAPIPathItem map[string]openAPIOperation

type openAPIOperation struct {
	OperationID string                     `yaml:"operationId"`
	Security    []map[string][]string      `yaml:"security"`
	RequestBody openAPIRequestBody         `yaml:"requestBody"`
	Responses   map[string]openAPIResponse `yaml:"responses"`
}

type openAPIRequestBody struct {
	Required bool                        `yaml:"required"`
	Content  map[string]openAPIMediaType `yaml:"content"`
}

type openAPIResponse struct {
	Ref     string                      `yaml:"$ref"`
	Content map[string]openAPIMediaType `yaml:"content"`
}

type openAPIMediaType struct {
	Schema openAPISchema `yaml:"schema"`
}

type openAPISchema struct {
	Ref                  string                   `yaml:"$ref"`
	Type                 string                   `yaml:"type"`
	Const                any                      `yaml:"const"`
	Enum                 []string                 `yaml:"enum"`
	Required             []string                 `yaml:"required"`
	Properties           map[string]openAPISchema `yaml:"properties"`
	Items                *openAPISchema           `yaml:"items"`
	OneOf                []openAPISchema          `yaml:"oneOf"`
	AdditionalProperties any                      `yaml:"additionalProperties"`
}

func TestGatewayOpenAPIContract(t *testing.T) {
	root := repoRoot(t)
	specPath := filepath.Join(root, "spec", "openapi", "gateway-v1.yaml")
	rawSpec := readFile(t, specPath)
	if strings.Contains(rawSpec, "redeven-runtime-gateway-v1") {
		t.Fatalf("gateway OpenAPI contract must not restore the old runtime-gateway protocol name")
	}
	for _, forbidden := range []string{"minimum_desktop_version", "minimum_runtime_version", "compatibility_epoch"} {
		if strings.Contains(rawSpec, forbidden) {
			t.Fatalf("gateway OpenAPI contract must not include Runtime Service compatibility field %q", forbidden)
		}
	}

	contract := parseOpenAPIContract(t, rawSpec)
	if contract.OpenAPI != "3.1.0" {
		t.Fatalf("openapi = %q, want 3.1.0", contract.OpenAPI)
	}
	if contract.Info.Version != Version {
		t.Fatalf("info.version = %q, want %q", contract.Info.Version, Version)
	}
	assertProtocolVersionSchema(t, contract)
	assertDesktopProtocolLiterals(t, root)
	assertGatewayPaths(t, contract, root)
	assertGatewaySecurity(t, contract)
	assertSignatureHeaderSources(t, root)
	assertRequestResponseEnvelopes(t, contract)
	assertObjectSchemasClosed(t, contract)
	assertGatewayEnums(t, contract)
	assertRequiredWireFields(t, contract)
	assertProfileAccessRouteSchemas(t, contract)
	assertConnectArtifactSchemas(t, contract)
}

func TestGatewayNamingBoundary(t *testing.T) {
	root := repoRoot(t)
	for _, rel := range []string{filepath.Join("internal", "codeapp", "gateway")} {
		if _, err := os.Stat(filepath.Join(root, rel)); err == nil {
			t.Fatalf("%s must stay renamed; Gateway is reserved for redeven-gateway/runtime Gateway concepts", rel)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat %s: %v", rel, err)
		}
	}

	forbidden := []string{
		"internal/codeapp/gateway",
		"fetchGatewayJSON",
		"prepareGatewayRequestInit",
		"GatewayAccessStatus",
		"GatewayUploadResponse",
		"uploadGatewayFile",
		"getGatewayAccessStatus",
		"unlockGatewayAccess",
		"CodexGatewayError",
		"fetchCodexGatewayJSON",
		"codex_gateway",
		"ScopeGatewayAPI",
		`"gateway_api"`,
		`'gateway_api'`,
		"gatewayMocks",
		"gatewayFetchStore",
		"gateway call",
		"gateway request",
		"local gateway",
		"custom gateways",
		"custom gateway",
		"AI custom gateway",
		"local API gateway",
		"Compatible gateways",
		"OpenAI-OpenAI-compatible",
		"GatewayDir",
		"redevenFloretGatewayConfig",
		"redeven-model-gateway",
		"fake gateway identity",
		"gateway placeholder",
		"Code App gateway",
		"Env App gateway",
		"customGatewayDescription",
		"dialogCustomGateway",
		"Custom gateway",
		"compatible gateway",
	}
	assertNoRepositorySubstring(t, root, forbidden)
}

func parseOpenAPIContract(t *testing.T, raw string) openAPIContract {
	t.Helper()
	var contract openAPIContract
	if err := yaml.Unmarshal([]byte(raw), &contract); err != nil {
		t.Fatalf("parse gateway OpenAPI contract: %v", err)
	}
	if len(contract.Paths) == 0 {
		t.Fatal("gateway OpenAPI contract has no paths")
	}
	if len(contract.Components.Schemas) == 0 {
		t.Fatal("gateway OpenAPI contract has no component schemas")
	}
	return contract
}

func assertProtocolVersionSchema(t *testing.T, contract openAPIContract) {
	t.Helper()
	schema := schemaByName(t, contract, "ProtocolVersion")
	if schema.Type != "string" || schema.Const != Version {
		t.Fatalf("ProtocolVersion schema = {type:%q const:%v}, want string const %q", schema.Type, schema.Const, Version)
	}
}

func assertDesktopProtocolLiterals(t *testing.T, root string) {
	t.Helper()
	client := readFile(t, filepath.Join(root, "desktop", "src", "main", "gatewayClient.ts"))
	constMatch := regexp.MustCompile(`const\s+GATEWAY_PROTOCOL_VERSION\s*=\s*'([^']+)'`).FindStringSubmatch(client)
	if len(constMatch) != 2 {
		t.Fatal("desktop gateway client protocol version constant was not found")
	}
	if constMatch[1] != Version {
		t.Fatalf("Desktop GATEWAY_PROTOCOL_VERSION = %q, want %q", constMatch[1], Version)
	}

	for _, rel := range []string{
		filepath.Join("desktop", "src", "main", "gatewayClient.ts"),
		filepath.Join("desktop", "src", "main", "gatewayTrust.ts"),
	} {
		content := readFile(t, filepath.Join(root, rel))
		for _, match := range regexp.MustCompile(`'([^']*redeven-gateway-v[0-9]+[^']*)'`).FindAllStringSubmatch(content, -1) {
			if match[1] != Version {
				t.Fatalf("%s contains Gateway protocol literal %q, want only %q", rel, match[1], Version)
			}
		}
	}
}

func assertGatewayPaths(t *testing.T, contract openAPIContract, root string) {
	t.Helper()
	expected := []string{
		"/gateway/v1/pairing/challenge",
		"/gateway/v1/pairing/complete",
		"/gateway/v1/catalog",
		"/gateway/v1/open-session",
		"/gateway/v1/env-profiles/upsert",
		"/gateway/v1/env-profiles/delete",
		"/gateway/v1/env-lifecycle",
	}
	assertSameStrings(t, "OpenAPI paths", keys(contract.Paths), expected)
	for _, path := range expected {
		item := contract.Paths[path]
		if len(item) != 1 {
			t.Fatalf("%s methods = %v, want only post", path, keys(item))
		}
		if _, ok := item["post"]; !ok {
			t.Fatalf("%s does not define post", path)
		}
	}

	server := readFile(t, filepath.Join(root, "internal", "gatewayservice", "server.go"))
	serverPaths := uniqueSubmatches(regexp.MustCompile(`mux\.HandleFunc\("([^"]+)"`), server)
	assertSameStrings(t, "gateway service registered paths", serverPaths, expected)

	client := readFile(t, filepath.Join(root, "desktop", "src", "main", "gatewayClient.ts"))
	clientRoutes := uniqueSubmatches(regexp.MustCompile(`'((?:gateway/v1/)[^']+)'`), client)
	for i, route := range clientRoutes {
		clientRoutes[i] = "/" + route
	}
	assertSameStrings(t, "Desktop Gateway client routes", clientRoutes, expected)
}

func assertGatewaySecurity(t *testing.T, contract openAPIContract) {
	t.Helper()
	requiredSchemes := []string{
		"GatewayID",
		"GatewayBindingAudience",
		"GatewayClientKeyID",
		"GatewayClientNonce",
		"GatewayRequestTimestamp",
		"GatewayRequestSignature",
		"GatewayManagedBridgeToken",
	}
	for _, name := range requiredSchemes {
		if _, ok := contract.Components.SecuritySchemes[name]; !ok {
			t.Fatalf("missing security scheme %s", name)
		}
	}
	signed := requiredSchemes[:6]
	requireSecurity(t, contract, "/gateway/v1/catalog", signed)
	requireSecurity(t, contract, "/gateway/v1/open-session", signed)
	requireSecurity(t, contract, "/gateway/v1/env-lifecycle", signed)
	requireSecurity(t, contract, "/gateway/v1/env-profiles/upsert", append(append([]string{}, signed...), "GatewayManagedBridgeToken"))
	requireSecurity(t, contract, "/gateway/v1/env-profiles/delete", append(append([]string{}, signed...), "GatewayManagedBridgeToken"))
	for _, path := range []string{"/gateway/v1/pairing/challenge", "/gateway/v1/pairing/complete"} {
		if got := postOperation(t, contract, path).Security; len(got) != 0 {
			t.Fatalf("%s security = %#v, want unauthenticated pairing transport gate", path, got)
		}
	}
}

func assertSignatureHeaderSources(t *testing.T, root string) {
	t.Helper()
	requiredHeaders := []string{
		"X-Redeven-Gateway-ID",
		"X-Redeven-Gateway-Binding-Audience",
		"X-Redeven-Client-Key-ID",
		"X-Redeven-Client-Nonce",
		"X-Redeven-Request-TS",
		"X-Redeven-Request-Signature",
	}
	authVerifier := readFile(t, filepath.Join(root, "internal", "runtimegateway", "auth", "auth.go"))
	gatewayService := readFile(t, filepath.Join(root, "internal", "gatewayservice", "server.go"))
	desktopTrust := readFile(t, filepath.Join(root, "desktop", "src", "main", "gatewayTrust.ts"))
	for _, header := range requiredHeaders {
		if !strings.Contains(authVerifier, header) && !strings.Contains(gatewayService, header) {
			t.Fatalf("auth verifier does not read signed header %s", header)
		}
		headerLower := strings.ToLower(header)
		if !strings.Contains(desktopTrust, headerLower) {
			t.Fatalf("Desktop trust code does not create signed header %s", headerLower)
		}
	}
	for _, field := range []string{"protocol_version", "method", "route", "body_digest", "gateway_id", "binding_audience", "nonce", "timestamp_unix_ms"} {
		if !strings.Contains(authVerifier, field) {
			t.Fatalf("auth verifier signature payload is missing %s", field)
		}
		if !strings.Contains(desktopTrust, field) {
			t.Fatalf("Desktop signature payload is missing %s", field)
		}
	}

	bridge := readFile(t, filepath.Join(root, "internal", "desktopbridge", "server.go"))
	if !strings.Contains(bridge, "X-Redeven-Gateway-Managed-Bridge-Token") {
		t.Fatal("Desktop bridge server must inject the managed Gateway bridge token header")
	}
	client := readFile(t, filepath.Join(root, "desktop", "src", "main", "gatewayClient.ts"))
	if strings.Contains(client, "X-Redeven-Gateway-Managed-Bridge-Token") {
		t.Fatal("Desktop Gateway client must not write the managed bridge token header directly")
	}
}

func requireSecurity(t *testing.T, contract openAPIContract, path string, schemes []string) {
	t.Helper()
	operation := postOperation(t, contract, path)
	if len(operation.Security) != 1 {
		t.Fatalf("%s security requirement count = %d, want 1", path, len(operation.Security))
	}
	assertSameStrings(t, path+" security schemes", keys(operation.Security[0]), schemes)
}

func assertRequestResponseEnvelopes(t *testing.T, contract openAPIContract) {
	t.Helper()
	expected := map[string]struct {
		request  string
		envelope string
		response string
	}{
		"/gateway/v1/pairing/challenge":   {"PairingChallengeRequest", "PairingChallengeEnvelope", "PairingChallengeResponse"},
		"/gateway/v1/pairing/complete":    {"PairingCompleteRequest", "PairingCompleteEnvelope", "PairingCompleteResponse"},
		"/gateway/v1/catalog":             {"CatalogRequest", "CatalogEnvelope", "CatalogResponse"},
		"/gateway/v1/open-session":        {"OpenSessionRequest", "OpenSessionEnvelope", "OpenSessionResponse"},
		"/gateway/v1/env-profiles/upsert": {"EnvProfileUpsertRequest", "EnvProfileUpsertEnvelope", "EnvProfileUpsertResponse"},
		"/gateway/v1/env-profiles/delete": {"EnvProfileDeleteRequest", "EnvProfileDeleteEnvelope", "EnvProfileDeleteResponse"},
		"/gateway/v1/env-lifecycle":       {"EnvLifecycleRequest", "EnvLifecycleEnvelope", "EnvLifecycleResponse"},
	}
	for path, want := range expected {
		operation := postOperation(t, contract, path)
		if !operation.RequestBody.Required {
			t.Fatalf("%s requestBody.required = false, want true", path)
		}
		assertSchemaRef(t, requestSchema(t, operation), want.request)
		assertSchemaRef(t, responseSchema(t, operation.Responses["200"]), want.envelope)
		if operation.Responses["default"].Ref != "#/components/responses/GatewayError" {
			t.Fatalf("%s default response ref = %q, want GatewayError", path, operation.Responses["default"].Ref)
		}
		envelope := schemaByName(t, contract, want.envelope)
		assertRequired(t, want.envelope, envelope, "ok", "data")
		if ok := envelope.Properties["ok"]; ok.Type != "boolean" || ok.Const != true {
			t.Fatalf("%s.ok schema = {type:%q const:%v}, want true boolean", want.envelope, ok.Type, ok.Const)
		}
		assertSchemaRef(t, envelope.Properties["data"], want.response)
	}

	errorEnvelope := schemaByName(t, contract, "GatewayErrorEnvelope")
	assertRequired(t, "GatewayErrorEnvelope", errorEnvelope, "ok", "error")
	if ok := errorEnvelope.Properties["ok"]; ok.Type != "boolean" || ok.Const != false {
		t.Fatalf("GatewayErrorEnvelope.ok schema = {type:%q const:%v}, want false boolean", ok.Type, ok.Const)
	}
	assertSchemaRef(t, errorEnvelope.Properties["error"], "GatewayErrorShape")
}

func assertObjectSchemasClosed(t *testing.T, contract openAPIContract) {
	t.Helper()
	for name, schema := range contract.Components.Schemas {
		if schema.Type != "object" {
			continue
		}
		if closed, ok := schema.AdditionalProperties.(bool); !ok || closed {
			t.Fatalf("%s additionalProperties = %#v, want false because Gateway JSON decoding rejects unknown fields", name, schema.AdditionalProperties)
		}
	}
}

func assertGatewayEnums(t *testing.T, contract openAPIContract) {
	t.Helper()
	assertEnum(t, contract, "GatewayCapability", constants(
		GatewayCapabilityEnvCatalog,
		GatewayCapabilityEnvOpenSession,
		GatewayCapabilityEnvProfileWrite,
		GatewayCapabilityEnvLifecycle,
		GatewayCapabilityTerminal,
		GatewayCapabilityFiles,
		GatewayCapabilityWebService,
		GatewayCapabilityPortForward,
	))
	assertEnum(t, contract, "EnvironmentKind", constants(EnvironmentKindManagedLocalEnv, EnvironmentKindReachableEnv))
	assertEnum(t, contract, "EnvironmentState", constants(
		EnvironmentStateUnknown,
		EnvironmentStateAvailable,
		EnvironmentStateStarting,
		EnvironmentStateStopped,
		EnvironmentStateArchived,
	))
	assertEnum(t, contract, "EnvironmentCapability", constants(
		EnvironmentCapabilityOpen,
		EnvironmentCapabilityStart,
		EnvironmentCapabilityStop,
		EnvironmentCapabilityRestart,
		EnvironmentCapabilityUpdateRuntime,
		EnvironmentCapabilityTerminal,
		EnvironmentCapabilityFiles,
		EnvironmentCapabilityWebService,
		EnvironmentCapabilityPortForward,
	))
	assertEnum(t, contract, "EnvironmentOriginKind", constants(
		EnvironmentOriginKindGatewayHost,
		EnvironmentOriginKindSSHTarget,
		EnvironmentOriginKindContainer,
		EnvironmentOriginKindNetworkTarget,
	))
	assertEnum(t, contract, "RequestedCapability", constants(
		RequestedCapabilityEnvApp,
		RequestedCapabilityTerminal,
		RequestedCapabilityFiles,
		RequestedCapabilityWebService,
		RequestedCapabilityPortForward,
	))
	assertEnum(t, contract, "EnvProfileAccessRouteKind", constants(
		EnvProfileAccessRouteKindURL,
		EnvProfileAccessRouteKindSSHHost,
		EnvProfileAccessRouteKindSSHContainer,
	))
	assertEnum(t, contract, "EnvProfileControlOwner", constants(EnvProfileControlOwnerNone, EnvProfileControlOwnerGateway))
	assertEnum(t, contract, "EnvLifecycleOperation", constants(
		EnvLifecycleOperationStart,
		EnvLifecycleOperationStop,
		EnvLifecycleOperationRestart,
		EnvLifecycleOperationUpdateRuntime,
	))
	assertEnum(t, contract, "EnvLifecycleState", constants(
		EnvLifecycleStateAccepted,
		EnvLifecycleStateRunning,
		EnvLifecycleStateSucceeded,
		EnvLifecycleStateFailed,
		EnvLifecycleStateUnsupported,
	))
	assertEnum(t, contract, "GatewayErrorCode", constants(
		GatewayErrorCodeInvalidRequest,
		GatewayErrorCodeUnauthorized,
		GatewayErrorCodeTrustChanged,
		GatewayErrorCodeNotFound,
		GatewayErrorCodeCapabilityUnsupported,
		GatewayErrorCodeUnavailable,
		GatewayErrorCodeNotImplemented,
	))
	assertEnum(t, contract, "GatewayStatus", constants(
		GatewayStatusOnline,
		GatewayStatusPairingRequired,
		GatewayStatusTrustChanged,
		GatewayStatusError,
		GatewayStatusUnknown,
	))
	if _, ok := contract.Components.Schemas["EnvProfileSSHSecret"]; ok {
		t.Fatal("Gateway v1 OpenAPI must not expose ssh_secret until SSH password auth is implemented")
	}
}

func assertRequiredWireFields(t *testing.T, contract openAPIContract) {
	t.Helper()
	required := map[string][]string{
		"CatalogRequest":                    {"protocol_version"},
		"CatalogResponse":                   {"protocol_version", "gateway", "environments"},
		"GatewayMetadata":                   {"gateway_id", "display_name", "status", "capabilities"},
		"Environment":                       {"gateway_env_id", "display_name", "env_kind", "state", "capabilities", "access_capabilities", "control_capabilities", "origin"},
		"EnvironmentProfile":                {"managed", "access_route_kind"},
		"EnvironmentOrigin":                 {"kind", "label"},
		"PairingChallengeRequest":           {"protocol_version", "client_nonce", "client_public_key", "binding_audience"},
		"PairingChallengeResponse":          {"protocol_version", "gateway_id", "gateway_public_key", "gateway_public_key_fingerprint", "gateway_nonce", "expires_at_unix_ms", "signature"},
		"PairingCompleteRequest":            {"protocol_version", "client_nonce", "gateway_nonce", "gateway_id", "binding_audience", "client_key_id", "proof"},
		"PairingCompleteResponse":           {"protocol_version", "gateway_id", "client_key_id", "paired_at_unix_ms", "proof"},
		"OpenSessionRequest":                {"protocol_version", "gateway_env_id", "requested_capability", "client_nonce"},
		"OpenSessionResponse":               {"protocol_version", "gateway_session_id", "gateway_env_id", "connect_artifact"},
		"DiagnosticsHint":                   {"gateway_env_id", "connection_kind"},
		"EnvProfileUpsertRequest":           {"protocol_version", "profile"},
		"EnvProfileInput":                   {"display_name", "access_route"},
		"EnvProfileURLAccessRoute":          {"kind", "url"},
		"EnvProfileSSHHostAccessRoute":      {"kind", "ssh_destination"},
		"EnvProfileSSHContainerAccessRoute": {"kind", "ssh_destination", "container_engine", "container_id", "container_runtime_root"},
		"EnvProfileUpsertResponse":          {"protocol_version", "environment"},
		"EnvProfileDeleteRequest":           {"protocol_version", "gateway_env_id"},
		"EnvProfileDeleteResponse":          {"protocol_version", "gateway_env_id", "deleted"},
		"EnvLifecycleRequest":               {"protocol_version", "gateway_env_id", "operation"},
		"EnvLifecycleResponse":              {"protocol_version", "gateway_env_id", "operation", "state"},
		"GatewayErrorShape":                 {"code", "message"},
	}
	for name, fields := range required {
		assertRequired(t, name, schemaByName(t, contract, name), fields...)
	}
}

func assertProfileAccessRouteSchemas(t *testing.T, contract openAPIContract) {
	t.Helper()
	route := schemaByName(t, contract, "EnvProfileAccessRoute")
	if len(route.OneOf) != 3 {
		t.Fatalf("EnvProfileAccessRoute oneOf count = %d, want 3", len(route.OneOf))
	}
	assertSchemaRef(t, route.OneOf[0], "EnvProfileURLAccessRoute")
	assertSchemaRef(t, route.OneOf[1], "EnvProfileSSHHostAccessRoute")
	assertSchemaRef(t, route.OneOf[2], "EnvProfileSSHContainerAccessRoute")
	if kind := schemaByName(t, contract, "EnvProfileURLAccessRoute").Properties["kind"]; kind.Const != string(EnvProfileAccessRouteKindURL) {
		t.Fatalf("EnvProfileURLAccessRoute.kind const = %v, want %q", kind.Const, EnvProfileAccessRouteKindURL)
	}
	if kind := schemaByName(t, contract, "EnvProfileSSHHostAccessRoute").Properties["kind"]; kind.Const != string(EnvProfileAccessRouteKindSSHHost) {
		t.Fatalf("EnvProfileSSHHostAccessRoute.kind const = %v, want %q", kind.Const, EnvProfileAccessRouteKindSSHHost)
	}
	assertSameStrings(t, "ssh_host auth_mode enum", schemaByName(t, contract, "EnvProfileSSHHostAccessRoute").Properties["auth_mode"].Enum, []string{"key_agent"})
	container := schemaByName(t, contract, "EnvProfileSSHContainerAccessRoute")
	if kind := container.Properties["kind"]; kind.Const != string(EnvProfileAccessRouteKindSSHContainer) {
		t.Fatalf("EnvProfileSSHContainerAccessRoute.kind const = %v, want %q", kind.Const, EnvProfileAccessRouteKindSSHContainer)
	}
	assertSameStrings(t, "ssh_container auth_mode enum", container.Properties["auth_mode"].Enum, []string{"key_agent"})
	assertSameStrings(t, "container_engine enum", container.Properties["container_engine"].Enum, []string{"docker", "podman"})
}

func assertConnectArtifactSchemas(t *testing.T, contract openAPIContract) {
	t.Helper()
	artifact := schemaByName(t, contract, "GatewayConnectArtifact")
	if len(artifact.OneOf) != 2 {
		t.Fatalf("GatewayConnectArtifact oneOf count = %d, want 2", len(artifact.OneOf))
	}
	assertSchemaRef(t, artifact.OneOf[0], "LocalDirectConnectArtifact")
	assertSchemaRef(t, artifact.OneOf[1], "DesktopBridgeConnectArtifact")

	local := schemaByName(t, contract, "LocalDirectConnectArtifact")
	assertRequired(t, "LocalDirectConnectArtifact", local, "kind", "url", "expires_at_unix_ms", "artifact_nonce", "proof")
	if kind := local.Properties["kind"]; kind.Const != string(ConnectArtifactKindLocalDirect) {
		t.Fatalf("LocalDirectConnectArtifact.kind const = %v, want %q", kind.Const, ConnectArtifactKindLocalDirect)
	}
	bridge := schemaByName(t, contract, "DesktopBridgeConnectArtifact")
	assertRequired(t, "DesktopBridgeConnectArtifact", bridge, "kind", "bridge_session_id", "route_id", "expires_at_unix_ms", "artifact_nonce", "proof")
	if kind := bridge.Properties["kind"]; kind.Const != string(ConnectArtifactKindDesktopBridge) {
		t.Fatalf("DesktopBridgeConnectArtifact.kind const = %v, want %q", kind.Const, ConnectArtifactKindDesktopBridge)
	}
}

func postOperation(t *testing.T, contract openAPIContract, path string) openAPIOperation {
	t.Helper()
	item, ok := contract.Paths[path]
	if !ok {
		t.Fatalf("missing path %s", path)
	}
	operation, ok := item["post"]
	if !ok {
		t.Fatalf("%s missing post operation", path)
	}
	return operation
}

func requestSchema(t *testing.T, operation openAPIOperation) openAPISchema {
	t.Helper()
	media, ok := operation.RequestBody.Content["application/json"]
	if !ok {
		t.Fatalf("%s request body content missing application/json", operation.OperationID)
	}
	return media.Schema
}

func responseSchema(t *testing.T, response openAPIResponse) openAPISchema {
	t.Helper()
	media, ok := response.Content["application/json"]
	if !ok {
		t.Fatal("response content missing application/json")
	}
	return media.Schema
}

func schemaByName(t *testing.T, contract openAPIContract, name string) openAPISchema {
	t.Helper()
	schema, ok := contract.Components.Schemas[name]
	if !ok {
		t.Fatalf("missing schema %s", name)
	}
	return schema
}

func assertSchemaRef(t *testing.T, schema openAPISchema, name string) {
	t.Helper()
	want := "#/components/schemas/" + name
	if schema.Ref != want {
		t.Fatalf("schema ref = %q, want %q", schema.Ref, want)
	}
}

func assertEnum(t *testing.T, contract openAPIContract, schemaName string, want []string) {
	t.Helper()
	schema := schemaByName(t, contract, schemaName)
	if schema.Type != "string" {
		t.Fatalf("%s type = %q, want string", schemaName, schema.Type)
	}
	assertSameStrings(t, schemaName+" enum", schema.Enum, want)
}

func assertRequired(t *testing.T, schemaName string, schema openAPISchema, fields ...string) {
	t.Helper()
	assertSameStrings(t, schemaName+" required", schema.Required, fields)
}

func uniqueSubmatches(re *regexp.Regexp, content string) []string {
	matches := re.FindAllStringSubmatch(content, -1)
	out := make([]string, 0, len(matches))
	seen := map[string]struct{}{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		if _, ok := seen[match[1]]; ok {
			continue
		}
		seen[match[1]] = struct{}{}
		out = append(out, match[1])
	}
	sort.Strings(out)
	return out
}

func constants[T ~string](values ...T) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, string(value))
	}
	return out
}

func keys[M ~map[string]V, V any](m M) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func assertSameStrings(t *testing.T, label string, got []string, want []string) {
	t.Helper()
	got = append([]string(nil), got...)
	want = append([]string(nil), want...)
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s = %#v, want %#v", label, got, want)
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(content)
}

func assertNoRepositorySubstring(t *testing.T, root string, forbidden []string) {
	t.Helper()
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			switch name {
			case ".git", "node_modules", "dist":
				return filepath.SkipDir
			}
			if strings.HasPrefix(name, ".") && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if !gatewayNamingBoundaryTextFile(name) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if filepath.ToSlash(rel) == "internal/runtimegateway/protocol/openapi_contract_test.go" {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(content)
		for _, needle := range forbidden {
			if strings.Contains(text, needle) {
				t.Fatalf("%s contains forbidden non-runtime Gateway naming %q", filepath.ToSlash(rel), needle)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan Gateway naming boundary: %v", err)
	}
}

func gatewayNamingBoundaryTextFile(name string) bool {
	switch filepath.Ext(name) {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".yaml", ".yml":
		return true
	default:
		return name == "README" || name == "AGENTS"
	}
}
