package redevpluginintegration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/mutation"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
)

// This opt-in lane calls the configured model and executes its real author tools.
// It requires the product runtime built from the exact published platform release.
func TestPluginCreationRealModelBuildInstallAndDelete(t *testing.T) {
	if os.Getenv("REDEVEN_PLUGIN_CREATION_MODEL_E2E") != "1" {
		t.Skip("explicit isolated model qualification")
	}
	profile, reportRoot, runtimePath := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT"), os.Getenv("REDEVEN_PLUGIN_CREATION_REPORT_DIR"), os.Getenv("REDEVEN_TEST_PLUGIN_RUNTIME")
	if profile == "" || reportRoot == "" || runtimePath == "" {
		t.Fatal("source profile, report directory and published runtime are required")
	}
	originals := map[string][32]byte{}
	sourceFiles := map[string][]byte{}
	for _, name := range []string{"config.json", "secrets.json"} {
		raw, err := os.ReadFile(filepath.Join(profile, name))
		if err != nil {
			t.Fatal(err)
		}
		originals[name] = sha256.Sum256(raw)
		sourceFiles[name] = raw
	}
	t.Cleanup(func() {
		for name, expected := range originals {
			raw, err := os.ReadFile(filepath.Join(profile, name))
			if err != nil || sha256.Sum256(raw) != expected {
				t.Errorf("source profile changed: %s", name)
			}
		}
	})
	var source config.Config
	if err := json.Unmarshal(sourceFiles["config.json"], &source); err != nil || source.AI == nil {
		t.Fatal("configured model profile unavailable")
	}
	var provider config.AIProvider
	var model config.AIProviderModel
	for _, candidate := range source.AI.Providers {
		if candidate.Type != "deepseek" {
			continue
		}
		for _, m := range candidate.EffectiveModels() {
			if m.ModelName == "deepseek-flash" {
				if provider.ID != "" {
					t.Fatal("ambiguous qualification provider")
				}
				provider, model = candidate, m
			}
		}
	}
	if provider.ID == "" {
		t.Fatal("configured DeepSeek Flash unavailable")
	}
	var credentials struct {
		AI struct {
			ProviderAPIKeys map[string]string `json:"provider_api_keys"`
		} `json:"ai"`
	}
	if err := json.Unmarshal(sourceFiles["secrets.json"], &credentials); err != nil {
		t.Fatal("configured credential document unavailable")
	}
	key := credentials.AI.ProviderAPIKeys[provider.ID]
	if key == "" {
		t.Fatal("configured credential unavailable")
	}
	if err := os.Mkdir(reportRoot, 0700); err != nil {
		t.Fatal("fresh report directory required", err)
	}
	home := filepath.Join(reportRoot, "home")
	if err := os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	home, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	store, err := plugincreation.Open(filepath.Join(reportRoot, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	product := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "model-author", EndpointID: "qualification-env", UserPublicID: "qualification-user", NamespacePublicID: "qualification-namespace", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := Options{StateDir: filepath.Join(reportRoot, "runtime"), AgentHomeDir: home, PermissionPolicy: testPermissionPolicy(t, "execute_read_write"), RuntimePath: runtimePath, PluginCreation: product, ResolveSessionMeta: func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }}
	integration, err := New(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if integration != nil {
			if err := integration.Close(); err != nil {
				t.Error(err)
			}
		}
	}()
	scope, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: home, FilesystemScope: &config.FilesystemScope{SchemaVersion: config.FilesystemScopeSchemaVersionV1, DefaultRootID: "home", Roots: []config.FilesystemRootPolicy{{ID: "home", Label: "Home", Kind: config.FilesystemRootHome, Path: home, Permissions: config.FilesystemPermissionSet{Read: true, Write: true}}}}})
	if err != nil {
		t.Fatal(err)
	}
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	modelID := provider.ID + "/" + model.ModelName
	svc, err := ai.NewService(ai.Options{PluginCreation: product, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(reportRoot, "runtime"), AgentHomeDir: home, FilesystemScope: scope, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	report := map[string]any{"model": model.ModelName, "real_model": true, "real_platform_host": true, "browser_verified": false}
	defer func() {
		report["passed"] = !t.Failed()
		raw, _ := json.MarshalIndent(report, "", "  ")
		if err := os.WriteFile(filepath.Join(reportRoot, "report.json"), raw, 0600); err != nil {
			t.Error(err)
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Minute)
	defer cancel()
	draft, err := product.Create(ctx, meta, "model-draft")
	if err != nil {
		t.Fatal(err)
	}
	response, err := svc.SendUserTurn(ctx, meta, ai.SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), PluginDraftID: draft.ID, Create: &ai.CreateThreadRequest{ClientRequestID: "model-first-turn", ModelID: modelID, PermissionType: config.AIPermissionFullAccess}, Input: ai.RunInput{Text: "Create a compact focus timer plugin in this dedicated Plugin Center draft. Use plugin_author_get_status to resolve the managed source, then initialize a web template with slug focus-timer and display_name Focus Timer. Read the released authoring skill and actual source. Implement a 25 minute timer with accessible buttons named Start, Pause and Reset and a visible mm:ss countdown initially showing 25:00. Use a compact 13px UI that follows the host light/dark theme. Use the ordinary approved tools to install the project's dependencies and edit source, then plugin_author_build. Ensure the configured real tests pass. Do not install or grant permissions, do not start a separate preview server, and do not delegate. The workspace owns preview and installation. Work only in the dedicated source and task directories. Continue until a successful artifact is returned."}, Options: ai.RunOptions{NoUserInteraction: true, MaxOutputTokens: 8000, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, ToolAllowlist: []string{"skill_use", "file_read", "file_read_many", "list_files", "find", "file_write", "file_apply_patch", "terminal_exec", "terminal_read", "plugin_author_get_status", "plugin_author_initialize", "plugin_author_build", "plugin_author_capture"}}})
	if err != nil {
		t.Fatal(err)
	}
	report["thread_id"] = response.ThreadID
	defer func() {
		readCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		detail, failure := svc.GetFlowerThreadDetail(readCtx, meta, response.ThreadID)
		if failure != nil {
			return // Successful draft deletion also deletes the dedicated thread.
		}
		raw, failure := json.MarshalIndent(detail, "", "  ")
		if failure == nil {
			_ = os.WriteFile(filepath.Join(reportRoot, "conversation.json"), raw, 0600)
		}
	}()
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			t.Fatal("model authoring timed out")
		case <-ticker.C:
		}
		detail, e := svc.GetFlowerThreadDetail(ctx, meta, response.ThreadID)
		if e != nil {
			t.Fatal(e)
		}
		if detail.Current.TurnID.String() == response.TurnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			raw, _ := json.MarshalIndent(detail, "", "  ")
			if err = os.WriteFile(filepath.Join(reportRoot, "conversation.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("model turn outcome: %s", *detail.Current.LastOutcome)
			}
			break
		}
	}
	authorCtx, owner, err := integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	build, err := integration.author.store.BuildReport(authorCtx, owner, draft.WorkspaceID)
	if err != nil || build == nil || build.Status != "passed" {
		t.Fatalf("actual build did not pass: %+v %v", build, err)
	}
	artifacts, err := integration.author.store.ListArtifacts(authorCtx, owner, draft.WorkspaceID)
	if err != nil || len(artifacts) == 0 {
		t.Fatalf("no generated artifact: %v", err)
	}
	artifact := artifacts[0]
	report["artifact"] = artifact
	report["build"] = build
	workspace, err := integration.author.store.Get(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	svg, err := os.ReadFile(filepath.Join(workspace.SourceDirectory, generatedPluginIconSource))
	if err != nil {
		t.Fatal("generated SVG icon is a required deliverable:", err)
	}
	_, packageBytes, err := integration.author.store.ReadArtifact(authorCtx, owner, draft.WorkspaceID, artifact.ID)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := pluginpkg.Read(authorCtx, bytes.NewReader(packageBytes), int64(len(packageBytes)), pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	icon, err := checkGeneratedPluginIcon(svg, pkg)
	if err != nil {
		t.Fatal("generated icon acceptance failed:", err)
	}
	report["icon"] = icon
	env, err := integration.author.environment(authorCtx, owner, draft.WorkspaceID, meta)
	if err != nil {
		t.Fatal(err)
	}
	if err = env.Apply(authorCtx, artifact.ID); err != nil {
		t.Fatal(err)
	}
	qualifyGeneratedAuthorBrowser(t, ctx, integration, svc, meta, draft.WorkspaceID, env.Snapshot().PluginInstanceID, false, reportRoot)
	productOwner, _ := plugincreation.OwnerFromSession(meta)
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if draft.InstallRequestID == "" || draft.InstallArtifactID != artifact.ID {
		t.Fatalf("browser did not install the exact reviewed artifact: %+v", draft)
	}
	operation, err := integration.host.GetInspectedInstall(authorCtx, draft.InstallRequestID)
	if err != nil {
		t.Fatal(err)
	}
	if operation.MutationOutcome != mutation.OutcomeCommitted {
		t.Fatalf("install outcome: %+v", operation)
	}
	report["installation"] = operation
	// Continuing an installed draft must execute another model turn, build a new
	// immutable artifact and offer an update against the same installed instance.
	followup, err := svc.SendUserTurn(ctx, meta, ai.SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ThreadID: response.ThreadID, ClientRequestID: "model-followup-edit", Input: ai.RunInput{Text: "Refine this existing timer: add a compact visible caption Focus session beneath the timer, refine spacing and typography, preserve the 25:00 timer and Start/Pause/Reset behavior, and update source version to 0.1.1. Use plugin_author_get_status, read the existing source, make the change, and plugin_author_build until the real tests pass and a new artifact is returned. Preserve plugin identity and icon. Do not install, grant permissions, start a preview server or delegate."}, Options: ai.RunOptions{NoUserInteraction: true, MaxOutputTokens: 8000, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, ToolAllowlist: []string{"skill_use", "file_read", "file_read_many", "list_files", "find", "file_write", "file_apply_patch", "terminal_exec", "terminal_read", "plugin_author_get_status", "plugin_author_build", "plugin_author_capture"}}})
	if err != nil {
		t.Fatal("follow-up admission:", err)
	}
	for {
		select {
		case <-ctx.Done():
			t.Fatal("follow-up timed out")
		case <-ticker.C:
		}
		detail, err := svc.GetFlowerThreadDetail(ctx, meta, response.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Current.TurnID.String() == followup.TurnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("follow-up outcome: %s", *detail.Current.LastOutcome)
			}
			break
		}
	}
	artifacts, err = integration.author.store.ListArtifacts(authorCtx, owner, draft.WorkspaceID)
	if err != nil || len(artifacts) < 2 || artifacts[0].ID == artifact.ID {
		t.Fatalf("follow-up artifact: %+v %v", artifacts, err)
	}
	updated := artifacts[0]
	if err = env.Apply(authorCtx, updated.ID); err != nil {
		t.Fatal(err)
	}
	qualifyGeneratedAuthorBrowser(t, ctx, integration, svc, meta, draft.WorkspaceID, env.Snapshot().PluginInstanceID, false, reportRoot)
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil || draft.InstallArtifactID != updated.ID {
		t.Fatalf("updated installation receipt: %+v %v", draft, err)
	}
	updatedOperation, err := integration.host.GetInspectedInstall(authorCtx, draft.InstallRequestID)
	if err != nil || updatedOperation.MutationOutcome != mutation.OutcomeCommitted || updatedOperation.Execution.PluginInstanceID != operation.Execution.PluginInstanceID {
		t.Fatalf("update identity: %+v %v", updatedOperation, err)
	}
	report["followup_artifact"] = updated
	report["followup_update"] = updatedOperation
	operation = updatedOperation
	if err = integration.Close(); err != nil {
		t.Fatal(err)
	}
	integration = nil
	integration, err = New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	authorCtx, _, err = integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := integration.host.GetInspectedInstall(authorCtx, draft.InstallRequestID)
	if err != nil || recovered.Execution.ID != operation.Execution.ID {
		t.Fatalf("restart recovery: %+v %v", recovered, err)
	}
	qualifyGeneratedAuthorBrowser(t, ctx, integration, svc, meta, draft.WorkspaceID, operation.Execution.PluginInstanceID, true, reportRoot)
	report["browser_verified"] = true
	draft, err = store.Get(ctx, productOwner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.DeletePluginDraft(ctx, meta, draft.ID, draft.Revision); err != nil {
		t.Fatal(err)
	}
	installed, err := integration.host.ListPlugins(authorCtx)
	if err != nil || len(installed) != 1 || installed[0].PluginInstanceID != operation.Execution.PluginInstanceID {
		t.Fatalf("installed plugin not retained: %+v %v", installed, err)
	}
	report["restart_recovered"] = true
	report["author_deleted_install_retained"] = true
}
