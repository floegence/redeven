package runtimemanagement

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
)

const (
	RuntimeProcessErrorInventoryChanged = "runtime_inventory_changed"
	RuntimeProcessErrorInventoryBlocked = "runtime_inventory_blocked"
	RuntimeProcessErrorTakeoverRequired = "runtime_takeover_confirmation_required"
	RuntimeProcessErrorIdentityChanged  = "runtime_process_identity_changed"
	RuntimeProcessErrorLeaseCleanup     = "runtime_lock_cleanup_failed"
	RuntimeProcessErrorStopTimeout      = "runtime_stop_timeout"
)

type RuntimeProcessReconciliationMode string

const (
	RuntimeProcessReconciliationAutomatic         RuntimeProcessReconciliationMode = "automatic"
	RuntimeProcessReconciliationConfirmedTakeover RuntimeProcessReconciliationMode = "confirmed_takeover"
)

type RuntimeProcessOperationError struct {
	Code string `json:"code"`
	Msg  string `json:"message"`
}

func (e *RuntimeProcessOperationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Msg
}

type RuntimeProcessStopResult struct {
	SchemaVersion int                      `json:"schema_version"`
	Before        RuntimeProcessInventory  `json:"before"`
	After         RuntimeProcessInventory  `json:"after"`
	Stopped       []RuntimeProcessInstance `json:"stopped,omitempty"`

	leaseSnapshots []runtimeProcessLeaseSnapshot
}

type runtimeProcessLeaseSnapshot struct {
	LockPath   string
	Body       []byte
	PID        int
	InstanceID string
}

type runtimeProcessController interface {
	Inspect(context.Context, RuntimeProcessInventoryOptions) (RuntimeProcessInventory, error)
	Interrupt(int) error
	Kill(int) error
	Wait(context.Context, time.Duration) error
}

type systemRuntimeProcessController struct{}

func (systemRuntimeProcessController) Inspect(ctx context.Context, options RuntimeProcessInventoryOptions) (RuntimeProcessInventory, error) {
	return InspectRuntimeProcesses(ctx, options)
}

func (systemRuntimeProcessController) Interrupt(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(os.Interrupt)
}

func (systemRuntimeProcessController) Kill(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}

func (systemRuntimeProcessController) Wait(ctx context.Context, duration time.Duration) error {
	return runtimeProcessWait(ctx, duration)
}

func runtimeProcessOperationError(code string, message string) error {
	return &RuntimeProcessOperationError{Code: code, Msg: strings.TrimSpace(message)}
}

func RuntimeProcessErrorCode(err error) string {
	var operationErr *RuntimeProcessOperationError
	if errors.As(err, &operationErr) {
		return operationErr.Code
	}
	return ""
}

func inventoryInstanceByPID(inventory RuntimeProcessInventory, pid int) (RuntimeProcessInstance, bool) {
	for _, instance := range inventory.Instances {
		if instance.PID == pid {
			return instance, true
		}
	}
	return RuntimeProcessInstance{}, false
}

func verifyRuntimeProcessInstance(
	ctx context.Context,
	controller runtimeProcessController,
	options RuntimeProcessInventoryOptions,
	expected RuntimeProcessInstance,
) error {
	inventory, err := controller.Inspect(ctx, options)
	if err != nil {
		return err
	}
	observed, exists := inventoryInstanceByPID(inventory, expected.PID)
	if !exists {
		return os.ErrProcessDone
	}
	if !runtimeProcessInstancesEqual(expected, observed) {
		return runtimeProcessOperationError(
			RuntimeProcessErrorIdentityChanged,
			fmt.Sprintf("runtime process %d changed identity before it could be stopped", expected.PID),
		)
	}
	return nil
}

func verifyRuntimeProcessInventoryBeforeSignals(
	expected RuntimeProcessInventory,
	observed RuntimeProcessInventory,
) error {
	if observed.InventoryDigest == expected.InventoryDigest {
		return nil
	}
	for _, expectedInstance := range expected.Instances {
		observedInstance, exists := inventoryInstanceByPID(observed, expectedInstance.PID)
		if exists && !runtimeProcessInstancesEqual(expectedInstance, observedInstance) {
			return runtimeProcessOperationError(
				RuntimeProcessErrorIdentityChanged,
				fmt.Sprintf("runtime process %d changed identity before the stop signal set was committed", expectedInstance.PID),
			)
		}
	}
	return runtimeProcessOperationError(
		RuntimeProcessErrorInventoryChanged,
		"runtime process inventory changed before the stop signal set was committed",
	)
}

