package runtimemanagement

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func targetSnapshot(root string, pid int, parentPID int, binary string, command string) runtimeProcessSnapshot {
	executable := filepath.Join(root, "runtime", "managed", "bin", binary)
	return runtimeProcessSnapshot{
		PID:                    pid,
		ParentPID:              parentPID,
		ProcessStartedAtUnixMS: int64(pid) * 100,
		UserIdentity:           "tester",
		NamespaceID:            "mnt:[target]",
		ExecutablePath:         executable,
		ExecutableDevice:       1,
		ExecutableInode:        uint64(pid + 1000),
		Args:                   []string{binary, command, "--state-root", filepath.Join(root, "state")},
	}
}

func TestBuildTargetProcessInventoryFindsEveryRedevenRoleAndManagedChildren(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".redeven")
	runtime := targetSnapshot(root, 101, 1, "redeven", "run")
	runtimeBridge := targetSnapshot(root, 102, 1, "redeven", "desktop-bridge")
	gateway := targetSnapshot(root, 103, 1, "redeven-gateway", "serve")
	gatewayBridge := targetSnapshot(root, 104, 1, "redeven-gateway", "desktop-bridge")
	localUI := targetSnapshot(root, 105, runtime.PID, "redevplugin-runtime", "serve")
	localUI.Args = []string{localUI.ExecutablePath, "serve"}
	child := targetSnapshot(root, 106, gateway.PID, "worker", "run")
	child.ExecutablePath = "/usr/bin/worker"
	child.Args = []string{"worker", "--task"}
	externalReader := targetSnapshot(root, 107, 1, "viewer", "run")
	externalReader.ExecutablePath = "/usr/bin/viewer"
	externalReader.Args = []string{"viewer", filepath.Join(root, "workspace", "readme.md")}
	foreignRuntime := targetSnapshot(filepath.Join(t.TempDir(), ".redeven"), 108, 1, "redeven", "run")

	inventory := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		[]runtimeProcessSnapshot{runtime, runtimeBridge, gateway, gatewayBridge, localUI, child, externalReader, foreignRuntime},
	)

	roles := map[string]int{}
	for _, instance := range inventory.Instances {
		roles[instance.Role]++
	}
	for _, role := range []string{"runtime", "runtime_bridge", "gateway", "gateway_bridge", "managed_process", "managed_child"} {
		if roles[role] != 1 {
			t.Fatalf("role %q count = %d, inventory = %#v", role, roles[role], inventory.Instances)
		}
	}
	if len(inventory.Instances) != 6 || inventory.Summary.Automatic != 6 || inventory.Summary.Blocked != 0 {
		t.Fatalf("inventory = %#v", inventory)
	}
}

func TestBuildTargetProcessInventoryBlocksOnlyAmbiguousRedevenIdentity(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".redeven")
	ambiguous := targetSnapshot(root, 201, 1, "redeven-gateway", "serve")
	ambiguous.ExecutableInode = 0
	external := targetSnapshot(root, 202, 1, "viewer", "run")
	external.ExecutablePath = "/usr/bin/viewer"
	external.Args = []string{"viewer", filepath.Join(root, "database.sqlite")}

	inventory := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		[]runtimeProcessSnapshot{ambiguous, external},
	)
	if len(inventory.Instances) != 1 || inventory.Summary.Blocked != 1 {
		t.Fatalf("inventory = %#v", inventory)
	}
	if inventory.Instances[0].ReasonCode != "target_process_identity_incomplete" {
		t.Fatalf("reason = %q", inventory.Instances[0].ReasonCode)
	}
}

type fakeTargetProcessController struct {
	inventories []TargetProcessInventory
	index       int
	terminated  []int
	killed      []int
}

func (controller *fakeTargetProcessController) Inspect(context.Context, TargetProcessOptions) (TargetProcessInventory, error) {
	if len(controller.inventories) == 0 {
		return TargetProcessInventory{}, errors.New("missing fake inventory")
	}
	index := controller.index
	if index >= len(controller.inventories) {
		index = len(controller.inventories) - 1
	}
	controller.index++
	return controller.inventories[index], nil
}

func (controller *fakeTargetProcessController) Terminate(pid int) error {
	controller.terminated = append(controller.terminated, pid)
	return nil
}

func (controller *fakeTargetProcessController) Kill(pid int) error {
	controller.killed = append(controller.killed, pid)
	return nil
}

func (*fakeTargetProcessController) Wait(context.Context, time.Duration) error { return nil }

func TestStopTargetProcessesUsesTerminateThenIdentityCheckedKill(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".redeven")
	snapshot := targetSnapshot(root, 301, 1, "redeven", "run")
	before := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	empty := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		nil,
	)
	controller := &fakeTargetProcessController{inventories: []TargetProcessInventory{before, before, before, before, empty}}
	result, err := stopTargetProcesses(context.Background(), controller, TargetProcessOptions{TargetRoot: root}, before.InventoryDigest, time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	if len(controller.terminated) != 1 || controller.terminated[0] != snapshot.PID {
		t.Fatalf("terminated = %#v", controller.terminated)
	}
	if len(controller.killed) != 1 || controller.killed[0] != snapshot.PID {
		t.Fatalf("killed = %#v", controller.killed)
	}
	if len(result.After.Instances) != 0 {
		t.Fatalf("after = %#v", result.After)
	}
}

func TestStopTargetProcessesRejectsPIDReuseBeforeKill(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".redeven")
	snapshot := targetSnapshot(root, 401, 1, "redeven-gateway", "serve")
	before := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		[]runtimeProcessSnapshot{snapshot},
	)
	reusedSnapshot := snapshot
	reusedSnapshot.ProcessStartedAtUnixMS++
	reused := buildTargetProcessInventory(
		TargetProcessOptions{TargetRoot: root},
		runtimeProcessExecutionScope{UserIdentity: "tester", NamespaceID: "mnt:[target]"},
		[]runtimeProcessSnapshot{reusedSnapshot},
	)
	controller := &fakeTargetProcessController{inventories: []TargetProcessInventory{before, before, reused}}
	_, err := stopTargetProcesses(context.Background(), controller, TargetProcessOptions{TargetRoot: root}, before.InventoryDigest, time.Nanosecond)
	if RuntimeProcessErrorCode(err) != RuntimeProcessErrorIdentityChanged {
		t.Fatalf("error = %v", err)
	}
	if len(controller.killed) != 0 {
		t.Fatalf("reused PID was killed: %#v", controller.killed)
	}
}

func TestNormalizeTargetProcessOptionsRejectsRootHomeAndAllowsMissingDedicatedRoot(t *testing.T) {
	if _, err := normalizeTargetProcessOptions(TargetProcessOptions{TargetRoot: string(filepath.Separator)}); err == nil {
		t.Fatal("filesystem root was accepted")
	}
	if home, err := os.UserHomeDir(); err == nil {
		if _, normalizeErr := normalizeTargetProcessOptions(TargetProcessOptions{TargetRoot: home}); normalizeErr == nil {
			t.Fatal("user home was accepted")
		}
	}
	dedicated := filepath.Join(t.TempDir(), "missing-redeven-root")
	if normalized, err := normalizeTargetProcessOptions(TargetProcessOptions{TargetRoot: dedicated}); err != nil || normalized.TargetRoot != dedicated {
		t.Fatalf("dedicated missing root = %#v, %v", normalized, err)
	}
}
