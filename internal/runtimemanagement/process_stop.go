package runtimemanagement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
)

const (
	RuntimeProcessErrorInventoryChanged = "runtime_inventory_changed"
	RuntimeProcessErrorInventoryBlocked = "runtime_inventory_blocked"
	RuntimeProcessErrorIdentityChanged  = "runtime_process_identity_changed"
	RuntimeProcessErrorLeaseCleanup     = "runtime_lock_cleanup_failed"
	RuntimeProcessErrorStopTimeout      = "runtime_stop_timeout"
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
) (RuntimeProcessStopResult, error) {
	before, err := controller.Inspect(ctx, options)
	if err != nil {
		return RuntimeProcessStopResult{}, err
	}
	if strings.TrimSpace(expectedDigest) == "" || before.InventoryDigest != strings.TrimSpace(expectedDigest) {
		return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryChanged,
			"runtime process inventory changed before the stop operation began",
		)
	}
	if RuntimeProcessInventoryHasBlockingInstances(before) {
		return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, runtimeProcessOperationError(
			RuntimeProcessErrorInventoryBlocked,
			"runtime process inventory contains an instance whose identity or owner cannot be safely stopped",
		)
	}
	targets := make([]RuntimeProcessInstance, 0, before.Summary.Stoppable)
	for _, instance := range before.Instances {
		if instance.Stoppable {
			targets = append(targets, instance)
		}
	}
	if len(targets) == 0 {
		return RuntimeProcessStopResult{
			SchemaVersion: RuntimeProcessInventorySchemaVersion,
			Before:        before,
			After:         before,
		}, nil
	}
	for _, target := range targets {
		if err := verifyRuntimeProcessInstance(ctx, controller, options, target); err != nil {
			if errors.Is(err, os.ErrProcessDone) {
				return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, runtimeProcessOperationError(
					RuntimeProcessErrorInventoryChanged,
					fmt.Sprintf("runtime process %d exited before the stop signal set was committed", target.PID),
				)
			}
			return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, err
		}
		if err := controller.Interrupt(target.PID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, err
		}
	}
	if gracePeriod <= 0 {
		gracePeriod = 5 * time.Second
	}
	afterGrace, remaining, err := waitForRuntimeProcesses(ctx, controller, options, targets, gracePeriod)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before}, err
	}
	for _, target := range remaining {
		if err := verifyRuntimeProcessInstance(ctx, controller, options, target); err != nil {
			if errors.Is(err, os.ErrProcessDone) {
				continue
			}
			return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before, After: afterGrace}, err
		}
		if err := controller.Kill(target.PID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before, After: afterGrace}, err
		}
	}
	after, remaining, err := waitForRuntimeProcesses(ctx, controller, options, targets, 5*time.Second)
	if err != nil {
		return RuntimeProcessStopResult{SchemaVersion: RuntimeProcessInventorySchemaVersion, Before: before, After: afterGrace}, err
	}
	result := RuntimeProcessStopResult{
		SchemaVersion: RuntimeProcessInventorySchemaVersion,
		Before:        before,
		After:         after,
		Stopped:       append([]RuntimeProcessInstance(nil), targets...),
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

func runtimeProcessLeasePID(body []byte) (int, bool) {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return 0, false
	}
	var metadata runtimeLockMetadata
	if json.Unmarshal(body, &metadata) == nil && metadata.PID > 0 {
		return metadata.PID, true
	}
	pid, err := strconv.Atoi(trimmed)
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, true
}

func stoppedRuntimeProcessPIDsByStateRoot(instances []RuntimeProcessInstance) map[string]map[int]struct{} {
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

func retireStoppedRuntimeProcessLeases(ctx context.Context, instances []RuntimeProcessInstance) error {
	for stateRoot, stoppedPIDs := range stoppedRuntimeProcessPIDsByStateRoot(instances) {
		for _, lockPath := range runtimeLockPaths(stateRoot) {
			deadline := time.Now().Add(2 * time.Second)
			for {
				_, err := lockfile.RetireIf(lockPath, func(body []byte) (bool, error) {
					if len(strings.TrimSpace(string(body))) == 0 {
						return false, nil
					}
					pid, ok := runtimeProcessLeasePID(body)
					if !ok {
						return false, runtimeProcessOperationError(
							RuntimeProcessErrorLeaseCleanup,
							fmt.Sprintf("runtime lock %s contains unrecognized active lease metadata", lockPath),
						)
					}
					if _, stopped := stoppedPIDs[pid]; !stopped {
						return false, runtimeProcessOperationError(
							RuntimeProcessErrorInventoryChanged,
							fmt.Sprintf("runtime lock %s changed to pid %d after process stop", lockPath, pid),
						)
					}
					return true, nil
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
	}
	return nil
}

func StopRuntimeProcesses(
	ctx context.Context,
	options RuntimeProcessInventoryOptions,
	expectedDigest string,
	gracePeriod time.Duration,
) (RuntimeProcessStopResult, error) {
	normalized, err := normalizeRuntimeInventoryOptions(options)
	if err != nil {
		return RuntimeProcessStopResult{}, err
	}
	controller := systemRuntimeProcessController{}
	result, err := stopRuntimeProcesses(ctx, controller, normalized, expectedDigest, gracePeriod)
	if err != nil {
		return result, err
	}
	if err := retireStoppedRuntimeProcessLeases(ctx, result.Stopped); err != nil {
		return result, err
	}
	after, err := controller.Inspect(ctx, normalized)
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
	return result, nil
}