func remainingExpectedRuntimeProcesses(
	inventory RuntimeProcessInventory,
	expected []RuntimeProcessInstance,
) []RuntimeProcessInstance {
	remaining := make([]RuntimeProcessInstance, 0, len(expected))
	for _, instance := range expected {
		observed, exists := inventoryInstanceByPID(inventory, instance.PID)
		if exists && runtimeProcessInstancesEqual(instance, observed) {
			remaining = append(remaining, instance)
		}
	}
	return remaining
}

func waitForRuntimeProcesses(
	ctx context.Context,
	controller runtimeProcessController,
	options RuntimeProcessInventoryOptions,
	expected []RuntimeProcessInstance,
	timeout time.Duration,
) (RuntimeProcessInventory, []RuntimeProcessInstance, error) {
	deadline := time.Now().Add(timeout)
	for {
		inventory, err := controller.Inspect(ctx, options)
		if err != nil {
			return RuntimeProcessInventory{}, nil, err
		}
		remaining := remainingExpectedRuntimeProcesses(inventory, expected)
		if len(remaining) == 0 || !time.Now().Before(deadline) {
			return inventory, remaining, nil
		}
		if err := controller.Wait(ctx, 100*time.Millisecond); err != nil {
			return RuntimeProcessInventory{}, nil, err
		}
	}
}

func stopRuntimeProcesses(
	ctx context.Context,
	controller runtimeProcessController,
	options RuntimeProcessInventoryOptions,
	expectedDigest string,
	gracePeriod time.Duration,
	reconciliationMode RuntimeProcessReconciliationMode,
) (RuntimeProcessStopResult, error) {
	before, err := controller.Inspect(ctx, options)
	if err != nil {
		return RuntimeProcessStopResult{}, err
	}
	schemaVersion := before.SchemaVersion
	if strings.TrimSpace(expectedDigest) == "" || before.InventoryDigest != strings.TrimSpace(expectedDigest) {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryChanged,
			"runtime process inventory changed before the stop operation began",
		)
	}
	if reconciliationMode == "" {
		reconciliationMode = RuntimeProcessReconciliationAutomatic
	}
	if reconciliationMode != RuntimeProcessReconciliationAutomatic && reconciliationMode != RuntimeProcessReconciliationConfirmedTakeover {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryBlocked,
			"runtime process reconciliation mode is invalid",
		)
	}
	if before.Summary.Blocked > 0 {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryBlocked,
			"runtime process inventory contains an instance whose core identity cannot be safely verified",
		)
	}
	if reconciliationMode == RuntimeProcessReconciliationAutomatic && before.Summary.ConfirmedTakeover > 0 {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorTakeoverRequired,
			"runtime process inventory requires explicit confirmed takeover",
		)
	}
	targets := make([]RuntimeProcessInstance, 0, len(before.Instances))
	for _, instance := range before.Instances {
		if instance.StopAuthority == RuntimeProcessStopAutomatic ||
			(reconciliationMode == RuntimeProcessReconciliationConfirmedTakeover && instance.StopAuthority == RuntimeProcessStopConfirmedTakeover) {
			targets = append(targets, instance)
		}
	}
	if len(targets) == 0 {
		return RuntimeProcessStopResult{
			SchemaVersion: schemaVersion,
			Before:        before,
			After:         before,
		}, nil
	}
	leaseSnapshots, err := captureRuntimeProcessLeaseSnapshots(targets)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, err
	}
	committed, err := controller.Inspect(ctx, options)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, err
	}
	if err := verifyRuntimeProcessInventoryBeforeSignals(before, committed); err != nil {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before, After: committed}, err
	}
	for _, target := range targets {
		if err := controller.Interrupt(target.PID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return RuntimeProcessStopResult{
				SchemaVersion:  schemaVersion,
				Before:         before,
				leaseSnapshots: leaseSnapshots,
			}, err
		}
	}
	if gracePeriod <= 0 {
		gracePeriod = 5 * time.Second
	}
	afterGrace, remaining, err := waitForRuntimeProcesses(ctx, controller, options, targets, gracePeriod)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before}, err
	}
	for _, target := range remaining {
		if err := verifyRuntimeProcessInstance(ctx, controller, options, target); err != nil {
			if errors.Is(err, os.ErrProcessDone) {
				continue
			}
			return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before, After: afterGrace}, err
		}
		if err := controller.Kill(target.PID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before, After: afterGrace}, err
		}
	}
	after, remaining, err := waitForRuntimeProcesses(ctx, controller, options, targets, 5*time.Second)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: schemaVersion, Before: before, After: afterGrace}, err
	}
	result := RuntimeProcessStopResult{
		SchemaVersion:  schemaVersion,
		Before:         before,
		After:          after,
		Stopped:        append([]RuntimeProcessInstance(nil), targets...),
		leaseSnapshots: leaseSnapshots,
	}
	if len(remaining) > 0 {
		return result, runtimeProcessOperationError(
			RuntimeProcessErrorStopTimeout,
			fmt.Sprintf("%d runtime process(es) remained after the stop deadline", len(remaining)),
		)
	}
	if len(after.Instances) > 0 {
		return result, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryChanged,
			fmt.Sprintf("runtime process inventory contains %d new or changed instance(s) after stop", len(after.Instances)),
		)
	}
	return result, nil
}

