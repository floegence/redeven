package containers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func TestBuildStartPreflightPlan_RedactsSensitiveDataAndFlagsRisks(t *testing.T) {
	t.Parallel()

	plan, err := BuildStartPreflightPlan(StartPreflightInput{
		Engine:        EngineDocker,
		ContainerID:   "container_123",
		ContainerName: "api",
		Image: ImageInput{
			Reference: "ghcr.io/acme/api:latest",
			Digest:    "sha256:0123456789abcdef",
		},
		Runtime: RuntimeInput{
			Privileged:    true,
			NetworkMode:   "host",
			PIDMode:       "host",
			IPCMode:       "host",
			RestartPolicy: "always",
			Env: []string{
				"API_TOKEN=raw-secret-token",
				"PATH=/usr/bin",
			},
			Labels: map[string]string{
				"redeven.secret": "raw-secret-label",
				"owner":          "containers",
			},
			Mounts: []MountInput{
				{
					Type:   MountTypeBind,
					Source: "/Users/alice/private/secrets",
					Target: "/run/secrets/password",
				},
				{
					Type:   MountTypeBind,
					Source: "/var/run/docker.sock",
					Target: "/var/run/docker.sock",
				},
			},
			Devices: []DeviceInput{
				{
					HostPath:      "/dev/kvm",
					ContainerPath: "/dev/kvm",
					Permissions:   "rwm",
				},
			},
			CapAdd: []string{"sys_admin", "NET_ADMIN", "sys_admin"},
		},
	})
	if err != nil {
		t.Fatalf("BuildStartPreflightPlan() error = %v", err)
	}

	if plan.SchemaVersion != SchemaVersion || plan.CapabilityID != CapabilityID || plan.CapabilityVersion != CapabilityVersion {
		t.Fatalf("plan contract identity = (%q, %q, %q)", plan.SchemaVersion, plan.CapabilityID, plan.CapabilityVersion)
	}
	if plan.Method != MethodStart {
		t.Fatalf("plan method = %q, want %q", plan.Method, MethodStart)
	}
	if plan.RiskLevel != RiskLevelCritical {
		t.Fatalf("risk level = %q, want %q", plan.RiskLevel, RiskLevelCritical)
	}
	if !plan.RequiresAdmin {
		t.Fatal("requires_admin = false, want true")
	}
	if plan.Runtime.Env.Total != 2 || plan.Runtime.Env.SecretLikeCount != 1 || plan.Runtime.Env.PlainCount != 1 {
		t.Fatalf("env summary = %+v", plan.Runtime.Env)
	}
	if plan.Runtime.Labels.Total != 2 || plan.Runtime.Labels.SecretLikeCount != 1 || plan.Runtime.Labels.PlainCount != 1 {
		t.Fatalf("label summary = %+v", plan.Runtime.Labels)
	}
	assertRiskIDs(t, plan.RiskFlags, []string{
		"added_linux_capability",
		"container_privileged",
		"container_socket_mount",
		"host_bind_mount",
		"host_device",
		"host_ipc_namespace",
		"host_network",
		"host_pid_namespace",
		"persistent_restart_policy",
		"secret_environment",
		"secret_labels",
		"sensitive_mount_path",
	})
	if !strings.HasPrefix(plan.Target.TargetHash, "sha256:") {
		t.Fatalf("target hash = %q", plan.Target.TargetHash)
	}

	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("marshal plan: %v", err)
	}
	body := string(raw)
	for _, forbidden := range []string{
		"raw-secret-token",
		"raw-secret-label",
		"/Users/alice/private/secrets",
		"/run/secrets/password",
		"API_TOKEN",
		"redeven.secret",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("plan leaked sensitive value %q in %s", forbidden, body)
		}
	}
	if !strings.Contains(body, redactedSensitivePath) {
		t.Fatalf("plan does not expose redacted sensitive path marker: %s", body)
	}
}

