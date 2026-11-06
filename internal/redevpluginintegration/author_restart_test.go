package redevpluginintegration

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
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
