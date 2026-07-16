package runtimemanagement

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testInventoryOptions(t *testing.T) RuntimeProcessInventoryOptions {
	t.Helper()
	root := t.TempDir()
	return RuntimeProcessInventoryOptions{
		RuntimeRoot:    filepath.Join(root, ".redeven"),
		StateRoot:      filepath.Join(root, ".redeven"),
		DesktopOwnerID: "desktop-owner",
	}
}

func testSnapshot(options RuntimeProcessInventoryOptions, pid int, startedAt int64, executable string, stateRoot string, owner string) runtimeProcessSnapshot {
	return runtimeProcessSnapshot{
		PID:                    pid,
		ProcessStartedAtUnixMS: startedAt,
		UserIdentity:           "tester",
		NamespaceID:            "mnt:[current]",
		ExecutablePath:         executable,
		ExecutableDevice:       1,
		ExecutableInode:        uint64(pid + 1000),
		Args: []string{
			executable,
			"run",
			"--desktop-managed",
			"--state-root",
			stateRoot,
		},
		DesktopOwnerID: owner,
	}
}

func TestBuildRuntimeProcessInventorySeparatesIdentityOwnershipLayoutAndAuthority(t *testing.T) {
	options := testInventoryOptions(t)
	currentExecutable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	current := testSnapshot(options, 10, 100, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	ownerless := testSnapshot(options, 11, 110, currentExecutable, options.StateRoot, "")
	foreign := testSnapshot(options, 12, 120, currentExecutable, options.StateRoot, "another-desktop")
	incomplete := testSnapshot(options, 13, 130, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	incomplete.ExecutableInode = 0
	untrustedLayout := testSnapshot(options, 14, 140, filepath.Join(options.RuntimeRoot, "other", "redeven"), options.StateRoot, options.DesktopOwnerID)
	differentNamespace := testSnapshot(options, 15, 150, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	differentNamespace.NamespaceID = "mnt:[container]"
	differentUser := testSnapshot(options, 16, 160, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	differentUser.UserIdentity = "someone-else"
	differentStateRoot := testSnapshot(options, 17, 170, currentExecutable, filepath.Join(options.StateRoot, "other"), options.DesktopOwnerID)

	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{
			current,
			ownerless,
			foreign,
			incomplete,
			untrustedLayout,
			differentNamespace,
			differentUser,
			differentStateRoot,
			current,
		},
	)

	if len(inventory.Instances) != 5 {
		t.Fatalf("instances = %#v, want five scoped and deduplicated processes", inventory.Instances)
	}
	byPID := map[int]RuntimeProcessInstance{}
	for _, instance := range inventory.Instances {
		byPID[instance.PID] = instance
	}
	if got := byPID[10]; got.IdentityStatus != RuntimeProcessIdentityVerified ||
		got.OwnerStatus != RuntimeProcessOwnerCurrent ||
		got.LayoutStatus != RuntimeProcessLayoutCurrent ||
		got.StopAuthority != RuntimeProcessStopAutomatic ||
		got.ReasonCode != "" {
		t.Fatalf("current = %#v", got)
	}
	if got := byPID[11]; got.IdentityStatus != RuntimeProcessIdentityVerified ||
		got.OwnerStatus != RuntimeProcessOwnerMissing ||
		got.StopAuthority != RuntimeProcessStopConfirmedTakeover ||
		got.ReasonCode != "runtime_owner_identity_unavailable" {
		t.Fatalf("ownerless = %#v", got)
	}
	if got := byPID[12]; got.OwnerStatus != RuntimeProcessOwnerForeign ||
		got.StopAuthority != RuntimeProcessStopConfirmedTakeover ||
		got.ReasonCode != "runtime_owned_by_another_desktop" {
		t.Fatalf("foreign = %#v", got)
	}
	if got := byPID[13]; got.IdentityStatus != RuntimeProcessIdentityIncomplete ||
		got.StopAuthority != RuntimeProcessStopBlocked ||
		got.ReasonCode != "runtime_identity_incomplete" {
		t.Fatalf("incomplete = %#v", got)
	}
	if got := byPID[14]; got.LayoutStatus != RuntimeProcessLayoutUnknown ||
		got.StopAuthority != RuntimeProcessStopBlocked ||
		got.ReasonCode != "runtime_layout_untrusted" {
		t.Fatalf("untrusted layout = %#v", got)
	}
	if inventory.Summary.Automatic != 1 || inventory.Summary.ConfirmedTakeover != 2 || inventory.Summary.Blocked != 2 {
		t.Fatalf("summary = %#v", inventory.Summary)
	}
	if len(inventory.InventoryDigest) != 64 {
		t.Fatalf("inventory digest = %q", inventory.InventoryDigest)
	}
}

func TestRuntimeProcessInventoryUsesMatchingLockAsOwnerEvidence(t *testing.T) {
	options := testInventoryOptions(t)
	lockPath := filepath.Join(options.StateRoot, "local-environment", "agent.lock")
	body, err := json.Marshal(runtimeLockMetadata{PID: 20, DesktopOwnerID: options.DesktopOwnerID})
	if err != nil {
		t.Fatal(err)
	}
	writeRuntimeLeaseTestFile(t, lockPath, body)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshot := testSnapshot(options, 20, 200, executable, options.StateRoot, "")
	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	instance := inventory.Instances[0]
	if instance.OwnerStatus != RuntimeProcessOwnerCurrent ||
		instance.OwnerEvidence != RuntimeProcessOwnerEvidenceLock ||
		instance.StopAuthority != RuntimeProcessStopAutomatic {
		t.Fatalf("instance = %#v", instance)
	}
}

func TestRuntimeProcessInventoryBlocksMissingUserOrExecutableIdentity(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	missingUser := testSnapshot(options, 17, 170, executable, options.StateRoot, options.DesktopOwnerID)
	missingUser.UserIdentity = ""
	missingExecutableIdentity := testSnapshot(options, 18, 180, executable, options.StateRoot, options.DesktopOwnerID)
	missingExecutableIdentity.ExecutableDevice = 0
	missingExecutableIdentity.ExecutableInode = 0

	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{missingUser, missingExecutableIdentity},
	)
	if inventory.Summary.Blocked != 2 {
		t.Fatalf("summary = %#v", inventory.Summary)
	}
	if inventory.Instances[0].ReasonCode != "runtime_user_identity_unavailable" {
		t.Fatalf("missing user reason = %q", inventory.Instances[0].ReasonCode)
	}
}

func TestRuntimeProcessInventoryDoesNotExposeRawArgumentsOrEnvironment(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshot := testSnapshot(options, 20, 200, executable, options.StateRoot, options.DesktopOwnerID)
	snapshot.Args = append(snapshot.Args, "--bootstrap-ticket", "secret-bootstrap-ticket")
	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	body, err := json.Marshal(inventory)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "secret-bootstrap-ticket") || strings.Contains(string(body), "bootstrap-ticket") {
		t.Fatalf("inventory leaked raw process arguments: %s", body)
	}
}

func TestRuntimeProcessInventoryDigestChangesWithProcessIdentity(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshot := testSnapshot(options, 30, 300, executable, options.StateRoot, options.DesktopOwnerID)
	first := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	snapshot.ProcessStartedAtUnixMS++
	second := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	if first.InventoryDigest == second.InventoryDigest {
		t.Fatalf("digest did not change after process identity changed")
	}
}

type fakeRuntimeProcessController struct {
	inventories []RuntimeProcessInventory
	inspectAt   int
	interrupts  []int
	kills       []int
}

func (f *fakeRuntimeProcessController) Inspect(context.Context, RuntimeProcessInventoryOptions) (RuntimeProcessInventory, error) {
	if len(f.inventories) == 0 {
		return RuntimeProcessInventory{}, errors.New("missing fake inventory")
	}
	index := f.inspectAt
	if index >= len(f.inventories) {
		index = len(f.inventories) - 1
	}
	f.inspectAt++
	return f.inventories[index], nil
}

func (f *fakeRuntimeProcessController) Interrupt(pid int) error {
	f.interrupts = append(f.interrupts, pid)
	return nil
}

func (f *fakeRuntimeProcessController) Kill(pid int) error {
	f.kills = append(f.kills, pid)
	return nil
}

func (f *fakeRuntimeProcessController) Wait(context.Context, time.Duration) error {
	return nil
}

func emptyInventoryFrom(before RuntimeProcessInventory) RuntimeProcessInventory {
	after := before
	after.Instances = nil
	after.Summary = RuntimeProcessInventorySummary{}
	after.InventoryDigest = runtimeProcessInventoryDigest(after)
	return after
}

func TestStopRuntimeProcessesRejectsDigestChangesBeforeSignals(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 40, 400, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, "different-digest", time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after digest mismatch")
	}
}

