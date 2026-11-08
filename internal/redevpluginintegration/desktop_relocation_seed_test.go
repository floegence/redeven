package redevpluginintegration

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/host"
)

// An explicit Desktop acceptance fixture, never a production migration reader.
// Published owners create authentic legacy state; no database is manufactured,
// parsed or copied. The browser lane then exercises these bytes after relocation.
func TestSeedDesktopPluginRelocation(t *testing.T) {
	root := os.Getenv("REDEVEN_PLUGIN_RELOCATION_FIXTURE")
	if root == "" {
		t.Skip("explicit isolated Desktop qualification")
	}
	if !filepath.IsAbs(root) {
		t.Fatal("absolute fresh fixture root required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	runtimePath := os.Getenv("REDEVEN_TEST_PLUGIN_RUNTIME")
	if !filepath.IsAbs(runtimePath) {
		t.Fatal("real published-source runtime required")
	}
	state := filepath.Join(root, "state", "local-environment")
	store, err := plugincreation.Open(filepath.Join(state, "apps", "plugin-creation", "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "relocation-seed", EndpointID: "env_local", UserPublicID: "user_local", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := Options{StateDir: state, AgentHomeDir: root, PermissionPolicy: testPermissionPolicy(t, "execute_read_write"), RuntimePath: runtimePath, PluginCreation: service, ResolveSessionMeta: func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }}
	config, sessions, cleanup, err := buildHostAdapters(t.Context(), state, options, true)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	h, err := host.Open(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	author, err := newAuthorBackend(t.Context(), state, options, sessions, h, http.NotFoundHandler(), http.NotFoundHandler())
	if err != nil {
		t.Fatal(err)
	}
	defer author.Close()
	service.SetBackend(author)
	draft, err := service.Create(t.Context(), meta, "desktop-relocation")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := author.AuthorOperation(t.Context(), meta, draft.WorkspaceID, "initialize", map[string]any{"slug": "desktop-relocation", "display_name": "Retained worker", "template": "worker"}); err != nil {
		t.Fatal(err)
	}
	ctx, owner, err := author.context(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	ctx = context.WithValue(ctx, trustedOriginContextKey{}, "https://env.example.test")
	workspace, err := author.store.Get(ctx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := author.store.Capture(ctx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	_, bytes, err := author.store.ReadArtifact(ctx, owner, draft.WorkspaceID, artifact.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "initial.redevplugin"), bytes, 0600); err != nil {
		t.Fatal(err)
	}
	inspection, err := author.store.InspectArtifact(ctx, owner, draft.WorkspaceID, artifact.ID, h, host.ExternalPackageIntent{Action: "install"})
	if err != nil {
		t.Fatal(err)
	}
	installed := installInspectedTestPackage(t, ctx, h, inspection.InspectionID, inspection.InspectedHashes.PackageSHA256)
	for _, permission := range inspection.SecuritySummary.Permissions {
		grant, err := h.GrantPermission(ctx, host.GrantPermissionRequest{PluginInstanceID: installed.PluginInstanceID, PermissionID: permission.PermissionID, ExpectedPolicyRevision: installed.PolicyRevision, ExpectedManagementRevision: installed.ManagementRevision, ExpectedRevokeEpoch: installed.RevokeEpoch})
		if err != nil {
			t.Fatal(err)
		}
		installed.PolicyRevision, installed.ManagementRevision, installed.RevokeEpoch = grant.Revisions.PolicyRevision, grant.Revisions.ManagementRevision, grant.Revisions.RevokeEpoch
	}
	for _, directory := range []string{workspace.SourceDirectory, filepath.Join(workspace.SourceDirectory, "dist")} {
		file := filepath.Join(directory, "manifest.json")
		raw, err := os.ReadFile(file)
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
		if err := os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	updated, err := author.store.Capture(ctx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	_, bytes, err = author.store.ReadArtifact(ctx, owner, draft.WorkspaceID, updated.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "update.redevplugin"), bytes, 0600); err != nil {
		t.Fatal(err)
	}
	report, err := json.Marshal(map[string]any{"draft_id": draft.ID, "workspace_id": draft.WorkspaceID, "plugin_id": installed.PluginID, "plugin_instance_id": installed.PluginInstanceID, "package_sha256": installed.PackageHash, "version": installed.Version})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fixture.json"), report, 0600); err != nil {
		t.Fatal(err)
	}
}
