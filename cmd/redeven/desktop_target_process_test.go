package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

func TestDesktopTargetProcessCommandsUseExactRootAndInventoryDigest(t *testing.T) {
	targetRoot := filepath.Join(t.TempDir(), "managed-redeven")
	code, stdout, stderr := runCLITest(t,
		"desktop-target-process-inventory",
		"--target-root", targetRoot,
	)
	if code != 0 || stderr != "" {
		t.Fatalf("inventory code=%d stderr=%q", code, stderr)
	}
	var inventory runtimemanagement.TargetProcessInventory
	if err := json.Unmarshal([]byte(stdout), &inventory); err != nil {
		t.Fatal(err)
	}
	if inventory.SchemaVersion != 1 || inventory.TargetRoot != targetRoot || inventory.InventoryDigest == "" {
		t.Fatalf("inventory = %#v", inventory)
	}

	code, stdout, stderr = runCLITest(t,
		"desktop-target-process-stop",
		"--target-root", targetRoot,
		"--expected-inventory-digest", inventory.InventoryDigest,
		"--grace-period", "1ms",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("stop code=%d stderr=%q stdout=%q", code, stderr, stdout)
	}
	var result runtimemanagement.TargetProcessStopResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != 1 || len(result.After.Instances) != 0 {
		t.Fatalf("result = %#v", result)
	}
}

func TestDesktopTargetProcessInventoryRejectsBroadRoot(t *testing.T) {
	code, stdout, _ := runCLITest(t, "desktop-target-process-inventory", "--target-root", filepath.VolumeName(t.TempDir())+string(filepath.Separator))
	if code == 0 {
		t.Fatalf("broad root unexpectedly succeeded: %s", stdout)
	}
}
