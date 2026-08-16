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
		RuntimeRoot: filepath.Join(root, ".redeven"),
		StateRoot:   filepath.Join(root, ".redeven"),
	}
}

func testSnapshot(options RuntimeProcessInventoryOptions, pid int, startedAt int64, executable string, stateRoot string) runtimeProcessSnapshot {
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
			"--state-root",
			stateRoot,
		},
	}
}

func TestBuildRuntimeProcessInventorySeparatesIdentityLayoutAndAuthority(t *testing.T) {
	options := testInventoryOptions(t)
	currentExecutable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	current := testSnapshot(options, 10, 100, currentExecutable, options.StateRoot)
	incomplete := testSnapshot(options, 13, 130, currentExecutable, options.StateRoot)
	incomplete.ExecutableInode = 0
	untrustedLayout := testSnapshot(options, 14, 140, filepath.Join(options.RuntimeRoot, "other", "redeven"), options.StateRoot)
	differentNamespace := testSnapshot(options, 15, 150, currentExecutable, options.StateRoot)
	differentNamespace.NamespaceID = "mnt:[container]"
	differentUser := testSnapshot(options, 16, 160, currentExecutable, options.StateRoot)
	differentUser.UserIdentity = "someone-else"
	differentStateRoot := testSnapshot(options, 17, 170, currentExecutable, filepath.Join(options.StateRoot, "other"))

	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{
			current,
			incomplete,
			untrustedLayout,
			differentNamespace,
			differentUser,
			differentStateRoot,
			current,
		},
	)

	if len(inventory.Instances) != 3 {
		t.Fatalf("instances = %#v, want three scoped and deduplicated processes", inventory.Instances)
	}
	byPID := map[int]RuntimeProcessInstance{}
	for _, instance := range inventory.Instances {
		byPID[instance.PID] = instance
	}
	if got := byPID[10]; got.IdentityStatus != RuntimeProcessIdentityVerified ||
		got.LayoutStatus != RuntimeProcessLayoutCurrent ||
		got.StopAuthority != RuntimeProcessStopAutomatic ||
		got.ReasonCode != "" {
		t.Fatalf("current = %#v", got)
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
	if inventory.Summary.Automatic != 1 || inventory.Summary.Blocked != 2 {
		t.Fatalf("summary = %#v", inventory.Summary)
	}
	if len(inventory.InventoryDigest) != 64 {
		t.Fatalf("inventory digest = %q", inventory.InventoryDigest)
	}
}

func TestBuildRuntimeProcessInventoryExcludesDifferentRuntimeScopes(t *testing.T) {
	root := t.TempDir()
	optionsA := RuntimeProcessInventoryOptions{
		RuntimeRoot: filepath.Join(root, "desktop-a", "runtime"),
		StateRoot:   filepath.Join(root, "desktop-a", "state"),
	}
	optionsB := RuntimeProcessInventoryOptions{
		RuntimeRoot: filepath.Join(root, "desktop-b", "runtime"),
		StateRoot:   filepath.Join(root, "desktop-b", "state"),
	}
	executableA := filepath.Join(optionsA.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	executableB := filepath.Join(optionsB.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshotA := testSnapshot(optionsA, 101, 1_001, executableA, optionsA.StateRoot)
	snapshotB := testSnapshot(optionsB, 102, 1_002, executableB, optionsB.StateRoot)

	inventoryA := buildRuntimeProcessInventory(
		optionsA,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshotA, snapshotB},
	)
	inventoryB := buildRuntimeProcessInventory(
		optionsB,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshotA, snapshotB},
	)
	if len(inventoryA.Instances) != 1 || inventoryA.Instances[0].PID != snapshotA.PID {
		t.Fatalf("runtime A inventory = %#v", inventoryA)
	}
	if len(inventoryB.Instances) != 1 || inventoryB.Instances[0].PID != snapshotB.PID {
		t.Fatalf("runtime B inventory = %#v", inventoryB)
	}
}

func TestBuildRuntimeProcessInventoryExcludesManagedExecutableFromAnotherRuntimeRoot(t *testing.T) {
	root := t.TempDir()
	options := RuntimeProcessInventoryOptions{
		RuntimeRoot: filepath.Join(root, "desktop-a", "runtime"),
		StateRoot:   filepath.Join(root, "desktop-a", "state"),
	}
	foreignExecutable := filepath.Join(root, "desktop-b", "runtime", "runtime", "managed", "bin", "redeven")
	foreign := testSnapshot(options, 103, 1_003, foreignExecutable, options.StateRoot)
	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{foreign},
	)
	if len(inventory.Instances) != 0 {
		t.Fatalf("foreign runtime-root process was inventoried: %#v", inventory)
	}
}

func TestRuntimeProcessInventoryAllowsVerifiedAlternateBundle(t *testing.T) {
	options := testInventoryOptions(t)
	alternateExecutable := filepath.Join(filepath.Dir(options.RuntimeRoot), "Redeven Preview.app", "Contents", "Resources", "redeven")
	snapshot := testSnapshot(options, 21, 210, alternateExecutable, options.StateRoot)
	body, err := json.Marshal(runtimeLockMetadata{
		PID:            snapshot.PID,
		InstanceID:     "alternate-runtime",
		RuntimeVersion: "v4.0.0",
	})
	if err != nil {
		t.Fatal(err)
	}
	writeRuntimeLeaseTestFile(t, filepath.Join(options.StateRoot, "local-environment", "agent.lock"), body)

	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	if len(inventory.Instances) != 1 {
		t.Fatalf("instances = %#v", inventory.Instances)
	}
	instance := inventory.Instances[0]
	if instance.IdentityStatus != RuntimeProcessIdentityVerified ||
		instance.LayoutStatus != RuntimeProcessLayoutVerifiedAlternate ||
		instance.StopAuthority != RuntimeProcessStopAutomatic ||
		instance.ReasonCode != "" ||
		instance.InstanceID != "alternate-runtime" ||
		instance.RuntimeVersion != "v4.0.0" {
		t.Fatalf("instance = %#v", instance)
	}
}