func TestStopRuntimeProcessesRejectsBlockingInventoryBeforeSignals(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	blocked := testSnapshot(options, 41, 410, executable, options.StateRoot, "foreign-owner")
	blocked.ExecutableInode = 0
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{blocked},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryBlocked {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent for blocking inventory")
	}
}

func TestStopRuntimeProcessesRequiresConfirmationBeforeTakeover(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 80, 800, executable, options.StateRoot, "")},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(
		context.Background(),
		controller,
		options,
		before.InventoryDigest,
		time.Second,
		RuntimeProcessReconciliationAutomatic,
	)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorTakeoverRequired {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent before takeover confirmation")
	}
}

func TestStopRuntimeProcessesStopsVerifiedTakeoverAfterConfirmation(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 81, 810, executable, options.StateRoot, "foreign-owner")},
	)
	after := emptyInventoryFrom(before)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, before, after}}
	result, err := stopRuntimeProcesses(
		context.Background(),
		controller,
		options,
		before.InventoryDigest,
		time.Second,
		RuntimeProcessReconciliationConfirmedTakeover,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Stopped) != 1 || len(controller.interrupts) != 1 || controller.interrupts[0] != 81 {
		t.Fatalf("result = %#v interrupts = %#v", result, controller.interrupts)
	}
}

