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
		RuntimeRoot:        filepath.Join(root, ".redeven"),
		StateRoot:          filepath.Join(root, ".redeven"),
		DesktopOwnerID:     "desktop-owner",
		IncludeKnownLegacy: true,
		LegacyRuntimeRoots: []string{filepath.Join(root, ".cache", "redeven-desktop", "runtime")},
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

func TestBuildRuntimeProcessInventoryClassifiesCurrentLegacyAndBlockingInstances(t *testing.T) {
	options := testInventoryOptions(t)
	legacyRoot := options.LegacyRuntimeRoots[0]
	currentExecutable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	legacyExecutable := filepath.Join(legacyRoot, "releases", "v0.5.10", "bin", "redeven")
	currentLegacyExecutable := filepath.Join(options.RuntimeRoot, "runtime", "releases", "v0.0.0-dev", "bin", "redeven")
	current := testSnapshot(options, 10, 100, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	ownedLegacy := testSnapshot(options, 11, 110, currentLegacyExecutable, options.StateRoot, options.DesktopOwnerID)
	ownedLegacy.ExecutableDeleted = true
	ownerlessLegacy := testSnapshot(
		options,
		12,
		120,
		legacyExecutable,
		filepath.Join(legacyRoot, "instances", "envinst_demo", "state"),
		"",
	)
	foreign := testSnapshot(options, 13, 130, currentExecutable, options.StateRoot, "another-desktop")
	ambiguous := testSnapshot(options, 14, 140, currentExecutable, options.StateRoot, "")
	differentNamespace := testSnapshot(options, 15, 150, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	differentNamespace.NamespaceID = "mnt:[container]"
	differentUser := testSnapshot(options, 16, 160, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	differentUser.UserIdentity = "someone-else"

	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{
			current,
			ownedLegacy,
			ownerlessLegacy,
			foreign,
			ambiguous,
			differentNamespace,
			differentUser,
			current,
		},
	)

	if len(inventory.Instances) != 5 {
		t.Fatalf("instances = %#v, want five scoped and deduplicated processes", inventory.Instances)
	}
	classifications := map[int]RuntimeProcessClassification{}
	for _, instance := range inventory.Instances {
		classifications[instance.PID] = instance.Classification
	}
	if classifications[10] != RuntimeProcessCurrentOwned {
		t.Fatalf("current classification = %q", classifications[10])
	}
	if classifications[11] != RuntimeProcessLegacyOwned {
		t.Fatalf("owned legacy classification = %q", classifications[11])
	}
	if classifications[12] != RuntimeProcessLegacyOwnerless {
		t.Fatalf("ownerless legacy classification = %q", classifications[12])
	}
	if classifications[13] != RuntimeProcessForeignOwner {
		t.Fatalf("foreign classification = %q", classifications[13])
	}
	if classifications[14] != RuntimeProcessAmbiguous {
		t.Fatalf("ambiguous classification = %q", classifications[14])
	}
	if inventory.Summary.Stoppable != 3 || inventory.Summary.Blocking != 2 {
		t.Fatalf("summary = %#v", inventory.Summary)
	}
	if len(inventory.InventoryDigest) != 64 {
		t.Fatalf("inventory digest = %q", inventory.InventoryDigest)
	}
}

func TestRuntimeProcessInventorySupportsHistoricalLayouts(t *testing.T) {
	options := testInventoryOptions(t)
	legacyRoot := options.LegacyRuntimeRoots[0]
	executable := filepath.Join(legacyRoot, "runtime", "releases", "v0.0.0-dev", "bin", "redeven")
	stateRoots := []string{
		legacyRoot,
		filepath.Join(legacyRoot, "local-environment", "state"),
		filepath.Join(legacyRoot, "local-environment", "state", "local-environment"),
		filepath.Join(legacyRoot, "machine", "state"),
		filepath.Join(legacyRoot, "instances", "envinst_012345", "state"),
		filepath.Join(legacyRoot, "scopes", "local", "default"),
		filepath.Join(options.RuntimeRoot, "instances", "envinst_current", "state"),
	}
	snapshots := make([]runtimeProcessSnapshot, 0, len(stateRoots))
	for index, stateRoot := range stateRoots {
		snapshots = append(snapshots, testSnapshot(options, 100+index, int64(1000+index), executable, stateRoot, ""))
	}
	inventory := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		snapshots,
	)
	if len(inventory.Instances) != len(stateRoots) {
		t.Fatalf("instances = %#v", inventory.Instances)
	}
	for _, instance := range inventory.Instances {
		if instance.Classification != RuntimeProcessLegacyOwnerless || !instance.Stoppable {
			t.Fatalf("instance = %#v", instance)
		}
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
	if inventory.Summary.Ambiguous != 2 || inventory.Summary.Blocking != 2 {
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
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{testSnapshot(options, 41, 410, executable, options.StateRoot, "foreign-owner")},
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
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
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
	_, err := stopRuntimeProcesses(context.Background(), controller, options, before.InventoryDigest, time.Second)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorInventoryChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.interrupts) != 0 || len(controller.kills) != 0 {
		t.Fatalf("signals were sent after a target exited before the signal set")
	}
}

func TestStopRuntimeProcessesStopsAllVerifiedInstancesAndVerifiesEmpty(t *testing.T) {
	options := testInventoryOptions(t)
	legacyRoot := options.LegacyRuntimeRoots[0]
	currentExecutable := filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	legacyExecutable := filepath.Join(legacyRoot, "releases", "v0.5.10", "bin", "redeven")
	current := testSnapshot(options, 50, 500, currentExecutable, options.StateRoot, options.DesktopOwnerID)
	legacy := testSnapshot(options, 51, 510, legacyExecutable, filepath.Join(legacyRoot, "local-environment", "state"), "")
	before := buildRuntimeProcessInventory(
		options,
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[current]"},
		[]runtimeProcessSnapshot{current, legacy},
	)
	after := emptyInventoryFrom(before)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{
		before,
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
		[]runtimeProcessSnapshot{testSnapshot(options, 60, 600, executable, options.StateRoot, options.DesktopOwnerID)},
	)
	controller := &fakeRuntimeProcessController{inventories: []RuntimeProcessInventory{emptyInventoryFrom(before)}}
	err := verifyRuntimeProcessInstance(context.Background(), controller, options, before.Instances[0])
	if !errors.Is(err, os.ErrProcessDone) {
		t.Fatalf("error = %v", err)
	}
}

func TestRetireStoppedRuntimeProcessLeasesClearsMatchingJSONAndLegacyPID(t *testing.T) {
	stateRoot := t.TempDir()
	jsonLockPath := filepath.Join(stateRoot, "agent.lock")
	jsonBody, err := json.Marshal(runtimeLockMetadata{PID: 81, InstanceID: "current"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(jsonLockPath, jsonBody, 0o600); err != nil {
		t.Fatal(err)
	}
	legacyLockPath := filepath.Join(stateRoot, "machine", "agent.lock")
	if err := os.MkdirAll(filepath.Dir(legacyLockPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyLockPath, []byte("82\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	instances := []RuntimeProcessInstance{
		{PID: 81, StateRoot: stateRoot},
		{PID: 82, StateRoot: stateRoot},
	}
	if err := retireStoppedRuntimeProcessLeases(context.Background(), instances); err != nil {
		t.Fatal(err)
	}
	for _, lockPath := range []string{jsonLockPath, legacyLockPath} {
		body, err := os.ReadFile(lockPath)
		if err != nil {
			t.Fatal(err)
		}
		if len(body) != 0 {
			t.Fatalf("lock %s content = %q, want empty", lockPath, string(body))
		}
	}
}

func TestRetireStoppedRuntimeProcessLeasesRejectsChangedOrMalformedLease(t *testing.T) {
	for _, test := range []struct {
		name     string
		body     string
		wantCode string
	}{
		{name: "changed pid", body: "92\n", wantCode: RuntimeProcessErrorInventoryChanged},
		{name: "malformed", body: "not a runtime lease\n", wantCode: RuntimeProcessErrorLeaseCleanup},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateRoot := t.TempDir()
			lockPath := filepath.Join(stateRoot, "agent.lock")
			if err := os.WriteFile(lockPath, []byte(test.body), 0o600); err != nil {
				t.Fatal(err)
			}
			err := retireStoppedRuntimeProcessLeases(context.Background(), []RuntimeProcessInstance{{PID: 91, StateRoot: stateRoot}})
			if RuntimeProcessErrorCode(err) != test.wantCode {
				t.Fatalf("error = %v, code = %q, want %q", err, RuntimeProcessErrorCode(err), test.wantCode)
			}
			body, readErr := os.ReadFile(lockPath)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if string(body) != test.body {
				t.Fatalf("lock content = %q, want preserved %q", string(body), test.body)
			}
		})
	}
}
