package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/authoring"
	"github.com/floegence/redevplugin/v3/pkg/authorproject"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

// This qualification uses real platform Hosts and verified Web package bytes.
// The executable fixture is admission-only; no model or Worker is simulated.
func TestAuthorWorkspaceRealHostInstallRecoveryAndDeletion(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "author-channel", EndpointID: "author-env", UserPublicID: "author-user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, root)
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.PluginCreation = service
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	integration, err := New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if integration != nil {
			if e := integration.Close(); e != nil {
				t.Error(e)
			}
		}
	}()
	draft, err := service.Create(ctx, meta, "draft-request")
	if err != nil {
		t.Fatal(err)
	}
	authorCtx, owner, err := integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := integration.author.SourceScope(ctx, meta, draft.WorkspaceID)
	if err != nil || scope.PrivateRoot != filepath.Join(options.StateDir, "author-workspaces") {
		t.Fatalf("author source must not fence the entire product state root: %+v %v", scope, err)
	}
	if _, err = integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "initialize", map[string]any{"plugin_id": "github.repo.42.created", "display_name": "Created", "template": "web"}); err == nil {
		t.Fatal("generated identity accepted instead of the author slug")
	}
	if _, err = integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "initialize", map[string]any{"slug": "created", "display_name": "Created", "template": "web"}); err != nil {
		t.Fatal(err)
	}
	workspaceSource, err := integration.author.store.Get(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	sourceBytes, err := os.ReadFile(filepath.Join(workspaceSource.SourceDirectory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		Schema    string         `json:"schema_version"`
		Plugin    map[string]any `json:"plugin"`
		Publisher map[string]any `json:"publisher"`
	}
	if err := json.Unmarshal(sourceBytes, &source); err != nil {
		t.Fatal(err)
	}
	if source.Schema != "redevplugin.source.v1" || source.Plugin["slug"] != "created" || source.Plugin["plugin_id"] != nil || source.Publisher["publisher_id"] != nil {
		t.Fatalf("managed author source contains generated identity: %s", sourceBytes)
	}
	writeIcon := func(red uint8) {
		t.Helper()
		var imageBytes bytes.Buffer
		img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
		img.SetNRGBA(16, 16, color.NRGBA{R: red, A: 255})
		if err := png.Encode(&imageBytes, img); err != nil {
			t.Fatal(err)
		}
		for _, directory := range []string{workspaceSource.SourceDirectory, filepath.Join(workspaceSource.SourceDirectory, "dist")} {
			if err := os.MkdirAll(filepath.Join(directory, "ui/assets"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, "ui/assets/plugin-icon.png"), imageBytes.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(directory, "manifest.json")
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var document map[string]any
			if err := json.Unmarshal(raw, &document); err != nil {
				t.Fatal(err)
			}
			document["presentation"].(map[string]any)["icon"] = map[string]any{"path": "ui/assets/plugin-icon.png"}
			raw, _ = json.Marshal(document)
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	writeIcon(100)
	artifact, err := integration.author.store.Capture(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	call := func(action string, body any, csrf bool) *httptest.ResponseRecorder {
		t.Helper()
		raw, e := json.Marshal(body)
		if e != nil {
			t.Fatal(e)
		}
		req := httptest.NewRequest(http.MethodPost, authorPrefix+draft.WorkspaceID+"/"+action, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://env.example.test")
		req.Header.Set(sessionhop.HeaderChannelID, meta.ChannelID)
		if csrf {
			req.Header.Set(csrfHeader, csrfProof)
		}
		req = WithRouteRole(req, RouteRoleEnvTrusted)
		req, e = WithTrustedOrigin(req, "https://env.example.test")
		if e != nil {
			t.Fatal(e)
		}
		result := httptest.NewRecorder()
		integration.Handler().ServeHTTP(result, req)
		return result
	}
	requireOK := func(result *httptest.ResponseRecorder, target any) {
		t.Helper()
		if result.Code != 200 {
			t.Fatalf("HTTP %d: %s", result.Code, result.Body.String())
		}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if e := json.Unmarshal(result.Body.Bytes(), &envelope); e != nil {
			t.Fatal(e)
		}
		if target != nil {
			if e := json.Unmarshal(envelope.Data, target); e != nil {
				t.Fatal(e)
			}
		}
	}
	if response := call("apply", map[string]any{"artifact_id": artifact.ID}, false); response.Code != 403 {
		t.Fatalf("missing csrf: %d", response.Code)
	}
	originalUser := meta.UserPublicID
	meta.UserPublicID = "foreign"
	if response := call("apply", map[string]any{"artifact_id": artifact.ID}, true); response.Code != 404 {
		t.Fatalf("foreign owner: %d %s", response.Code, response.Body.String())
	}
	meta.UserPublicID = originalUser
	var state struct {
		Preview authoring.PreviewState `json:"preview"`
	}
	requireOK(call("apply", map[string]any{"artifact_id": artifact.ID}, true), &state)
	if state.Preview.ArtifactID != artifact.ID || state.Preview.PluginInstanceID == "" {
		t.Fatalf("preview: %+v", state)
	}
	var inspection host.ExternalPackageInspection
	requireOK(call("inspect", map[string]any{"artifact_id": artifact.ID}, true), &inspection)
	if inspection.InspectedHashes.PackageSHA256 != artifact.PackageSHA256 {
		t.Fatal("review lost exact bytes")
	}
	iconRequest := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Origin", "https://env.example.test")
		req.Header.Set(sessionhop.HeaderChannelID, meta.ChannelID)
		req = WithRouteRole(req, RouteRoleEnvTrusted)
		req, _ = WithTrustedOrigin(req, "https://env.example.test")
		rr := httptest.NewRecorder()
		integration.Handler().ServeHTTP(rr, req)
		return rr
	}
	firstPresentation := service.PresentDraft(ctx, meta, draft)
	if firstPresentation.IconURL == "" {
		t.Fatal("verified icon missing before installation")
	}
	iconResponse := iconRequest(firstPresentation.IconURL)
	if iconResponse.Code != 200 || iconResponse.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("icon: %d %s", iconResponse.Code, iconResponse.Body.String())
	}
	meta.UserPublicID = "foreign"
	if response := iconRequest(firstPresentation.IconURL); response.Code != 404 {
		t.Fatalf("foreign icon read: %d", response.Code)
	}
	meta.UserPublicID = originalUser
	if response := iconRequest(firstPresentation.IconURL + "wrong"); response.Code != 404 {
		t.Fatal("unbound icon digest accepted")
	}
	productOwner, _ := plugincreation.OwnerFromSession(meta)
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := map[string]any{"artifact_id": artifact.ID, "inspection_id": inspection.InspectionID, "request_id": "exact-reviewed-install", "revision": draft.Revision}
	var started host.InspectedInstallOperation
	requireOK(call("install", request, true), &started)
	var result host.InspectedInstallOperation
	deadline := time.Now().Add(10 * time.Second)
	for {
		requireOK(call("installation", map[string]any{"request_id": "exact-reviewed-install"}, true), &result)
		if result.Execution.Status != "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("installation did not settle")
		}
		time.Sleep(time.Millisecond * 10)
	}
	if result.Execution.Status != "completed" {
		t.Fatalf("installation: %+v", result)
	}
	requireOK(call("install", request, true), &started)
	if started.Execution.ID != result.Execution.ID {
		t.Fatal("lost response caused a second operation")
	}
	if err = integration.Close(); err != nil {
		t.Fatal(err)
	}
	integration = nil
	integration, err = New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	requireOK(call("installation", map[string]any{"request_id": "exact-reviewed-install"}, true), &started)
	if started.Execution.ID != result.Execution.ID {
		t.Fatal("restart lost installation")
	}
	authorCtx, owner, err = integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	env, err := integration.author.environment(authorCtx, owner, draft.WorkspaceID, meta)
	if err != nil {
		t.Fatal(err)
	}
	if env.Snapshot().ArtifactID != artifact.ID {
		t.Fatal("restart selected different preview")
	}
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	projected := service.PresentDraft(ctx, meta, draft)
	if projected.Title != "Created" || projected.Revision != draft.Revision {
		t.Fatalf("legacy project name: %+v", projected)
	}
	// Continue the same source after restart and update the retained formal instance.
	workspace, err := integration.author.store.Get(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	project, err := authorproject.Load(workspace.SourceDirectory)
	if err != nil {
		t.Fatal(err)
	}
	// Changed bytes must reach Flower as a failed installation check before the user applies them.
	outputHTML := filepath.Join(filepath.Join(workspace.SourceDirectory, project.Config.Output), "ui", "index.html")
	if err := os.WriteFile(outputHTML, []byte("<main>Changed without a version bump</main>"), 0600); err != nil {
		t.Fatal(err)
	}
	conflicting, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "capture", nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(conflicting)
	if !bytes.Contains(encoded, []byte(`"ready_for_install":false`)) || !bytes.Contains(encoded, []byte(`plugin_author_package_conflict`)) {
		t.Fatalf("Flower did not receive actionable installation readiness: %s", encoded)
	}
	var conflictResult struct {
		Artifact authoring.Artifact `json:"artifact"`
	}
	if err := json.Unmarshal(encoded, &conflictResult); err != nil {
		t.Fatal(err)
	}
	// Build uses the same published pipeline; its model-visible result must retain
	// a failed installation check even when all declared commands pass.
	configPath := filepath.Join(workspace.SourceDirectory, "redevplugin.project.json")
	configBytes, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var projectConfig map[string]any
	if err := json.Unmarshal(configBytes, &projectConfig); err != nil {
		t.Fatal(err)
	}
	projectConfig["build"] = []string{"node", "-e", "process.exit(0)"}
	projectConfig["test"] = []string{"node", "-e", "process.exit(0)"}
	delete(projectConfig, "typecheck")
	delete(projectConfig, "prepare")
	configBytes, _ = json.Marshal(projectConfig)
	if err := os.WriteFile(configPath, configBytes, 0600); err != nil {
		t.Fatal(err)
	}
	buildResult, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "build", nil)
	if err != nil {
		t.Fatal(err)
	}
	buildBytes, _ := json.Marshal(buildResult)
	if !bytes.Contains(buildBytes, []byte(`"ready_for_install":false`)) || !bytes.Contains(buildBytes, []byte(`"status":"passed"`)) {
		t.Fatalf("build readiness: %s", buildBytes)
	}
	before := env.Snapshot()
	checked := call("check", map[string]any{"artifact_id": conflictResult.Artifact.ID}, true)
	if checked.Code != 409 || !bytes.Contains(checked.Body.Bytes(), []byte(`plugin_author_package_conflict`)) {
		t.Fatalf("check: %d %s", checked.Code, checked.Body.String())
	}
	if after := env.Snapshot(); after.ArtifactID != before.ArtifactID || after.Generation != before.Generation {
		t.Fatal("failed check changed the live preview")
	}
	// An explicit local preview may still iterate at the same version. Formal
	// inspection remains bound to the installed release, not that preview.
	requireOK(call("apply", map[string]any{"artifact_id": conflictResult.Artifact.ID}, true), &state)
	if response := call("check", map[string]any{"artifact_id": conflictResult.Artifact.ID}, true); response.Code != 409 {
		t.Fatal("local preview bypassed formal version identity")
	}
	projectConfig["test"] = []string{"node", "-e", "process.exit(1)"}
	configBytes, _ = json.Marshal(projectConfig)
	if err := os.WriteFile(configPath, configBytes, 0600); err != nil {
		t.Fatal(err)
	}
	failedResult, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "build", nil)
	if err != nil {
		t.Fatal(err)
	}
	failedBytes, _ := json.Marshal(failedResult)
	if bytes.Contains(failedBytes, []byte(`"ready_for_install":true`)) || !bytes.Contains(failedBytes, []byte(`"status":"failed"`)) {
		t.Fatalf("failed build declared ready: %s", failedBytes)
	}
	if env.Snapshot().ArtifactID != conflictResult.Artifact.ID {
		t.Fatal("failed build displaced preview")
	}
	for _, manifestPath := range []string{filepath.Join(workspace.SourceDirectory, "manifest.json"), filepath.Join(workspace.SourceDirectory, project.Config.Output, "manifest.json")} {
		raw, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatal(err)
		}
		var document map[string]any
		if err := json.Unmarshal(raw, &document); err != nil {
			t.Fatal(err)
		}
		document["plugin"].(map[string]any)["version"] = "0.2.0"
		raw, err = json.Marshal(document)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(manifestPath, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeIcon(200)
	updatedArtifact, err := integration.author.store.Capture(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	nextPresentation := service.PresentDraft(ctx, meta, draft)
	if nextPresentation.IconURL == "" || nextPresentation.IconURL == firstPresentation.IconURL {
		t.Fatal("changed icon did not invalidate presentation")
	}
	newIcon := iconRequest(nextPresentation.IconURL)
	if newIcon.Code != 200 || bytes.Equal(newIcon.Body.Bytes(), iconResponse.Body.Bytes()) {
		t.Fatal("icon bytes did not change")
	}
	requireOK(call("check", map[string]any{"artifact_id": updatedArtifact.ID}, true), &inspection)
	requireOK(call("apply", map[string]any{"artifact_id": updatedArtifact.ID}, true), &state)
	// The pre-apply inspection remains bound to the exact artifact after preview replacement.
	if inspection.Intent.Action != "update" || inspection.Intent.PluginInstanceID != result.Execution.PluginInstanceID {
		t.Fatalf("formal update lost original instance: %+v", inspection.Intent)
	}
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	updateRequest := map[string]any{"artifact_id": updatedArtifact.ID, "inspection_id": inspection.InspectionID, "request_id": "exact-reviewed-update", "revision": draft.Revision}
	requireOK(call("install", updateRequest, true), &started)
	deadline = time.Now().Add(10 * time.Second)
	for {
		requireOK(call("installation", map[string]any{"request_id": "exact-reviewed-update"}, true), &started)
		if started.Execution.Status != "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("update did not settle")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if started.Execution.Status != "completed" || started.Execution.PluginInstanceID != result.Execution.PluginInstanceID {
		t.Fatalf("update: %+v", started)
	}
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = store.BeginDelete(ctx, productOwner, draft.ID, draft.Revision)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = service.ResumeDelete(ctx, meta, draft.ID, func(context.Context, string) error { t.Fatal("unexpected thread deletion"); return nil })
	if err != nil || draft.Lifecycle != "deleted" {
		t.Fatalf("cleanup: %+v %v", draft, err)
	}
	installed, err := integration.host.ListPlugins(authorCtx)
	if err != nil || len(installed) != 1 || installed[0].PluginInstanceID != result.Execution.PluginInstanceID || installed[0].Version != "0.2.0" {
		t.Fatalf("formal installation lost: %+v %v", installed, err)
	}
}