func TestStopRuntimeProcessesRejectsMixedBlockedInventoryAfterConfirmation(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	takeover := testSnapshot(options, 82, 820, executable, options.StateRoot, "")
	blocked := testSnapshot(options, 83, 830, executable, options.StateRoot, "foreign-owner")
	blocked.ExecutableInode = 0
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{takeover, blocked},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(
		context.Background(),
		controller,
		options,
		before.InventoryDigest,
		time.Second,
		RuntimeProcessReconciliationConfirmedTakeover,
	)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryBlocked {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent for a mixed hard-blocked inventory")
	}
}

func TestStopRuntimeProcessesRejectsPIDReuseBeforeSignal(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshot := testSnapshot(options, 42, 420, executable, options.StateRoot, options.DesktopOwnerID)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	snapshot.ProcessStartedAtUnixMS++
	reused := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, reused}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorIdentityChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after PID reuse")
	}
}

func TestStopRuntimeProcessesRejectsProcessExitBeforeSignalSet(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 43, 430, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		emptyInventoryFrom(before),
	}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after a target exited before the signal set")
	}
}

func TestStopRuntimeProcessesVerifiesEveryTargetBeforeSignalSet(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	first := testSnapshot(options, 44, 440, executable, options.StateRoot, options.DesktopOwnerID)
	second := testSnapshot(options, 45, 450, executable, options.StateRoot, options.DesktopOwnerID)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first, second},
	)
	secondExited := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		secondExited,
	}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent before every target was verified: interrupts=%#v kills=%#v", controller.interrupts, controller.kills)
	}
}

func TestStopRuntimeProcessesRejectsNewMatchingInstanceBeforeSignalSet(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	first := testSnapshot(options, 46, 460, executable, options.StateRoot, options.DesktopOwnerID)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first},
	)
	newProcess := testSnapshot(options, 47, 470, executable, options.StateRoot, "foreign-owner")
	newProcess.ExecutableInode = 0
	changed := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first, newProcess},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, changed}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after the inventory gained a blocked instance: interrupts=%#v kills=%#v", controller.interrupts, controller.kills)
	}
}

