package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/localui"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestLocalAuthorityRotateKeyRequiresStateRoot(t *testing.T) {
	code, _, stderr := runCLITest(t, "local-authority", "rotate-key")
	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stderr), &report); err != nil {
		t.Fatal(err)
	}
	if report.Code != "state_root_required" {
		t.Fatalf("code = %q, want state_root_required", report.Code)
	}
}

func TestLocalAuthorityRotateKeyRejectsActiveRuntime(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()
	code, _, stderr := runCLITest(t, "local-authority", "rotate-key", "--state-root", stateRoot)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stderr), &report); err != nil {
		t.Fatal(err)
	}
	if report.Code != "runtime_active" {
		t.Fatalf("code = %q, want runtime_active", report.Code)
	}
}

func TestDeviceCAGenerationDoesNotStopAnActiveRuntimeOrReplaceItsIdentity(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()
	code, stdout, stderr := runCLITest(t, "local-authority", "device-ca", "generate", "--state-root", stateRoot)
	if code != 0 {
		t.Fatalf("generate while Runtime owns its lock: exit=%d, stderr=%s", code, stderr)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stdout), &report); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(report.CertificatePath)
	if err != nil {
		t.Fatal(err)
	}
	code, _, _ = runCLITest(t, "local-authority", "device-ca", "generate", "--state-root", stateRoot)
	if code == 0 {
		t.Fatal("generation replaced an existing certificate")
	}
	after, err := os.ReadFile(report.CertificatePath)
	if err != nil || string(before) != string(after) {
		t.Fatal("existing certificate changed")
	}
}

func TestDeviceCAStatusSucceedsBeforeClientTrustIsInstalled(t *testing.T) {
	root := t.TempDir()
	if code, _, stderr := runCLITest(t, "local-authority", "device-ca", "generate", "--state-root", root); code != 0 {
		t.Fatalf("generate: %s", stderr)
	}
	code, stdout, stderr := runCLITest(t, "local-authority", "device-ca", "status", "--state-root", root)
	if code != 0 {
		t.Fatalf("status: exit=%d stderr=%s", code, stderr)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stdout), &report); err != nil {
		t.Fatal(err)
	}
	if report.Identity != "ready" || report.Status == "failed" || report.Trust == "trusted" {
		t.Fatalf("unexpected certificate status: %#v", report)
	}
}

func TestDeviceCAErrorCodesDoNotCallOperationFailuresInvalidCertificates(t *testing.T) {
	for _, test := range []struct {
		err  error
		code string
	}{
		{os.ErrPermission, "local_ui_device_ca_permission_denied"},
		{context.DeadlineExceeded, "local_ui_device_ca_timeout"},
		{errors.New("I/O failure"), "local_ui_device_ca_operation_failed"},
		{localui.ErrLocalUIDeviceCAExists, "local_ui_device_ca_exists"},
		{localui.ErrLocalUIDeviceCAInvalid, "local_ui_device_ca_invalid"},
		{localui.ErrLocalUIDeviceCAInstallCanceled, "local_ui_device_ca_install_canceled"},
		{localui.ErrLocalUIDeviceCAInstallFailed, "local_ui_device_ca_install_failed"},
	} {
		if got := deviceCAErrorCode(test.err); got != test.code {
			t.Fatalf("%v: %s", test.err, got)
		}
	}
}

func TestDeviceCAExplicitReplacementAndRemoval(t *testing.T) {
	root := t.TempDir()
	for _, operation := range []string{"generate", "regenerate", "remove", "generate"} {
		var stdout, stderr bytes.Buffer
		if code := runCLI([]string{"local-authority", "device-ca", operation, "--state-root", root, "--confirm"}, strings.NewReader(""), &stdout, &stderr); code != 0 {
			t.Fatalf("%s: code=%d stderr=%s", operation, code, stderr.String())
		}
	}
}

func TestDeviceCAImportFailurePreservesCurrentIdentityAndSecrets(t *testing.T) {
	root := t.TempDir()
	if code, _, stderr := runCLITest(t, "local-authority", "device-ca", "generate", "--state-root", root); code != 0 {
		t.Fatal(stderr)
	}
	for _, operation := range []string{"import", "remove", "regenerate"} {
		code, _, stderr := runCLITest(t, "local-authority", "device-ca", operation, "--state-root", root)
		if code != 2 || !strings.Contains(stderr, "confirmation_required") {
			t.Fatalf("unconfirmed %s: %d %s", operation, code, stderr)
		}
	}
	layout, _ := config.LocalEnvironmentStateLayout(root)
	original, _ := localui.InspectLocalUIDeviceCA(layout.StateDir)
	var stdout, stderr bytes.Buffer
	input := `{"certificate_pem":"invalid-certificate-input","private_key_pem":"secret-private-material"}`
	code := runCLI([]string{"local-authority", "device-ca", "import", "--state-root", root, "--confirm"}, strings.NewReader(input), &stdout, &stderr)
	var report localAuthorityReport
	if err := json.Unmarshal(stderr.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if code != 1 || stdout.Len() != 0 || report.Identity != "ready" || report.Fingerprint != original.Fingerprint || !report.CertificateManagement {
		t.Fatalf("failed import: %d %+v", code, report)
	}
	if strings.Contains(stderr.String(), "secret-private-material") {
		t.Fatal("private input leaked in report")
	}
}
