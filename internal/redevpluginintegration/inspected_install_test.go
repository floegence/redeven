package redevpluginintegration

import (
	"context"
	"testing"
	"time"

	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/registry"
)

func installInspectedTestPackage(t *testing.T, ctx context.Context, h *host.Host, inspectionID, packageHash string) registry.PluginRecord {
	t.Helper()
	requestID := "acceptance-" + inspectionID
	operation, err := h.StartInspectedInstall(ctx, host.StartInspectedInstallRequest{RequestID: requestID, InspectionID: inspectionID, ExpectedPackageSHA256: packageHash})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for operation.Execution.TerminalAt == nil {
		if time.Now().After(deadline) {
			t.Fatal("inspected installation did not finish")
		}
		time.Sleep(10 * time.Millisecond)
		operation, err = h.GetInspectedInstall(ctx, requestID)
		if err != nil {
			t.Fatal(err)
		}
	}
	if operation.MutationOutcome != "committed" {
		t.Fatalf("installation failed: %+v", operation)
	}
	records, err := h.ListPlugins(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.PluginInstanceID == operation.Execution.PluginInstanceID {
			return record
		}
	}
	t.Fatal("committed plugin is missing from inventory")
	return registry.PluginRecord{}
}
