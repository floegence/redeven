package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserRecoveryRejectsStaleGenerationAndUnauthorizedRequests(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	before := runtime.browserServiceSnapshot()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := runtime.RecoverBrowser(t.Context(), meta, "old"); !errors.Is(err, errBrowserGenerationChanged) {
		t.Fatalf("stale recovery: %v", err)
	}
	if _, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true}, before.Generation); err == nil {
		t.Fatal("read-only session admitted recovery")
	}
	if runtime.browserServiceSnapshot() != before || runtime.browserRecovery != nil {
		t.Fatal("rejected request changed browser service")
	}
}

func TestBrowserRecoveryPreservesUnresolvedExternalPrivacy(t *testing.T) {
	executor := NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", "/fixture/profile")
	executor.CDPURL = "http://127.0.0.1:12345"
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"external": executor}, t.TempDir())
	control := runtime.controlForTarget("external")
	control.browser = &browserTargetLease{private: true}
	before := runtime.browserServiceSnapshot()
	_, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, before.Generation)
	if !errors.Is(err, errBrowserRecoveryBlocked) {
		t.Fatalf("private recovery admitted: %v", err)
	}
	if runtime.browserRecovery != nil || runtime.browserServiceSnapshot() != before || control.browser == nil {
		t.Fatal("rejected recovery removed the privacy reservation")
	}
}

func TestBrowserRecoveryPreservesOrphanedExternalPrivacy(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	control := runtime.controlForTarget("closed-private-opener")
	control.browser = &browserTargetLease{private: true}
	_, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, runtime.browserServiceSnapshot().Generation)
	if !errors.Is(err, errBrowserRecoveryBlocked) {
		t.Fatalf("retired opener lost its descendant barrier: %v", err)
	}
}

func TestBrowserFailureCodesPreserveActionableReasons(t *testing.T) {
	for _, test := range []struct {
		err  error
		code string
	}{
		{browserinstall.ErrInstallRequired, "BROWSER_INSTALL_REQUIRED"},
		{browserinstall.ErrDisabled, "BROWSER_DISABLED"},
		{errBrowserHostFailed, "BROWSER_SERVICE_FAILED"},
		{errBrowserRecoveryBlocked, "BROWSER_RECOVERY_BLOCKED"},
		{context.DeadlineExceeded, "BROWSER_OPEN_TIMEOUT"},
		{errors.New("secret page data"), "BROWSER_OPEN_FAILED"},
	} {
		if actual := BrowserErrorCode(test.err); actual != test.code {
			t.Fatalf("code: %s, want %s", actual, test.code)
		}
	}
}