func TestRuntimeProcessInventoryBlocksUnprovenAlternateBundle(t *testing.T) {
	for _, test := range []struct {
		name string
		lock *runtimeLockMetadata
	}{
		{name: "missing lock"},
		{name: "different pid", lock: &runtimeLockMetadata{PID: 99, InstanceID: "alternate-runtime", RuntimeVersion: "v4.0.0"}},
		{name: "missing instance id", lock: &runtimeLockMetadata{PID: 22, RuntimeVersion: "v4.0.0"}},
		{name: "missing runtime version", lock: &runtimeLockMetadata{PID: 22, InstanceID: "alternate-runtime"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := testInventoryOptions(t)
			alternateExecutable := filepath.Join(filepath.Dir(options.RuntimeRoot), "Redeven Preview.app", "Contents", "Resources", "redeven")
			snapshot := testSnapshot(options, 22, 220, alternateExecutable, options.StateRoot)
			if test.lock != nil {
				body, err := json.Marshal(test.lock)
				if err != nil {
					t.Fatal(err)
				}
				writeRuntimeLeaseTestFile(t, filepath.Join(options.StateRoot, "local-environment", "agent.lock"), body)
			}

			inventory := buildRuntimeProcessInventory(
				options,
				runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
				[]runtimeProcessSnapshot{snapshot},
			)
			if len(inventory.Instances) != 1 {
				t.Fatalf("instances = %#v", inventory.Instances)
			}
			instance := inventory.Instances[0]
			if instance.IdentityStatus != RuntimeProcessIdentityIncomplete ||
				instance.LayoutStatus != RuntimeProcessLayoutUnknown ||
				instance.StopAuthority != RuntimeProcessStopBlocked ||
				instance.ReasonCode != "runtime_layout_untrusted" {
				t.Fatalf("instance = %#v", instance)
			}
		})
	}
}

func TestRuntimeProcessInventoryBlocksMissingUserOrExecutableIdentity(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	missingUser := testSnapshot(options, 17, 170, executable, options.StateRoot)
	missingUser.UserIdentity = ""
	missingExecutableIdentity := testSnapshot(options, 18, 180, executable, options.StateRoot)
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
	snapshot := testSnapshot(options, 20, 200, executable, options.StateRoot)
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
	snapshot := testSnapshot(options, 30, 300, executable, options.StateRoot)
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
		[]runtimeProcessSnapshot{testSnapshot(options, 40, 400, executable, options.StateRoot)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, "different-digest", time.Second)
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
	blocked := testSnapshot(options, 41, 410, executable, options.StateRoot)
	blocked.ExecutableInode = 0
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{blocked},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryBlocked {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent for blocking inventory")
	}
}

func TestStopRuntimeProcessesRejectsPIDReuseBeforeSignal(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	snapshot := testSnapshot(options, 42, 420, executable, options.StateRoot)
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
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorIdentityChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after PID reuse")
	}
}

func TestStopRuntimeProcessesRejectsAlternateExecutableIdentityChangeBeforeSignal(t *testing.T) {
	options := testInventoryOptions(t)
	alternateExecutable := filepath.Join(filepath.Dir(options.RuntimeRoot), "Redeven Preview.app", "Contents", "Resources", "redeven")
	snapshot := testSnapshot(options, 84, 840, alternateExecutable, options.StateRoot)
	body, err := json.Marshal(runtimeLockMetadata{
		PID:            snapshot.PID,
		InstanceID:     "alternate-runtime",
		RuntimeVersion: "v4.0.0",
	})
	if err != nil {
		t.Fatal(err)
	}
	writeRuntimeLeaseTestFile(t, filepath.Join(options.StateRoot, "local-environment", "agent.lock"), body)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	snapshot.ExecutableInode++
	changed := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, changed}}
	_, err = stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorIdentityChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after executable identity changed")
	}
}

func TestStopRuntimeProcessesRejectsProcessExitBeforeSignalSet(t *testing.T) {
	options := testInventoryOptions(t)
	executable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 43, 430, executable, options.StateRoot)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		emptyInventoryFrom(before),
	}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
	first := testSnapshot(options, 44, 440, executable, options.StateRoot)
	second := testSnapshot(options, 45, 450, executable, options.StateRoot)
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
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
	first := testSnapshot(options, 46, 460, executable, options.StateRoot)
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first},
	)
	newProcess := testSnapshot(options, 47, 470, executable, options.StateRoot)
	newProcess.ExecutableInode = 0
	changed := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{first, newProcess},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, changed}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
		[]runtimeProcessSnapshot{testSnapshot(options, 46, 460, executable, options.StateRoot)},
	)
	lockPath := filepath.Join(options.StateRoot, "local-environment", "agent.lock")
	if err := os.MkdirAll(lockPath, 0o755); err != nil {
		t.Fatal(err)
	}
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{before, before}}
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
	first := testSnapshot(options, 50, 500, executable, options.StateRoot)
	second := testSnapshot(options, 51, 510, executable, options.StateRoot)
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
	result, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
		[]runtimeProcessSnapshot{testSnapshot(options, 70, 700, executable, options.StateRoot)},
	)
	after := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 71, 710, executable, options.StateRoot)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
		before,
		after,
	}}
	result, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
		[]runtimeProcessSnapshot{testSnapshot(options, 60, 600, executable, options.StateRoot)},
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
		[]runtimeProcessSnapshot{testSnapshot(options, 92, 920, executable, options.StateRoot)},
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
