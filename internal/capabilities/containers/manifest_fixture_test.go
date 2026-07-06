package containers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"
)

const containersIntegrationBindingID = "container_runtime"

type containersIntegrationManifest struct {
	SchemaVersion      string                         `json:"schema_version"`
	Publisher          map[string]any                 `json:"publisher"`
	Plugin             containersIntegrationPlugin    `json:"plugin"`
	Surfaces           []containersIntegrationSurface `json:"surfaces"`
	CapabilityBindings []containersCapabilityBinding  `json:"capability_bindings"`
	Methods            []containersManifestMethod     `json:"methods"`
	Intents            []containersManifestIntent     `json:"intents"`
}

type containersIntegrationPlugin struct {
	PluginID          string `json:"plugin_id"`
	DisplayName       string `json:"display_name"`
	Version           string `json:"version"`
	APIVersion        string `json:"api_version"`
	MinRuntimeVersion string `json:"min_runtime_version"`
	UIProtocolVersion string `json:"ui_protocol_version"`
}

type containersIntegrationSurface struct {
	SurfaceID string `json:"surface_id"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Entry     string `json:"entry"`
	Method    string `json:"method"`
}

type containersCapabilityBinding struct {
	BindingID            string   `json:"binding_id"`
	CapabilityID         string   `json:"capability_id"`
	MinCapabilityVersion string   `json:"min_capability_version"`
	RequiredPermissions  []string `json:"required_permissions"`
}

type containersManifestMethod struct {
	Method         string                          `json:"method"`
	Effect         string                          `json:"effect"`
	Execution      string                          `json:"execution"`
	Dangerous      bool                            `json:"dangerous"`
	PreflightOnly  bool                            `json:"preflight_only"`
	Route          containersManifestRoute         `json:"route"`
	Confirmation   *containersManifestConfirmation `json:"confirmation"`
	CancelPolicy   *containersManifestCancelPolicy `json:"cancel_policy"`
	RequestSchema  map[string]any                  `json:"request_schema"`
	ResponseSchema map[string]any                  `json:"response_schema"`
}

type containersManifestRoute struct {
	Kind         string `json:"kind"`
	BindingID    string `json:"binding_id"`
	TargetMethod string `json:"target_method"`
}

type containersManifestConfirmation struct {
	Mode              string   `json:"mode"`
	PreflightMethod   string   `json:"preflight_method"`
	RequestHashFields []string `json:"request_hash_fields"`
	PlanHashRequired  bool     `json:"plan_hash_required"`
}

type containersManifestCancelPolicy struct {
	Cancelable        bool   `json:"cancelable"`
	DisableBehavior   string `json:"disable_behavior"`
	UninstallBehavior string `json:"uninstall_behavior"`
	AckTimeoutMs      int    `json:"ack_timeout_ms"`
}

type containersManifestIntent struct {
	IntentID string         `json:"intent_id"`
	Method   string         `json:"method"`
	Payload  map[string]any `json:"payload_schema"`
}

type containersMethodExpectation struct {
	effect           string
	execution        string
	dangerous        bool
	preflightOnly    bool
	requestRequired  []string
	requestFields    []string
	responseRequired []string
	responseFields   []string
	confirmation     *containersConfirmationExpectation
	cancelPolicy     *containersCancelPolicyExpectation
	responseMethod   Method
}

type containersConfirmationExpectation struct {
	mode              string
	preflightMethod   Method
	requestHashFields []string
	planHashRequired  bool
}

type containersCancelPolicyExpectation struct {
	disableBehavior   string
	uninstallBehavior string
}

func TestContainersIntegrationManifestFixtureBindsCapability(t *testing.T) {
	t.Parallel()

	manifest := readContainersIntegrationManifest(t)
	if manifest.SchemaVersion != "redevplugin.manifest.v1" {
		t.Fatalf("schema_version = %q", manifest.SchemaVersion)
	}
	if manifest.Plugin.PluginID != "com.redeven.official.containers" ||
		manifest.Plugin.APIVersion != "plugin-v1" ||
		manifest.Plugin.UIProtocolVersion != "plugin-ui-v1" {
		t.Fatalf("plugin identity = %+v", manifest.Plugin)
	}
	if len(manifest.Surfaces) != 1 {
		t.Fatalf("surfaces = %d, want 1", len(manifest.Surfaces))
	}
	if surface := manifest.Surfaces[0]; surface.Method != string(MethodList) || surface.Kind != "activity" {
		t.Fatalf("surface = %+v", surface)
	}

	if len(manifest.CapabilityBindings) != 1 {
		t.Fatalf("capability_bindings = %d, want 1", len(manifest.CapabilityBindings))
	}
	binding := manifest.CapabilityBindings[0]
	if binding.BindingID != containersIntegrationBindingID ||
		binding.CapabilityID != CapabilityID ||
		binding.MinCapabilityVersion != CapabilityVersion {
		t.Fatalf("capability binding = %+v", binding)
	}
	assertSortedStrings(t, "required_permissions", binding.RequiredPermissions, []string{"delete", "execute", "read", "write"})
}

func TestContainersIntegrationManifestFixtureMethodSet(t *testing.T) {
	t.Parallel()

	manifest := readContainersIntegrationManifest(t)
	methods := manifestMethodsByName(t, manifest)

	gotMethods := make([]string, 0, len(methods))
	for method := range methods {
		gotMethods = append(gotMethods, string(method))
	}
	assertSortedStrings(t, "manifest methods", gotMethods, methodStrings(Methods()))

	expectations := containersManifestExpectations()
	for _, method := range Methods() {
		fixture := methods[method]
		expectation, ok := expectations[method]
		if !ok {
			t.Fatalf("missing expectation for %s", method)
		}
		assertContainersManifestMethod(t, method, fixture, expectation)
	}
}

func TestContainersIntegrationManifestFixtureIntentsTargetPublicMethods(t *testing.T) {
	t.Parallel()

	manifest := readContainersIntegrationManifest(t)
	methods := manifestMethodsByName(t, manifest)
	if len(manifest.Intents) == 0 {
		t.Fatal("official containers fixture must expose at least one product intent")
	}
	for _, intent := range manifest.Intents {
		method := Method(intent.Method)
		if _, ok := methods[method]; !ok {
			t.Fatalf("intent %s targets unknown method %q", intent.IntentID, intent.Method)
		}
		assertManifestSchemaObject(t, "intent "+intent.IntentID+" payload_schema", intent.Payload)
	}
}

func containersManifestExpectations() map[Method]containersMethodExpectation {
	return map[Method]containersMethodExpectation{
		MethodStatus: {
			effect:           "read",
			execution:        "sync",
			requestRequired:  []string{"engine", "schema_version"},
			requestFields:    []string{"engine", "schema_version"},
			responseRequired: []string{"available", "capability_id", "capability_version", "engine", "schema_version"},
			responseFields:   []string{"available", "capability_id", "capability_version", "engine", "engine_version", "schema_version"},
		},
		MethodList: {
			effect:           "read",
			execution:        "sync",
			requestRequired:  []string{"engine", "schema_version"},
			requestFields:    []string{"all", "engine", "schema_version"},
			responseRequired: []string{"capability_id", "containers", "engine", "schema_version"},
			responseFields:   []string{"capability_id", "containers", "engine", "schema_version"},
		},
		MethodInspect: {
			effect:           "read",
			execution:        "sync",
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "schema_version"},
			responseRequired: []string{"capability_id", "container", "engine", "schema_version"},
			responseFields:   []string{"capability_id", "container", "engine", "schema_version"},
		},
		MethodStartPreflight: {
			effect:           "read",
			execution:        "sync",
			preflightOnly:    true,
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "schema_version"},
			responseRequired: []string{"capability_id", "capability_version", "image", "method", "request", "requires_admin", "risk_flags", "risk_level", "runtime", "schema_version", "target"},
			responseFields:   []string{"capability_id", "capability_version", "image", "method", "request", "requires_admin", "risk_flags", "risk_level", "runtime", "schema_version", "summary", "target"},
			responseMethod:   MethodStart,
		},
		MethodStart: {
			effect:           "execute",
			execution:        "operation",
			dangerous:        true,
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "schema_version"},
			responseRequired: []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseFields:   []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseMethod:   MethodStart,
			confirmation: &containersConfirmationExpectation{
				mode:              "risk_based",
				preflightMethod:   MethodStartPreflight,
				requestHashFields: []string{"schema_version", "engine", "container_id"},
				planHashRequired:  true,
			},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "cancel",
				uninstallBehavior: "cancel_then_block_delete",
			},
		},
		MethodStop: {
			effect:           "execute",
			execution:        "operation",
			dangerous:        true,
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "schema_version", "timeout_sec"},
			responseRequired: []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseFields:   []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseMethod:   MethodStop,
			confirmation: &containersConfirmationExpectation{
				mode:              "required",
				requestHashFields: []string{"schema_version", "engine", "container_id", "timeout_sec"},
			},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "cancel",
				uninstallBehavior: "cancel_then_block_delete",
			},
		},
		MethodRestart: {
			effect:           "execute",
			execution:        "operation",
			dangerous:        true,
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "schema_version", "timeout_sec"},
			responseRequired: []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseFields:   []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseMethod:   MethodRestart,
			confirmation: &containersConfirmationExpectation{
				mode:              "required",
				requestHashFields: []string{"schema_version", "engine", "container_id", "timeout_sec"},
			},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "cancel",
				uninstallBehavior: "cancel_then_block_delete",
			},
		},
		MethodRemove: {
			effect:           "delete",
			execution:        "operation",
			dangerous:        true,
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "force", "schema_version"},
			responseRequired: []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseFields:   []string{"capability_id", "capability_version", "completed", "container_id", "engine", "method", "schema_version"},
			responseMethod:   MethodRemove,
			confirmation: &containersConfirmationExpectation{
				mode:              "required",
				requestHashFields: []string{"schema_version", "engine", "container_id", "force"},
			},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "cancel",
				uninstallBehavior: "cancel_then_block_delete",
			},
		},
		MethodLogsTail: {
			effect:           "read",
			execution:        "subscription",
			requestRequired:  []string{"container_id", "engine", "schema_version"},
			requestFields:    []string{"container_id", "engine", "follow", "schema_version", "since_unix_ms", "tail_lines"},
			responseRequired: []string{"capability_id", "capability_version", "container_id", "engine", "schema_version", "stream_id", "stream_ticket"},
			responseFields:   []string{"capability_id", "capability_version", "container_id", "engine", "schema_version", "stream_id", "stream_ticket"},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "orphan",
				uninstallBehavior: "force_cleanup_allowed",
			},
		},
		MethodImagesPull: {
			effect:           "write",
			execution:        "operation",
			requestRequired:  []string{"engine", "image_ref", "schema_version"},
			requestFields:    []string{"engine", "image_ref", "schema_version"},
			responseRequired: []string{"capability_id", "capability_version", "completed", "engine", "image", "schema_version"},
			responseFields:   []string{"capability_id", "capability_version", "completed", "engine", "image", "schema_version"},
			cancelPolicy: &containersCancelPolicyExpectation{
				disableBehavior:   "cancel",
				uninstallBehavior: "cancel_then_block_delete",
			},
		},
	}
}

func assertContainersManifestMethod(t *testing.T, method Method, fixture containersManifestMethod, expectation containersMethodExpectation) {
	t.Helper()
	if fixture.Effect != expectation.effect || fixture.Execution != expectation.execution {
		t.Fatalf("%s effect/execution = %s/%s, want %s/%s", method, fixture.Effect, fixture.Execution, expectation.effect, expectation.execution)
	}
	if fixture.Dangerous != expectation.dangerous {
		t.Fatalf("%s dangerous = %v, want %v", method, fixture.Dangerous, expectation.dangerous)
	}
	if fixture.PreflightOnly != expectation.preflightOnly {
		t.Fatalf("%s preflight_only = %v, want %v", method, fixture.PreflightOnly, expectation.preflightOnly)
	}
	if fixture.Route.Kind != "capability" ||
		fixture.Route.BindingID != containersIntegrationBindingID ||
		fixture.Route.TargetMethod != string(method) {
		t.Fatalf("%s route = %+v", method, fixture.Route)
	}
	assertContainersConfirmation(t, method, fixture.Confirmation, expectation.confirmation)
	assertContainersCancelPolicy(t, method, fixture.CancelPolicy, expectation.cancelPolicy)
	assertContainersRequestSchema(t, method, fixture.RequestSchema, expectation.requestRequired, expectation.requestFields)
	assertContainersResponseSchema(t, method, fixture.ResponseSchema, expectation)
}

func assertContainersConfirmation(t *testing.T, method Method, got *containersManifestConfirmation, want *containersConfirmationExpectation) {
	t.Helper()
	if want == nil {
		if got != nil {
			t.Fatalf("%s confirmation = %+v, want nil", method, *got)
		}
		return
	}
	if got == nil {
		t.Fatalf("%s confirmation missing", method)
	}
	if got.Mode != want.mode ||
		got.PreflightMethod != string(want.preflightMethod) ||
		got.PlanHashRequired != want.planHashRequired ||
		!reflect.DeepEqual(got.RequestHashFields, want.requestHashFields) {
		t.Fatalf("%s confirmation = %+v, want %+v", method, *got, *want)
	}
}

func assertContainersCancelPolicy(t *testing.T, method Method, got *containersManifestCancelPolicy, want *containersCancelPolicyExpectation) {
	t.Helper()
	if want == nil {
		if got != nil {
			t.Fatalf("%s cancel_policy = %+v, want nil", method, *got)
		}
		return
	}
	if got == nil {
		t.Fatalf("%s cancel_policy missing", method)
	}
	if !got.Cancelable ||
		got.DisableBehavior != want.disableBehavior ||
		got.UninstallBehavior != want.uninstallBehavior ||
		got.AckTimeoutMs != 2000 {
		t.Fatalf("%s cancel_policy = %+v", method, *got)
	}
}

func assertContainersRequestSchema(t *testing.T, method Method, schema map[string]any, wantRequired []string, wantFields []string) {
	t.Helper()
	assertManifestSchemaObject(t, string(method)+" request_schema", schema)
	assertSchemaConst(t, schemaMap(t, schema, "properties")["schema_version"].(map[string]any), SchemaVersion)
	assertSortedStrings(t, string(method)+" request required", stringSlice(t, schema["required"]), wantRequired)
	props := schemaMap(t, schema, "properties")
	assertSortedStrings(t, string(method)+" request fields", mapKeys(props), wantFields)
	assertContainersCommonSchemaFields(t, method, props)
}

func assertContainersResponseSchema(t *testing.T, method Method, schema map[string]any, expectation containersMethodExpectation) {
	t.Helper()
	assertManifestSchemaObject(t, string(method)+" response_schema", schema)
	assertSortedStrings(t, string(method)+" response required", stringSlice(t, schema["required"]), expectation.responseRequired)
	props := schemaMap(t, schema, "properties")
	assertSortedStrings(t, string(method)+" response fields", mapKeys(props), expectation.responseFields)
	if schemaVersion, ok := props["schema_version"].(map[string]any); ok {
		assertSchemaConst(t, schemaVersion, SchemaVersion)
	}
	if capabilityID, ok := props["capability_id"].(map[string]any); ok {
		assertSchemaConst(t, capabilityID, CapabilityID)
	}
	if capabilityVersion, ok := props["capability_version"].(map[string]any); ok {
		assertSchemaConst(t, capabilityVersion, CapabilityVersion)
	}
	if engine, ok := props["engine"].(map[string]any); ok {
		assertStringEnum(t, engine, []string{string(EngineDocker), string(EnginePodman)})
	}
	if methodProp, ok := props["method"].(map[string]any); ok {
		wantMethod := method
		if expectation.responseMethod != "" {
			wantMethod = expectation.responseMethod
		}
		assertSchemaConst(t, methodProp, string(wantMethod))
	}
	switch method {
	case MethodList:
		containersItems := schemaMap(t, schemaMap(t, props, "containers"), "items")
		assertSortedStrings(t, string(method)+" response container required", stringSlice(t, containersItems["required"]), []string{"container_id"})
		assertContainersCommonSchemaFields(t, method, schemaMap(t, containersItems, "properties"))
	case MethodInspect:
		container := schemaMap(t, props, "container")
		assertSortedStrings(t, string(method)+" response container required", stringSlice(t, container["required"]), []string{"container_id"})
		assertContainersCommonSchemaFields(t, method, schemaMap(t, container, "properties"))
	}
}

func assertContainersCommonSchemaFields(t *testing.T, method Method, props map[string]any) {
	t.Helper()
	if engine, ok := props["engine"].(map[string]any); ok {
		assertStringEnum(t, engine, []string{string(EngineDocker), string(EnginePodman)})
	}
	for _, field := range []string{"container_id", "image_ref"} {
		if prop, ok := props[field].(map[string]any); ok {
			if got := toString(t, prop["type"]); got != "string" {
				t.Fatalf("%s %s type = %q, want string", method, field, got)
			}
			if got, ok := prop["minLength"].(float64); !ok || int(got) != 1 {
				t.Fatalf("%s %s minLength = %#v, want 1", method, field, prop["minLength"])
			}
		}
	}
	if tailLines, ok := props["tail_lines"].(map[string]any); ok {
		if got, ok := tailLines["maximum"].(float64); !ok || int(got) != maxLogTailLines {
			t.Fatalf("%s tail_lines maximum = %#v, want %d", method, tailLines["maximum"], maxLogTailLines)
		}
	}
}

func assertManifestSchemaObject(t *testing.T, label string, schema map[string]any) {
	t.Helper()
	if got := toString(t, schema["type"]); got != "object" {
		t.Fatalf("%s type = %q, want object", label, got)
	}
	if got, ok := schema["additionalProperties"].(bool); !ok || got {
		t.Fatalf("%s additionalProperties = %#v, want false", label, schema["additionalProperties"])
	}
}

func manifestMethodsByName(t *testing.T, manifest containersIntegrationManifest) map[Method]containersManifestMethod {
	t.Helper()
	methods := make(map[Method]containersManifestMethod, len(manifest.Methods))
	for _, fixture := range manifest.Methods {
		method := Method(fixture.Method)
		if _, ok := methods[method]; ok {
			t.Fatalf("duplicate manifest method %q", method)
		}
		methods[method] = fixture
	}
	return methods
}

func readContainersIntegrationManifest(t *testing.T) containersIntegrationManifest {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(filename), "testdata", "generated_plugins", "containers_integration", "manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read containers integration manifest: %v", err)
	}
	var manifest containersIntegrationManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse containers integration manifest: %v", err)
	}
	return manifest
}

func assertSortedStrings(t *testing.T, label string, got []string, want []string) {
	t.Helper()
	got = append([]string(nil), got...)
	want = append([]string(nil), want...)
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s = %#v, want %#v", label, got, want)
	}
}

func mapKeys(values map[string]any) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	return out
}
