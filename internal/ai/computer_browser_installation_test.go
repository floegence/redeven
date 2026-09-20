package ai

import (
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/session"
)

func TestComputerMissingBrowserRequestsConsentAndDisabledBrowserCannotRun(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	host.ConfigureManagedBrowser(t.TempDir())
	r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
	bindTargetTestRun(t, r)
	value, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "observe", "computer.screenshot"), "observe", "computer.screenshot", map[string]any{"target": "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	execution, ok := value.(targetToolExecution)
	if !ok || execution.inputRequired == nil || execution.inputRequired.Questions[0].ID != "browser_install" {
		t.Fatalf("missing canonical consent: %#v", value)
	}
	if state := host.browserInstallation.Snapshot(); state.State != "not_installed" || state.OperationID != "" {
		t.Fatalf("discovery started installation: %+v", state)
	}
	if len(executor.calls) != 0 {
		t.Fatal("missing browser executed a tool")
	}
	service := &Service{targetToolExecutor: host, threadsDB: store}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	if _, err = service.SetComputerBrowserEnabled(t.Context(), meta, false); err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"computer.screenshot", "computer.observe", "computer.exec"} {
		_, err = host.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "browser-main", ThreadID: "thread-first", ToolName: tool})
		if !errors.Is(err, browserinstall.ErrDisabled) {
			t.Fatalf("disabled %s: %v", tool, err)
		}
	}
	if len(executor.calls) != 0 {
		t.Fatal("disabled browser executed a tool")
	}
	if err := host.registry.Register(TargetDescriptor{ID: "stale-managed-page", Kind: "browser.managed", Ready: true}); err != nil {
		t.Fatal(err)
	}
	discovered, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "discover", "computer.targets"), "discover", "computer.targets", map[string]any{"browser_source": "managed"})
	if err != nil {
		t.Fatal(err)
	}
	inventory, ok := discovered.(ComputerTargetInventory)
	if !ok || len(inventory.Candidates) != 0 || inventory.DefaultCandidateRef != "" {
		t.Fatalf("disabled candidate offered: %#v", discovered)
	}
	if _, err = host.executeComputerUserInputLocked(t.Context(), TargetToolCall{TargetID: "browser-main", ToolName: "computer.screenshot"}); !errors.Is(err, browserinstall.ErrDisabled) {
		t.Fatalf("disabled private viewer: %v", err)
	}

	if _, err = service.InstallComputerBrowser(t.Context(), meta, ComputerBrowserInstallRequest{Action: "start", Source: "download", PackageID: host.browserInstallation.Snapshot().Package.ID}); !errors.Is(err, browserinstall.ErrDisabled) {
		t.Fatal("disabled browser admitted installation")
	}
	for _, denied := range []*session.Meta{nil, {CanRead: true}, {CanRead: true, CanWrite: true}} {
		if _, err = service.SetComputerBrowserEnabled(t.Context(), denied, true); err == nil {
			t.Fatal("unauthorized preference mutation")
		}
		if _, err = service.InstallComputerBrowser(t.Context(), denied, ComputerBrowserInstallRequest{Action: "start"}); err == nil {
			t.Fatal("unauthorized installation")
		}
	}
}
