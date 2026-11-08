package redevpluginintegration

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/secrets"
)

func TestAuthorHostRestartsWithSurvivingChild(t *testing.T) {
	const helper = "REDEVEN_TEST_AUTHOR_RESTART_CHILD"
	if os.Getenv(helper) == "1" {
		fmt.Println("ready")
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("author workspace locking requires Darwin or Linux")
	}
	ctx := context.Background()
	root := t.TempDir()
	store, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "restart-channel", EndpointID: "restart-env", UserPublicID: "restart-user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, root)
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.PluginCreation = service
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	integration, err := New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if integration != nil {
			_ = integration.Close()
		}
	})
	draft, err := service.Create(ctx, meta, "restart-draft")
	if err != nil {
		t.Fatal(err)
	}
	scope, err := integration.author.SourceScope(ctx, meta, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(scope.Directory, "retained.txt")
	if err := os.WriteFile(source, []byte("retain author source"), 0600); err != nil {
		t.Fatal(err)
	}

	childCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	t.Cleanup(cancel)
	child := exec.CommandContext(childCtx, os.Args[0], "-test.run=^TestAuthorHostRestartsWithSurvivingChild$")
	child.Env = append(os.Environ(), helper+"=1")
	input, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = input.Close()
		if err := child.Wait(); err != nil {
			t.Errorf("child exit: %v", err)
		}
	})
	if ready, err := bufio.NewReader(output).ReadString('\n'); err != nil || ready != "ready\n" {
		t.Fatalf("child startup: %q %v", ready, err)
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	integration = nil
	reopened, err := New(ctx, options)
	if err != nil {
		t.Fatalf("plugin subsystem cannot restart while host child survives: %v", err)
	}
	defer reopened.Close()
	restored, err := reopened.author.SourceScope(ctx, meta, draft.WorkspaceID)
	if err != nil || restored != scope {
		t.Fatalf("draft source changed after restart: %+v %v", restored, err)
	}
	if bytes, err := os.ReadFile(source); err != nil || string(bytes) != "retain author source" {
		t.Fatalf("draft contents changed: %q %v", bytes, err)
	}
	if _, _, err := reopened.author.context(ctx, meta); err != nil {
		t.Fatalf("fresh author session failed: %v", err)
	}
}

// Relocation is a host directory operation. Reopen through published owners;
// never infer success by reading or rewriting the opaque SQLite schemas.
func TestOpaquePluginRelocationPreservesAuthorWorkspace(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("offline relocation platform")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store, err := plugincreation.Open(filepath.Join(root, "apps", "plugin-creation", "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "relocation", EndpointID: "env", UserPublicID: "user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, root)
	options.PluginCreation = service
	options.AgentHomeDir = root
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	// Create real retained state at the retired root using the published
	// owners. Do not manufacture old state by reversing the new layout.
	hostConfig, sessions, cleanup, err := buildHostAdapters(t.Context(), root, options, true)
	if err != nil {
		t.Fatal(err)
	}
	h, err := host.Open(t.Context(), hostConfig)
	if err != nil {
		cleanup()
		t.Fatal(err)
	}
	author, err := newAuthorBackend(t.Context(), root, options, sessions, h, http.NotFoundHandler(), http.NotFoundHandler())
	if err != nil {
		h.Close()
		cleanup()
		t.Fatal(err)
	}
	integration := &Integration{host: h, author: author, closers: []func() error{cleanup}}
	defer integration.Close()
	service.SetBackend(author)
	ownerContext, _, err := author.context(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	secret := secrets.BindRequest{PluginInstanceID: "relocation-instance", SecretRef: "retained-secret-reference", Scope: secrets.ScopeEnvironment}
	if err := hostConfig.Secrets.Store.BindSecretRef(ownerContext, secret); err != nil {
		t.Fatal(err)
	}
	draft, err := service.Create(t.Context(), meta, "relocate-draft")
	if err != nil {
		integration.Close()
		t.Fatal(err)
	}
	scope, err := integration.author.SourceScope(t.Context(), meta, draft.WorkspaceID)
	if err != nil {
		integration.Close()
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scope.Directory, "retained.txt"), []byte("preserved opaque owner"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	platform := filepath.Join(root, "apps", "plugins", "platform")
	command := exec.Command("python3", "../../scripts/relocate_prerelease_storage.py", "--state-dir", root, "--apply")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("relocate: %v %s", err, output)
	}
	reopened, err := New(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restored, err := reopened.author.SourceScope(t.Context(), meta, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(root, scope.Directory)
	if err != nil || restored.Directory != filepath.Join(platform, relative) {
		t.Fatalf("workspace identity changed: %+v %v", restored, err)
	}
	if data, err := os.ReadFile(filepath.Join(restored.Directory, "retained.txt")); err != nil || string(data) != "preserved opaque owner" {
		t.Fatal("lost author data", err)
	}
	retainedSecrets, err := secrets.NewSQLiteStore(t.Context(), filepath.Join(platform, "secrets.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer retainedSecrets.Close()
	if err := retainedSecrets.TestSecretRef(ownerContext, secret); err != nil {
		t.Fatalf("secret binding lost after relocation: %v", err)
	}

}
