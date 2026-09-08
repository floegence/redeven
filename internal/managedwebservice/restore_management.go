package managedwebservice

import (
	"context"
	"os"
	"strconv"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// Only native process facts are disclosed. Command arguments, environment,
// opening URLs and private credentials never enter the review response.
type HostManagementReview struct {
	ServiceID     string `json:"service_id"`
	SavedIdentity string `json:"saved_identity"`
	Fingerprint   string `json:"fingerprint"`
	PID           int    `json:"pid"`
	ProcessGroup  int    `json:"process_group"`
	Executable    string `json:"executable"`
	UserID        string `json:"user_id"`
	Birth         string `json:"birth"`
}

type RestoreManagementRequest struct {
	SavedIdentity string `json:"saved_identity"`
	Fingerprint   string `json:"fingerprint"`
	Confirmed     bool   `json:"confirmed"`
}

func (m *Manager) reviewHostManagement(ctx context.Context, serviceID string) (*HostManagementReview, *pfregistry.ManagedService, managedProcessSnapshot, error) {
	service, _, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, nil, managedProcessSnapshot{}, err
	}
	active, err := m.registry.GetActiveManagedOperation(ctx, serviceID)
	if err != nil {
		return nil, nil, managedProcessSnapshot{}, err
	}
	if active != nil {
		return nil, nil, managedProcessSnapshot{}, serviceError("OPERATION_CONFLICT", "Wait for the service operation before restoring management.", 409, true, nil)
	}
	parsed := parseHostIdentity(service.RuntimeIdentity)
	if parsed.version != "v2" || parsed.serviceID != serviceID || parsed.pid <= 0 {
		return nil, nil, managedProcessSnapshot{}, serviceError("HOST_RECOVERY_NOT_REQUIRED", "Only a saved legacy Host instance can be rebound through this review.", 409, false, nil)
	}
	snapshot, err := readManagedProcess(parsed.pid)
	if err != nil || snapshot.Group != parsed.pid || snapshot.User != strconv.Itoa(os.Getuid()) {
		return nil, nil, managedProcessSnapshot{}, serviceError("HOST_RECOVERY_UNAVAILABLE", "The saved process is unavailable or does not belong to this user and process group.", 409, true, nil)
	}
	review := &HostManagementReview{ServiceID: serviceID, SavedIdentity: service.RuntimeIdentity, Fingerprint: snapshot.fingerprint(), PID: snapshot.PID, ProcessGroup: snapshot.Group, Executable: snapshot.Command, UserID: snapshot.User, Birth: snapshot.Birth}
	return review, service, snapshot, nil
}

func (m *Manager) ReviewHostManagement(ctx context.Context, serviceID string) (*HostManagementReview, error) {
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	review, _, _, err := m.reviewHostManagement(ctx, serviceID)
	return review, err
}

func (m *Manager) RestoreHostManagement(ctx context.Context, serviceID string, request RestoreManagementRequest) error {
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	if !request.Confirmed {
		return serviceError("HOST_RECOVERY_CONFIRMATION_REQUIRED", "Review and confirm the current process before restoring management.", 400, false, nil)
	}
	review, service, snapshot, err := m.reviewHostManagement(ctx, serviceID)
	if err != nil {
		return err
	}
	if review.SavedIdentity != request.SavedIdentity || review.Fingerprint != request.Fingerprint {
		return serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The process changed after review. Review its current identity again.", 409, true, nil)
	}
	driver, ok := m.host.(*hostScriptDriver)
	if !ok {
		return serviceError("HOST_RECOVERY_UNAVAILABLE", "The Host manager is unavailable.", 503, true, nil)
	}
	driver.recoveryMu.Lock()
	defer driver.recoveryMu.Unlock()
	if err := driver.commitHostIdentityUpgrade(service, snapshot); err != nil {
		return err
	}
	running, blank := "running", ""
	return m.registry.UpdateManagedService(ctx, serviceID, pfregistry.ManagedServicePatch{DesiredState: &running, ObservedState: &running, LastErrorCode: &blank, LastErrorMessage: &blank})
}
