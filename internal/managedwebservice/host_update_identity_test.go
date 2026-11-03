package managedwebservice

import (
	"context"
	"os"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// Installation verifies the same package but enriches its trust metadata.
type verifiedHostUpdateDriver struct {
	deploymentDriver
	starts []pfregistry.ManagedService
	stops  []string
}

func (d *verifiedHostUpdateDriver) Install(_ context.Context, service *pfregistry.ManagedService, _ operationProgress) (string, string, error) {
	identity, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		return "", "", err
	}
	identity.Trust = "registry_verified"
	service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256, err = canonicalReleaseIdentity(*identity)
	return "", "", err
}
func (d *verifiedHostUpdateDriver) Start(_ context.Context, service *pfregistry.ManagedService) (string, error) {
	d.starts = append(d.starts, *service)
	return "verified-host-target", nil
}
func (d *verifiedHostUpdateDriver) Stop(_ context.Context, service *pfregistry.ManagedService) error {
	d.stops = append(d.stops, service.RuntimeIdentity)
	return nil
}
func (d *verifiedHostUpdateDriver) Observe(_ context.Context, _ *pfregistry.ManagedService) (bool, error) {
	return true, nil
}

func TestHostReleaseUpdateCommitsInstalledRuntimeWithoutPendingChanges(t *testing.T) {
	for _, desired := range []string{"running", "stopped"} {
		t.Run(desired, func(t *testing.T) {
			fixture := newUpdatePlanFixture(t)
			manager, service := fixture.manager, fixture.service
			service.DesiredState, service.ObservedState = desired, desired
			service.RuntimeIdentity = "previous-host"
			if err := os.MkdirAll(service.WorkspacePath, 0700); err != nil {
				t.Fatal(err)
			}
			old, err := manager.resolveCurrentRuntime(context.Background(), &service)
			if err != nil {
				t.Fatal(err)
			}
			service.RuntimeSpecSHA256 = old.RuntimeSpecSHA256
			target, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
			if err != nil {
				t.Fatal(err)
			}
			target.Version, target.Integrity = "2.0.0", testNPMIntegrity("recommended")
			driver := &verifiedHostUpdateDriver{}
			manager.host = driver
			healthy := false
			manager.healthCheck = func(_ context.Context, checked *pfregistry.ManagedService) error {
				healthy = checked.RuntimeIdentity == "verified-host-target"
				return nil
			}
			operation := pfregistry.ManagedOperation{OperationID: "host-update-regression", ServiceID: service.ServiceID, RequestID: "host-update-request", RequestFingerprint: "fingerprint", Action: "update", State: "running", ProgressTotal: 7}
			if err := fixture.registry.CreateManagedOperation(context.Background(), operation); err != nil {
				t.Fatal(err)
			}
			if err := manager.runHostReleaseUpdate(context.Background(), &service, &operation, nil, cachedReleaseCandidate{Identity: *target}, driver); err != nil {
				t.Fatal(err)
			}
			if !healthy || len(driver.starts) != 1 {
				t.Fatalf("update did not start and verify once: healthy=%v starts=%d", healthy, len(driver.starts))
			}
			stored, err := fixture.registry.GetManagedService(context.Background(), service.ServiceID)
			if err != nil {
				t.Fatal(err)
			}
			resolved, err := manager.resolveCurrentRuntime(context.Background(), stored)
			if err != nil {
				t.Fatal(err)
			}
			if !sameAppliedRuntime(resolved, stored) {
				t.Fatal("successful update still requires Apply and restart")
			}
			if driver.starts[0].RuntimeSpecSHA256 != stored.RuntimeSpecSHA256 {
				t.Fatal("launch and committed runtime identities differ")
			}
			if stored.DesiredState != desired || stored.ObservedState != desired || stored.RuntimeManifestJSON != "{}" {
				t.Fatalf("update did not preserve state and settle its journal: %+v", stored)
			}
			if len(driver.stops) != 1 || (desired == "running" && driver.stops[0] != "previous-host") || (desired == "stopped" && driver.stops[0] != "verified-host-target") {
				t.Fatalf("unexpected stop sequence: %v", driver.stops)
			}
		})
	}
}
