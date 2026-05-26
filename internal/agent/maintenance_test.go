package agent

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	syssvc "github.com/floegence/redeven/internal/sys"
)

func newLoggerForTest(t *testing.T) *slog.Logger {
	t.Helper()
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRuntimeMaintenanceMarkerStoreRoundTripsSnapshotFields(t *testing.T) {
	store := newRuntimeMaintenanceMarkerStore(filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json"))
	marker := runtimeMaintenanceMarker{
		Kind:                       " upgrade ",
		State:                      syssvc.MaintenanceStateRunning,
		TargetVersion:              " v1.1.0 ",
		PreviousVersion:            " v1.0.0 ",
		ObservedVersion:            " v1.0.1 ",
		PreviousProcessStartedAtMs: 100,
		ObservedProcessStartedAtMs: 200,
		PreviousRuntimeInstanceID:  " rt_previous ",
		ObservedRuntimeInstanceID:  " rt_observed ",
		InstallDir:                 " /opt/redeven/bin ",
		ExePath:                    " /opt/redeven/bin/redeven ",
		Message:                    " Downloading ",
		ErrorCode:                  " install_failed ",
		StartedAtMs:                10,
		UpdatedAtMs:                20,
		CompletedAtMs:              30,
	}

	if err := store.write(marker); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	got, err := store.read()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	if got == nil {
		t.Fatalf("read marker = nil")
	}
	if got.SchemaVersion != runtimeMaintenanceMarkerSchemaVersion ||
		got.Kind != syssvc.MaintenanceKindUpgrade ||
		got.TargetVersion != "v1.1.0" ||
		got.PreviousVersion != "v1.0.0" ||
		got.ObservedVersion != "v1.0.1" ||
		got.PreviousRuntimeInstanceID != "rt_previous" ||
		got.ObservedRuntimeInstanceID != "rt_observed" ||
		got.InstallDir != "/opt/redeven/bin" ||
		got.ExePath != "/opt/redeven/bin/redeven" ||
		got.Message != "Downloading" ||
		got.ErrorCode != "install_failed" ||
		got.CompletedAtMs != 30 {
		t.Fatalf("unexpected marker after round trip: %#v", got)
	}
}

func TestSysUpgraderRejectsMissingTargetVersion(t *testing.T) {
	upgrader := &sysUpgrader{a: &Agent{log: newLoggerForTest(t)}}

	resp, err := upgrader.StartUpgrade(context.Background(), nil, &syssvc.UpgradeRequest{})

	if resp != nil {
		t.Fatalf("response = %#v, want nil", resp)
	}
	if err == nil || !strings.Contains(err.Error(), "missing target_version") {
		t.Fatalf("error = %v, want missing target_version", err)
	}
}

func TestSysUpgraderDryRunAllowsMissingTargetVersion(t *testing.T) {
	dryRun := true
	upgrader := &sysUpgrader{a: &Agent{log: newLoggerForTest(t)}}

	resp, err := upgrader.StartUpgrade(context.Background(), nil, &syssvc.UpgradeRequest{DryRun: &dryRun})

	if err != nil {
		t.Fatalf("dry run upgrade error = %v", err)
	}
	if resp == nil || !resp.OK || resp.Message != "Dry run ok." {
		t.Fatalf("dry run response = %#v", resp)
	}
}

func TestReconcileRuntimeMaintenanceMarkerMarksSucceededUpgrade(t *testing.T) {
	store := newRuntimeMaintenanceMarkerStore(filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json"))
	if err := store.write(runtimeMaintenanceMarker{
		Kind:                       syssvc.MaintenanceKindUpgrade,
		State:                      syssvc.MaintenanceStateRunning,
		TargetVersion:              "v1.1.0",
		PreviousVersion:            "v1.0.0",
		PreviousProcessStartedAtMs: 100,
		PreviousRuntimeInstanceID:  "rt_previous",
		InstallDir:                 "/opt/redeven/bin",
		ExePath:                    "/opt/redeven/bin/redeven",
		StartedAtMs:                10,
		UpdatedAtMs:                20,
	}); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	a := &Agent{
		version:                "v1.1.0",
		instanceID:             "rt_observed",
		processStartedAtMs:     200,
		maintenanceMarkerStore: store,
		log:                    newLoggerForTest(t),
	}

	a.reconcileRuntimeMaintenanceMarker()

	snapshot := a.CurrentMaintenanceSnapshot()
	if snapshot == nil {
		t.Fatalf("snapshot = nil")
	}
	if snapshot.State != syssvc.MaintenanceStateSucceeded ||
		snapshot.TargetVersion != "v1.1.0" ||
		snapshot.PreviousVersion != "v1.0.0" ||
		snapshot.ObservedVersion != "v1.1.0" ||
		snapshot.PreviousProcessStartedAtMs != 100 ||
		snapshot.ObservedProcessStartedAtMs != 200 ||
		snapshot.PreviousRuntimeInstanceID != "rt_previous" ||
		snapshot.ObservedRuntimeInstanceID != "rt_observed" ||
		snapshot.CompletedAtMs <= 0 {
		t.Fatalf("unexpected reconciled snapshot: %#v", snapshot)
	}
}

func TestReconcileRuntimeMaintenanceMarkerMarksVersionMismatchFailed(t *testing.T) {
	store := newRuntimeMaintenanceMarkerStore(filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json"))
	if err := store.write(runtimeMaintenanceMarker{
		Kind:          syssvc.MaintenanceKindUpgrade,
		State:         syssvc.MaintenanceStateRunning,
		TargetVersion: "v1.1.0",
		StartedAtMs:   10,
		UpdatedAtMs:   20,
	}); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	a := &Agent{
		version:                "v1.0.0",
		instanceID:             "rt_observed",
		processStartedAtMs:     200,
		maintenanceMarkerStore: store,
		log:                    newLoggerForTest(t),
	}

	a.reconcileRuntimeMaintenanceMarker()

	snapshot := a.CurrentMaintenanceSnapshot()
	if snapshot == nil {
		t.Fatalf("snapshot = nil")
	}
	if snapshot.State != syssvc.MaintenanceStateFailed ||
		snapshot.ErrorCode != runtimeMaintenanceErrorVersionMismatch ||
		snapshot.ObservedVersion != "v1.0.0" ||
		!strings.Contains(snapshot.Message, "v1.0.0 instead of v1.1.0") {
		t.Fatalf("unexpected reconciled failure snapshot: %#v", snapshot)
	}
}

func TestReconcileRuntimeMaintenanceMarkerRequiresObservableNewIdentity(t *testing.T) {
	store := newRuntimeMaintenanceMarkerStore(filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json"))
	if err := store.write(runtimeMaintenanceMarker{
		Kind:                       syssvc.MaintenanceKindUpgrade,
		State:                      syssvc.MaintenanceStateRunning,
		TargetVersion:              "v1.1.0",
		PreviousVersion:            "v1.0.0",
		PreviousProcessStartedAtMs: 200,
		PreviousRuntimeInstanceID:  "rt_same",
		StartedAtMs:                10,
		UpdatedAtMs:                20,
	}); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	a := &Agent{
		version:                "v1.1.0",
		instanceID:             "rt_same",
		processStartedAtMs:     200,
		maintenanceMarkerStore: store,
		log:                    newLoggerForTest(t),
	}

	a.reconcileRuntimeMaintenanceMarker()

	snapshot := a.CurrentMaintenanceSnapshot()
	if snapshot == nil {
		t.Fatalf("snapshot = nil")
	}
	if snapshot.State != syssvc.MaintenanceStateFailed ||
		snapshot.ErrorCode != runtimeMaintenanceErrorIdentityMissing ||
		!strings.Contains(snapshot.Message, "identity was not observable") {
		t.Fatalf("unexpected identity failure snapshot: %#v", snapshot)
	}
}

func TestMarkMaintenanceFailedPersistsInstallFailureDiagnostics(t *testing.T) {
	store := newRuntimeMaintenanceMarkerStore(filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json"))
	a := &Agent{
		version:                "v1.0.0",
		instanceID:             "rt_previous",
		processStartedAtMs:     100,
		maintenanceMarkerStore: store,
		log:                    newLoggerForTest(t),
	}
	a.markMaintenanceRunning(runtimeMaintenanceRunInput{
		kind:          syssvc.MaintenanceKindUpgrade,
		targetVersion: "v1.1.0",
		message:       "Downloading and installing update...",
		plan: selfExecPlan{
			installDir: "/opt/redeven/bin",
			exePath:    "/opt/redeven/bin/redeven",
		},
	})

	a.markMaintenanceFailed(runtimeMaintenanceFailureInput{
		kind:          syssvc.MaintenanceKindUpgrade,
		targetVersion: "v1.1.0",
		message:       "Install failed: curl failed.",
		errorCode:     runtimeMaintenanceErrorInstallFailed,
	})

	got, err := store.read()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	if got == nil || got.State != syssvc.MaintenanceStateFailed ||
		got.TargetVersion != "v1.1.0" ||
		got.PreviousVersion != "v1.0.0" ||
		got.ObservedVersion != "v1.0.0" ||
		got.PreviousProcessStartedAtMs != 100 ||
		got.ObservedProcessStartedAtMs != 100 ||
		got.InstallDir != "/opt/redeven/bin" ||
		got.ExePath != "/opt/redeven/bin/redeven" ||
		got.ErrorCode != runtimeMaintenanceErrorInstallFailed ||
		got.CompletedAtMs <= 0 {
		t.Fatalf("unexpected failed marker: %#v", got)
	}
}

func TestRuntimeMaintenanceMarkerStoreRejectsInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime", "maintenance", "current.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("write bad marker: %v", err)
	}

	if marker, err := newRuntimeMaintenanceMarkerStore(path).read(); err == nil || marker != nil {
		t.Fatalf("read invalid marker = %#v, %v; want error", marker, err)
	}
}

func TestReconcileRuntimeMaintenanceMarkerQuarantinesUnreadableMarker(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "runtime", "maintenance")
	path := filepath.Join(dir, "current.json")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("write bad marker: %v", err)
	}
	a := &Agent{
		version:                "v1.0.0",
		instanceID:             "rt_observed",
		processStartedAtMs:     200,
		maintenanceMarkerStore: newRuntimeMaintenanceMarkerStore(path),
		log:                    newLoggerForTest(t),
	}

	a.reconcileRuntimeMaintenanceMarker()

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("current marker stat error = %v, want not exist", err)
	}
	matches, err := filepath.Glob(path + ".unreadable.*")
	if err != nil {
		t.Fatalf("glob quarantined marker: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("quarantined marker count = %d, want 1", len(matches))
	}
	snapshot := a.CurrentMaintenanceSnapshot()
	if snapshot == nil || snapshot.State != syssvc.MaintenanceStateFailed ||
		snapshot.ErrorCode != runtimeMaintenanceErrorMarkerUnreadable ||
		!strings.Contains(snapshot.Message, "moved aside") {
		t.Fatalf("unexpected unreadable marker snapshot: %#v", snapshot)
	}
}

func TestAgentUsesConfigPathDerivedRuntimeMaintenancePath(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "custom-state", "local-environment", "config.json")
	a := &Agent{
		maintenanceMarkerStore: newRuntimeMaintenanceMarkerStore(config.RuntimeMaintenancePathFromConfigPath(cfgPath)),
	}

	if a.maintenanceMarkerStore == nil {
		t.Fatalf("maintenanceMarkerStore = nil")
	}
	want := filepath.Join(filepath.Dir(cfgPath), "runtime", "maintenance", "current.json")
	if a.maintenanceMarkerStore.path != want {
		t.Fatalf("maintenance marker path = %q, want %q", a.maintenanceMarkerStore.path, want)
	}
}
