package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v5/runtime"
	fltools "github.com/floegence/floret/v5/tools"
	"github.com/floegence/floret/v5/tools/webfetch"
)

func TestFloretNativeWebFetchDefinitionIsSingleSharedSurface(t *testing.T) {
	t.Parallel()

	var matches []ToolDef
	for _, def := range builtInToolDefinitions() {
		if def.Name == webfetch.ToolName {
			matches = append(matches, def)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("web_fetch definitions=%d, want 1", len(matches))
	}
	def := matches[0]
	if def.Source != "floret" || def.Namespace != "floret.web" || def.Visibility != ToolVisibilitySharedReadonly {
		t.Fatalf("web_fetch ownership=%+v", def)
	}
	var schema map[string]any
	if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	properties, _ := schema["properties"].(map[string]any)
	keys := make([]string, 0, len(properties))
	for key := range properties {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"format", "url"}) {
		t.Fatalf("web_fetch schema properties=%v", keys)
	}
	if def.Presentation.Renderer != string(fltools.ActivityRendererWebFetch) {
		t.Fatalf("web_fetch renderer=%q", def.Presentation.Renderer)
	}
}

func TestFloretNativeWebFetchPermissionResolvesForEveryProductMode(t *testing.T) {
	t.Parallel()

	def := floretNativeToolDefinitions()[0]
	for _, permissionType := range []FlowerPermissionType{FlowerPermissionReadonly, FlowerPermissionApprovalRequired, FlowerPermissionFullAccess} {
		permissionType := permissionType
		t.Run(permissionTypeString(permissionType), func(t *testing.T) {
			tool, ok := buildFloretNativeTool(def, PermissionSnapshot{PermissionType: permissionType})
			if !ok {
				t.Fatal("web_fetch native factory is missing")
			}
			if tool.Definition.Permission.Mode != fltools.PermissionAsk {
				t.Fatalf("base permission=%q, want ask", tool.Definition.Permission.Mode)
			}
			resolved, err := tool.Definition.PermissionFor(fltools.PermissionRequest{Name: webfetch.ToolName})
			if err != nil {
				t.Fatal(err)
			}
			if resolved.Mode != fltools.PermissionAllow || !slices.Equal(resolved.ResourceKinds, []string{"web_url"}) {
				t.Fatalf("resolved permission=%+v", resolved)
			}
		})
	}
}

func TestFloretNativeWebFetchEffectPolicyFailsClosedAfterSurfaceTightening(t *testing.T) {
	t.Parallel()

	def := floretNativeToolDefinitions()[0]
	admitted := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionFullAccess, []ToolDef{def}, nil),
		"endpoint", "thread", "run",
	)
	req := flruntime.EffectAuthorizationRequest{
		ToolName:   webfetch.ToolName,
		Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow, ResourceKinds: []string{"web_url"}},
	}
	if err := validateFloretEffectRequestAgainstSnapshot(req, admitted); err != nil {
		t.Fatalf("validate admitted web_fetch effect: %v", err)
	}

	tightened := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil),
		"endpoint", "thread", "run",
	)
	decision, err := floretEffectPolicyDecision(&run{}, tightened, webfetch.ToolName)
	if err != nil {
		t.Fatal(err)
	}
	if decision != ApprovalDecisionDeny {
		t.Fatalf("tightened decision=%q, want deny", decision)
	}
}

func TestWebFetchActivityProjectionKeepsPreviewAndDropsFullContent(t *testing.T) {
	t.Parallel()

	payload, ok := sanitizeActivityPayloadValue(map[string]any{
		"url": "https://example.test/start", "final_url": "https://example.test/final",
		"status_code": 200, "content_type": "text/html", "format": "markdown",
		"content_preview": "# Preview", "preview_truncated": true,
		"site_icon":  map[string]any{"content_type": "image/png", "data": "iVBORw0KGgo="},
		"bytes_read": 1024, "truncated": true, "content": "secret body", "body": "legacy body",
	}, fltools.ActivityRendererWebFetch, webfetch.ToolName)
	if !ok {
		t.Fatal("web_fetch Activity payload was rejected")
	}
	if payload["final_url"] != "https://example.test/final" || payload["status_code"] != 200 {
		t.Fatalf("web_fetch Activity metadata=%v", payload)
	}
	if payload["content_preview"] != "# Preview" || payload["preview_truncated"] != true {
		t.Fatalf("web_fetch Activity preview=%v", payload)
	}
	if _, exists := payload["site_icon"]; exists {
		t.Fatalf("web_fetch Activity retained deprecated page icon=%v", payload)
	}
	if _, exists := payload["content"]; exists {
		t.Fatal("web_fetch Activity exposed content")
	}
	if _, exists := payload["body"]; exists {
		t.Fatal("web_fetch Activity exposed legacy body")
	}
}

func TestWebFetchLegacyProductionPathStaysRemoved(t *testing.T) {
	t.Parallel()

	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test path")
	}
	packageDir := filepath.Dir(currentFile)
	if _, err := os.Stat(filepath.Join(packageDir, "readonly_web_fetch.go")); !os.IsNotExist(err) {
		t.Fatalf("legacy readonly_web_fetch.go must not exist: %v", err)
	}
	checks := map[string][]string{
		"run.go":                   {`case "web_fetch"`, "WebFetchHTTPClient", "WebFetchResolver"},
		"builtin_tool_handlers.go": {"timeout_seconds"},
		"floret_tools.go":          {`case "web_fetch"`},
	}
	for name, forbidden := range checks {
		raw, err := os.ReadFile(filepath.Join(packageDir, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, token := range forbidden {
			if strings.Contains(string(raw), token) {
				t.Fatalf("%s retains legacy web_fetch token %q", name, token)
			}
		}
	}
	effectSource, err := os.ReadFile(filepath.Join(packageDir, "floret_effect_authorization.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(effectSource), "if !isFloretNativeTool(req.ToolName)") {
		t.Fatal("Floret-native execution must not create a host-handler authorization entry")
	}
}