func TestBuildStartPreflightPlan_StableCanonicalSummaries(t *testing.T) {
	t.Parallel()

	base := StartPreflightInput{
		Engine:      EnginePodman,
		ContainerID: "container_abc",
		Image: ImageInput{
			Reference: "registry.example.test/app:latest",
		},
		Runtime: RuntimeInput{
			Env:    []string{"PATH=/usr/bin", "SECRET_KEY=value"},
			CapAdd: []string{"net_admin", "SYS_ADMIN"},
			Mounts: []MountInput{
				{Type: MountTypeBind, Source: "/work", Target: "/work", ReadOnly: true},
				{Type: MountTypeVolume, Source: "cache", Target: "/cache"},
			},
		},
	}
	reordered := base
	reordered.Runtime.Env = []string{"SECRET_KEY=value", "PATH=/usr/bin"}
	reordered.Runtime.CapAdd = []string{"SYS_ADMIN", "net_admin", "SYS_ADMIN"}
	reordered.Runtime.Mounts = []MountInput{
		{Type: MountTypeVolume, Source: "cache", Target: "/cache"},
		{Type: MountTypeBind, Source: "/work", Target: "/work", ReadOnly: true},
	}

	first, err := BuildStartPreflightPlan(base)
	if err != nil {
		t.Fatalf("first BuildStartPreflightPlan() error = %v", err)
	}
	second, err := BuildStartPreflightPlan(reordered)
	if err != nil {
		t.Fatalf("second BuildStartPreflightPlan() error = %v", err)
	}

	if first.Target.TargetHash != second.Target.TargetHash {
		t.Fatalf("target hash changed across order-only input changes: %q vs %q", first.Target.TargetHash, second.Target.TargetHash)
	}
	if !reflect.DeepEqual(first.Runtime.CapAdd, []string{"NET_ADMIN", "SYS_ADMIN"}) {
		t.Fatalf("cap_add = %#v", first.Runtime.CapAdd)
	}
	if !reflect.DeepEqual(first.Runtime.CapAdd, second.Runtime.CapAdd) {
		t.Fatalf("cap_add ordering drift: %#v vs %#v", first.Runtime.CapAdd, second.Runtime.CapAdd)
	}
	if !reflect.DeepEqual(first.Runtime.Mounts, second.Runtime.Mounts) {
		t.Fatalf("mount summaries drift: %#v vs %#v", first.Runtime.Mounts, second.Runtime.Mounts)
	}
}

func TestBuildStartPreflightPlan_RejectsInvalidInput(t *testing.T) {
	t.Parallel()

	if _, err := BuildStartPreflightPlan(StartPreflightInput{Engine: Engine("containerd"), ContainerID: "c"}); err == nil {
		t.Fatal("invalid engine accepted")
	}
	if _, err := BuildStartPreflightPlan(StartPreflightInput{Engine: EngineDocker}); err == nil {
		t.Fatal("empty container_id accepted")
	}
}

func TestContainerResourcesSchemaContract(t *testing.T) {
	t.Parallel()

	schema := readCapabilitySchema(t)
	defs := schemaMap(t, schema, "$defs")
	assertSchemaConst(t, schemaMap(t, defs, "schema_version"), SchemaVersion)
	assertSchemaConst(t, schemaMap(t, defs, "capability_id"), CapabilityID)
	assertSchemaConst(t, schemaMap(t, defs, "capability_version"), CapabilityVersion)
	assertStringEnum(t, schemaMap(t, defs, "engine"), []string{string(EngineDocker), string(EnginePodman)})
	assertStringEnum(t, schemaMap(t, defs, "method"), methodStrings(Methods()))
	statusRequestProps := schemaMap(t, schemaMap(t, defs, "status_request"), "properties")
	if _, ok := statusRequestProps["engine"]; !ok {
		t.Fatal("status_request schema must expose optional engine")
	}

	plan := schemaMap(t, defs, "start_preflight_plan")
	props := schemaMap(t, plan, "properties")
	assertSchemaConst(t, schemaMap(t, props, "method"), string(MethodStart))

	required := stringSlice(t, plan["required"])
	sort.Strings(required)
	wantRequired := []string{
		"capability_id",
		"capability_version",
		"image",
		"method",
		"request",
		"requires_admin",
		"risk_flags",
		"risk_level",
		"runtime",
		"schema_version",
		"target",
	}
	if !reflect.DeepEqual(required, wantRequired) {
		t.Fatalf("start_preflight_plan required = %#v, want %#v", required, wantRequired)
	}
	assertJSONTagsCovered(t, reflect.TypeOf(StartPreflightPlan{}), props)
}