func TestStopRuntimeProcessesCapturesTargetLeasesBeforeSignals(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 46, 460, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	lockPath := filepath.Join(options.StateRoot, "local-environment", "agent.lock")
	if err := os.MkdirAll(lockPath, 0o755); err != nil {
		t.Fatal(err)
	}
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorLeaseCleanup {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent before target leases were captured: interrupts=%#v kills=%#v", controller.interrupts, controller.kills)
	}
}

func TestStopRuntimeProcessesStopsAllVerifiedInstancesAndVerifiesEmpty(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	first := testSnapshot(options, 50, 500, executable, options.StateRoot, options.DesktopOwnerID)
	second := testSnapshot(options, 51, 510, executable, options.StateRoot, options.DesktopOwnerID)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first, second},
	)
	after := emptyInventoryFrom(before)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		before,
		after,
		after,
	}}
	result, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Stopped) != 2 || len(result.After.Instances) != 0 {
		t.Fatalf("result = %#v", result)
	}
	if len(controller.interrupts) != 2 || controller.interrupts[0] != 50 || controller.interrupts[1] != 51 {
		t.Fatalf("interrupts = %#v", controller.interrupts)
	}
	if len(controller.kills) != 0 {
		t.Fatalf("kills = %#v", controller.kills)
	}
}

func TestStopRuntimeProcessesRejectsNewMatchingInstanceAfterTargetsExit(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 70, 700, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	after := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 71, 710, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		before,
		after,
	}}
	result, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second, RuntimeProcessReconciliationAutomatic)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(result.After.Instances) != 1 || result.After.Instances[0].PID != 71 {
		t.Fatalf("result = %#v", result)
	}
}

func TestVerifyRuntimeProcessInstanceTreatsExitedProcessAsDone(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 60, 600, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{emptyInventoryFrom(before)}}
	err := verifyRuntimeProcessInstance(context.Background(), controller, options, before.Instances[0])
	if !errors.Is(err, os.ErrProcessDone) {
		t.Fatalf("error = %v", err)
	}
}