func runtimeProcessLeaseIdentity(body []byte) (int, string, bool) {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return 0, "", false
	}
	var metadata runtimeLockMetadata
	if json.Unmarshal(body, &metadata) == nil && metadata.PID > 0 {
		return metadata.PID, strings.TrimSpace(metadata.InstanceID), true
	}
	return 0, "", false
}

func runtimeProcessTargetPIDsByStateRoot(instances []RuntimeProcessInstance) map[string]map[int]struct{} {
	result := make(map[string]map[int]struct{})
	for _, instance := range instances {
		stateRoot := strings.TrimSpace(instance.StateRoot)
		if stateRoot == "" || instance.PID <= 0 {
			continue
		}
		if result[stateRoot] == nil {
			result[stateRoot] = make(map[int]struct{})
		}
		result[stateRoot][instance.PID] = struct{}{}
	}
	return result
}

func captureRuntimeProcessLeaseSnapshots(instances []RuntimeProcessInstance) ([]runtimeProcessLeaseSnapshot, error) {
	snapshots := make([]runtimeProcessLeaseSnapshot, 0, len(instances))
	capturedPaths := make(map[string]struct{})
	targetPIDsByStateRoot := runtimeProcessTargetPIDsByStateRoot(instances)
	visitedStateRoots := make(map[string]struct{})
	for _, instance := range instances {
		stateRoot := strings.TrimSpace(instance.StateRoot)
		if _, visited := visitedStateRoots[stateRoot]; visited {
			continue
		}
		visitedStateRoots[stateRoot] = struct{}{}
		targetPIDs := targetPIDsByStateRoot[stateRoot]
		if len(targetPIDs) == 0 {
			continue
		}
		for _, lockPath := range runtimeLockPaths(stateRoot) {
			if _, captured := capturedPaths[lockPath]; captured {
				continue
			}
			body, err := os.ReadFile(lockPath)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return nil, runtimeProcessOperationError(
					RuntimeProcessErrorLeaseCleanup,
					fmt.Sprintf("read runtime lock %s before process stop: %v", lockPath, err),
				)
			}
			pid, instanceID, ok := runtimeProcessLeaseIdentity(body)
			if !ok {
				continue
			}
			if _, target := targetPIDs[pid]; !target {
				continue
			}
			snapshots = append(snapshots, runtimeProcessLeaseSnapshot{
				LockPath:   lockPath,
				Body:       append([]byte(nil), body...),
				PID:        pid,
				InstanceID: instanceID,
			})
			capturedPaths[lockPath] = struct{}{}
		}
	}
	return snapshots, nil
}