func TestContainerResourcesSchemaObjectsAreClosed(t *testing.T) {
	t.Parallel()

	schema := readCapabilitySchema(t)
	assertClosedObjectSchemas(t, "$", schema)
}

func assertRiskIDs(t *testing.T, risks []RiskFlag, want []string) {
	t.Helper()
	got := make([]string, 0, len(risks))
	for _, risk := range risks {
		got = append(got, risk.ID)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("risk ids = %#v, want %#v", got, want)
	}
}

func readCapabilitySchema(t *testing.T) map[string]any {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "..", "spec", "capabilities", "container-resources-v1.schema.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	return schema
}

func schemaMap(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	child, ok := parent[key].(map[string]any)
	if !ok {
		t.Fatalf("schema[%q] = %#v, want object", key, parent[key])
	}
	return child
}

func assertSchemaConst(t *testing.T, schema map[string]any, want string) {
	t.Helper()
	if got := strings.TrimSpace(toString(t, schema["const"])); got != want {
		t.Fatalf("schema const = %q, want %q", got, want)
	}
}

func assertStringEnum(t *testing.T, schema map[string]any, want []string) {
	t.Helper()
	got := stringSlice(t, schema["enum"])
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("schema enum = %#v, want %#v", got, want)
	}
}

func methodStrings(methods []Method) []string {
	out := make([]string, 0, len(methods))
	for _, method := range methods {
		out = append(out, string(method))
	}
	return out
}

func stringSlice(t *testing.T, value any) []string {
	t.Helper()
	raw, ok := value.([]any)
	if !ok {
		t.Fatalf("value = %#v, want array", value)
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		out = append(out, toString(t, item))
	}
	return out
}

func toString(t *testing.T, value any) string {
	t.Helper()
	out, ok := value.(string)
	if !ok {
		t.Fatalf("value = %#v, want string", value)
	}
	return strings.TrimSpace(out)
}

func assertJSONTagsCovered(t *testing.T, typ reflect.Type, props map[string]any) {
	t.Helper()
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name == "" || name == "-" {
			continue
		}
		if _, ok := props[name]; !ok {
			t.Fatalf("%s.%s json tag %q missing from schema properties", typ.Name(), field.Name, name)
		}
	}
}

func assertClosedObjectSchemas(t *testing.T, path string, node any) {
	t.Helper()
	schema, ok := node.(map[string]any)
	if !ok {
		return
	}
	if schema["type"] == "object" {
		if got, ok := schema["additionalProperties"].(bool); !ok || got {
			t.Fatalf("%s additionalProperties = %#v, want false", path, schema["additionalProperties"])
		}
	}
	for key, value := range schema {
		switch key {
		case "$defs", "properties":
			children, ok := value.(map[string]any)
			if !ok {
				t.Fatalf("%s.%s = %#v, want object map", path, key, value)
			}
			for name, child := range children {
				assertClosedObjectSchemas(t, path+"."+key+"."+name, child)
			}
		case "items":
			assertClosedObjectSchemas(t, path+".items", value)
		case "oneOf":
			children, ok := value.([]any)
			if !ok {
				t.Fatalf("%s.oneOf = %#v, want array", path, value)
			}
			for i, child := range children {
				assertClosedObjectSchemas(t, fmt.Sprintf("%s.oneOf.%d", path, i), child)
			}
		}
	}
}