func writeRuntimeLeaseTestFile(t *testing.T, lockPath string, body []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lockPath, body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeProcessLeaseSnapshotsUseOnlyCurrentLockPath(t *testing.T) {
	stateRoot := t.TempDir()
	targetLockPath := filepath.Join(stateRoot, "local-environment", "agent.lock")
	targetBody, err := json.Marshal(runtimeLockMetadata{PID: 81, InstanceID: "current"})
	if err != nil {
		t.Fatal(err)
	}
	writeRuntimeLeaseTestFile(t, targetLockPath, targetBody)

	inactiveLocks := map[string][]byte{
		filepath.Join(stateRoot, "scopes", "local", "default", "agent.lock"): []byte("23672\n"),
		filepath.Join(stateRoot, "machine", "agent.lock"):                    []byte("86103\n"),
		filepath.Join(stateRoot, "agent.lock"):                               []byte("not a current runtime lease\n"),
	}
	for lockPath, body := range inactiveLocks {
		writeRuntimeLeaseTestFile(t, lockPath, body)
	}

	snapshots, err := captureRuntimeProcessLeaseSnapshots([]RuntimeProcessInstance{{PID: 81, StateRoot: stateRoot}})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].LockPath != targetLockPath || snapshots[0].PID != 81 || snapshots[0].InstanceID != "current" {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	if err := retireRuntimeProcessLeases(context.Background(), snapshots); err != nil {
		t.Fatal(err)
	}
	targetAfter, err := os.ReadFile(targetLockPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(targetAfter) != 0 {
		t.Fatalf("target lock content = %q, want empty", string(targetAfter))
	}
	for lockPath, want := range inactiveLocks {
		got, err := os.ReadFile(lockPath)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Fatalf("inactive lock %s content = %q, want preserved %q", lockPath, string(got), string(want))
		}
	}
}

func TestRetireRuntimeProcessLeasesClearsUnchangedOrReleasedTargets(t *testing.T) {
	jsonBody, err := json.Marshal(runtimeLockMetadata{PID: 91, InstanceID: "current"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		beforeBody []byte
		afterBody  []byte
	}{
		{name: "unchanged json", beforeBody: jsonBody, afterBody: jsonBody},
		{name: "released by runtime", beforeBody: jsonBody, afterBody: nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			lockPath := filepath.Join(t.TempDir(), "agent.lock")
			writeRuntimeLeaseTestFile(t, lockPath, test.afterBody)
			pid, instanceID, ok := runtimeProcessLeaseIdentity(test.beforeBody)
			if !ok {
				t.Fatalf("invalid test lease %q", string(test.beforeBody))
			}
			err := retireRuntimeProcessLeases(context.Background(), []runtimeProcessLeaseSnapshot{{
				LockPath:   lockPath,
				Body:       test.beforeBody,
				PID:        pid,
				InstanceID: instanceID,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body, err := os.ReadFile(lockPath)
			if err != nil {
				t.Fatal(err)
			}
			if len(body) != 0 {
				t.Fatalf("lock content = %q, want empty", string(body))
			}
		})
	}
}

func TestRetireRuntimeProcessLeasesRejectsChangedTarget(t *testing.T) {
	originalBody, err := json.Marshal(runtimeLockMetadata{PID: 91, InstanceID: "current", RuntimeVersion: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	changedPIDBody, err := json.Marshal(runtimeLockMetadata{PID: 92, InstanceID: "current", RuntimeVersion: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	changedInstanceBody, err := json.Marshal(runtimeLockMetadata{PID: 91, InstanceID: "replacement", RuntimeVersion: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	changedContentBody, err := json.Marshal(runtimeLockMetadata{PID: 91, InstanceID: "current", RuntimeVersion: "v2"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name     string
		body     []byte
		wantCode string
	}{
		{name: "changed pid", body: changedPIDBody, wantCode: RuntimeProcessErrorInventoryChanged},
		{name: "changed instance identity", body: changedInstanceBody, wantCode: RuntimeProcessErrorInventoryChanged},
		{name: "changed original content", body: changedContentBody, wantCode: RuntimeProcessErrorInventoryChanged},
		{name: "malformed", body: []byte("not a runtime lease\n"), wantCode: RuntimeProcessErrorLeaseCleanup},
	} {
		t.Run(test.name, func(t *testing.T) {
			lockPath := filepath.Join(t.TempDir(), "agent.lock")
			writeRuntimeLeaseTestFile(t, lockPath, test.body)
			err := retireRuntimeProcessLeases(context.Background(), []runtimeProcessLeaseSnapshot{{
				LockPath:   lockPath,
				Body:       originalBody,
				PID:        91,
				InstanceID: "current",
			}})
			if RuntimeProcessErrorCode(err) != test.wantCode {
				t.Fatalf("error = %v, code = %q, want %q", err, RuntimeProcessErrorCode(err), test.wantCode)
			}
			body, readErr := os.ReadFile(lockPath)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if string(body) != string(test.body) {
				t.Fatalf("lock content = %q, want preserved %q", string(body), string(test.body))
			}
		})
	}
}

func TestCompleteRuntimeProcessStopPrioritizesLiveInventoryOverLeaseCleanupFailure(t *testing.T) {
	options := testInventoryOptions(t)
	lockPath := filepath.Join(t.TempDir(), "agent.lock")
	writeRuntimeLeaseTestFile(t, lockPath, []byte("malformed replacement lease\n"))
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	live := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 92, 920, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{live}}
	result, err := completeRuntimeProcessStop(context.Background(), controller, options, RuntimeProcessStopResult{
		SchemaVersion: RuntimeProcessInventorySchemaVersion,
		leaseSnapshots: []runtimeProcessLeaseSnapshot{{
			LockPath:   lockPath,
			Body:       []byte("91\n"),
			PID:        91,
			InstanceID: "",
		}},
	})
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(result.After.Instances) != 1 || result.After.Instances[0].PID != 92 {
		t.Fatalf("result = %#v", result)
	}
}