func retireRuntimeProcessLeases(ctx context.Context, snapshots []runtimeProcessLeaseSnapshot) error {
	for _, snapshot := range snapshots {
		lockPath := snapshot.LockPath
		if strings.TrimSpace(lockPath) == "" || snapshot.PID <= 0 || len(snapshot.Body) == 0 {
			return runtimeProcessOperationError(
				RuntimeProcessErrorLeaseCleanup,
				"runtime lease snapshot is incomplete",
			)
		}
		deadline := time.Now().Add(2 * time.Second)
		for {
			_, err := lockfile.RetireIf(lockPath, func(body []byte) (bool, error) {
				if len(strings.TrimSpace(string(body))) == 0 {
					return false, nil
				}
				if bytes.Equal(body, snapshot.Body) {
					return true, nil
				}
				pid, instanceID, ok := runtimeProcessLeaseIdentity(body)
				if !ok {
					return false, runtimeProcessOperationError(
						RuntimeProcessErrorLeaseCleanup,
						fmt.Sprintf("runtime lock %s contains unrecognized lease metadata after process stop", lockPath),
					)
				}
				if pid != snapshot.PID {
					return false, runtimeProcessOperationError(
						RuntimeProcessErrorInventoryChanged,
						fmt.Sprintf("runtime lock %s changed from pid %d to pid %d after process stop", lockPath, snapshot.PID, pid),
					)
				}
				if instanceID != snapshot.InstanceID {
					return false, runtimeProcessOperationError(
						RuntimeProcessErrorInventoryChanged,
						fmt.Sprintf("runtime lock %s changed instance identity after process stop", lockPath),
					)
				}
				return false, runtimeProcessOperationError(
					RuntimeProcessErrorInventoryChanged,
					fmt.Sprintf("runtime lock %s changed lease content after process stop", lockPath),
				)
			})
			if err == nil || errors.Is(err, os.ErrNotExist) {
				break
			}
			if !errors.Is(err, lockfile.ErrAlreadyLocked) {
				if RuntimeProcessErrorCode(err) != "" {
					return err
				}
				return runtimeProcessOperationError(
					RuntimeProcessErrorLeaseCleanup,
					fmt.Sprintf("retire runtime lock %s: %v", lockPath, err),
				)
			}
			if !time.Now().Before(deadline) {
				return runtimeProcessOperationError(
					RuntimeProcessErrorLeaseCleanup,
					fmt.Sprintf("runtime lock %s remained held after process stop", lockPath),
				)
			}
			if err := runtimeProcessWait(ctx, 50*time.Millisecond); err != nil {
				return err
			}
		}
	}
	return nil
}

func completeRuntimeProcessStop(
	ctx context.Context,
	controller runtimeProcessController,
	options RuntimeProcessInventoryOptions,
	result RuntimeProcessStopResult,
) (RuntimeProcessStopResult, error) {
	leaseErr := retireRuntimeProcessLeases(ctx, result.leaseSnapshots)
	after, err := controller.Inspect(ctx, options)
	if err != nil {
		return result, err
	}
	result.After = after
	if len(after.Instances) > 0 {
		return result, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryChanged,
			fmt.Sprintf("runtime process inventory contains %d instance(s) after lease cleanup", len(after.Instances)),
		)
	}
	if leaseErr != nil {
		return result, leaseErr
	}
	return result, nil
}

func StopRuntimeProcesses(
	ctx context.Context,
	options RuntimeProcessInventoryOptions,
	expectedDigest string,
	gracePeriod time.Duration,
) (RuntimeProcessStopResult, error) {
	return StopRuntimeProcessesWithMode(
		ctx,
		options,
		expectedDigest,
		gracePeriod,
		RuntimeProcessReconciliationAutomatic,
	)
}

func StopRuntimeProcessesWithMode(
	ctx context.Context,
	options RuntimeProcessInventoryOptions,
	expectedDigest string,
	gracePeriod time.Duration,
	reconciliationMode RuntimeProcessReconciliationMode,
) (RuntimeProcessStopResult, error) {
	normalized, err := normalizeRuntimeInventoryOptions(options)
	if err != nil {
		return RuntimeProcessStopResult{}, err
	}
	controller := systemRuntimeProcessController{}
	result, err := stopRuntimeProcesses(ctx, controller, normalized, expectedDigest, gracePeriod, reconciliationMode)
	if err != nil {
		return result, err
	}
	return completeRuntimeProcessStop(ctx, controller, normalized, result)
}
