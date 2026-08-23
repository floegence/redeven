package runtimemanagement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const TargetProcessInventorySchemaVersion = 1

type TargetProcessOptions struct {
	TargetRoot string
}

type TargetProcessInstance struct {
	PID                    int                          `json:"pid"`
	ParentPID              int                          `json:"parent_pid,omitempty"`
	ProcessStartedAtUnixMS int64                        `json:"process_started_at_unix_ms"`
	Role                   string                       `json:"role"`
	ExecutablePath         string                       `json:"executable_path"`
	ExecutableDeleted      bool                         `json:"executable_deleted,omitempty"`
	NamespaceID            string                       `json:"namespace_id,omitempty"`
	ExecutableDevice       uint64                       `json:"executable_device,omitempty"`
	ExecutableInode        uint64                       `json:"executable_inode,omitempty"`
	IdentityStatus         RuntimeProcessIdentityStatus `json:"identity_status"`
	StopAuthority          RuntimeProcessStopAuthority  `json:"stop_authority"`
	ReasonCode             string                       `json:"reason_code,omitempty"`
}

type TargetProcessInventory struct {
	SchemaVersion   int                            `json:"schema_version"`
	TargetRoot      string                         `json:"target_root"`
	UserIdentity    string                         `json:"user_identity,omitempty"`
	NamespaceID     string                         `json:"namespace_id,omitempty"`
	InventoryDigest string                         `json:"inventory_digest"`
	Instances       []TargetProcessInstance        `json:"instances"`
	Summary         RuntimeProcessInventorySummary `json:"summary"`
}

type TargetProcessStopResult struct {
	SchemaVersion int                     `json:"schema_version"`
	Before        TargetProcessInventory  `json:"before"`
	After         TargetProcessInventory  `json:"after"`
	Stopped       []TargetProcessInstance `json:"stopped,omitempty"`
}

func normalizeTargetProcessOptions(options TargetProcessOptions) (TargetProcessOptions, error) {
	root, err := absoluteCleanPath(options.TargetRoot)
	if err != nil {
		return TargetProcessOptions{}, fmt.Errorf("resolve target root: %w", err)
	}
	if root == "" || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return TargetProcessOptions{}, errors.New("target root must be a dedicated Redeven directory")
	}
	if current, currentErr := os.UserHomeDir(); currentErr == nil {
		home, _ := absoluteCleanPath(current)
		if comparableRuntimePath(root) == comparableRuntimePath(home) {
			return TargetProcessOptions{}, errors.New("target root must not be the user home directory")
		}
	}
	return TargetProcessOptions{TargetRoot: root}, nil
}

func pathWithinTarget(candidate string, root string) bool {
	cleanCandidate := comparableRuntimePath(candidate)
	cleanRoot := comparableRuntimePath(root)
	if cleanCandidate == "" || cleanRoot == "" || cleanCandidate == cleanRoot {
		return cleanCandidate == cleanRoot
	}
	relative, err := filepath.Rel(cleanRoot, cleanCandidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func targetProcessFlagPaths(args []string) []string {
	paths := make([]string, 0, 2)
	for index := 2; index < len(args); index++ {
		arg := strings.TrimSpace(args[index])
		for _, flagName := range []string{"--state-root", "--runtime-root"} {
			if arg == flagName && index+1 < len(args) {
				if clean, _ := absoluteCleanPath(args[index+1]); clean != "" {
					paths = append(paths, clean)
				}
			}
			if strings.HasPrefix(arg, flagName+"=") {
				if clean, _ := absoluteCleanPath(strings.TrimPrefix(arg, flagName+"=")); clean != "" {
					paths = append(paths, clean)
				}
			}
		}
	}
	return paths
}

func targetProcessKnownRole(snapshot runtimeProcessSnapshot, targetRoot string) (string, bool) {
	if len(snapshot.Args) < 2 {
		return "", false
	}
	binary := filepath.Base(strings.TrimSpace(snapshot.Args[0]))
	command := strings.TrimSpace(snapshot.Args[1])
	role := ""
	switch binary {
	case "redeven":
		switch command {
		case "run":
			role = "runtime"
		case "desktop-bridge":
			role = "runtime_bridge"
		}
	case "redeven-gateway":
		switch command {
		case "serve":
			role = "gateway"
		case "desktop-bridge":
			role = "gateway_bridge"
		}
	}
	if role == "" {
		return "", false
	}
	for _, candidate := range targetProcessFlagPaths(snapshot.Args) {
		if pathWithinTarget(candidate, targetRoot) {
			return role, true
		}
	}
	return "", false
}

func targetOwnedExecutable(executablePath string, targetRoot string) bool {
	// The exact Redeven target root is an exclusive product-owned directory.
	// During destructive recovery, every executable loaded from that root is a
	// Redeven process regardless of its historical filename or layout. Merely
	// reading files below the root does not grant an external process ownership.
	return pathWithinTarget(executablePath, targetRoot)
}

func targetProcessIdentityComplete(snapshot runtimeProcessSnapshot, scope runtimeProcessExecutionScope) (bool, string) {
	if snapshot.PID <= 0 || snapshot.ProcessStartedAtUnixMS <= 0 || snapshot.ExecutablePath == "" || snapshot.ExecutableDevice == 0 || snapshot.ExecutableInode == 0 {
		return false, "target_process_identity_incomplete"
	}
	if scope.UserIdentity != "" && snapshot.UserIdentity == "" {
		return false, "target_process_user_identity_unavailable"
	}
	if scope.UserIdentity != "" && scope.UserIdentity != snapshot.UserIdentity {
		return false, "target_process_user_identity_mismatch"
	}
	if scope.NamespaceID != "" && snapshot.NamespaceID == "" {
		return false, "target_process_namespace_unavailable"
	}
	if scope.NamespaceID != "" && scope.NamespaceID != snapshot.NamespaceID {
		return false, "target_process_namespace_mismatch"
	}
	return true, ""
}

func buildTargetProcessInventory(options TargetProcessOptions, scope runtimeProcessExecutionScope, snapshots []runtimeProcessSnapshot) TargetProcessInventory {
	type matchedProcess struct {
		snapshot runtimeProcessSnapshot
		role     string
	}
	matched := make(map[int]matchedProcess)
	for _, snapshot := range snapshots {
		role, known := targetProcessKnownRole(snapshot, options.TargetRoot)
		if !known && targetOwnedExecutable(snapshot.ExecutablePath, options.TargetRoot) {
			role, known = "target_root_process", true
		}
		if known && snapshot.PID != os.Getpid() {
			matched[snapshot.PID] = matchedProcess{snapshot: snapshot, role: role}
		}
	}
	for changed := true; changed; {
		changed = false
		for _, snapshot := range snapshots {
			if snapshot.PID == os.Getpid() {
				continue
			}
			if _, exists := matched[snapshot.PID]; exists {
				continue
			}
			if _, parentMatched := matched[snapshot.ParentPID]; parentMatched {
				matched[snapshot.PID] = matchedProcess{snapshot: snapshot, role: "managed_child"}
				changed = true
			}
		}
	}
	instances := make([]TargetProcessInstance, 0, len(matched))
	for _, item := range matched {
		complete, reason := targetProcessIdentityComplete(item.snapshot, scope)
		identity := RuntimeProcessIdentityIncomplete
		authority := RuntimeProcessStopBlocked
		if complete {
			identity = RuntimeProcessIdentityVerified
			authority = RuntimeProcessStopAutomatic
		}
		instances = append(instances, TargetProcessInstance{
			PID:                    item.snapshot.PID,
			ParentPID:              item.snapshot.ParentPID,
			ProcessStartedAtUnixMS: item.snapshot.ProcessStartedAtUnixMS,
			Role:                   item.role,
			ExecutablePath:         item.snapshot.ExecutablePath,
			ExecutableDeleted:      item.snapshot.ExecutableDeleted,
			NamespaceID:            item.snapshot.NamespaceID,
			ExecutableDevice:       item.snapshot.ExecutableDevice,
			ExecutableInode:        item.snapshot.ExecutableInode,
			IdentityStatus:         identity,
			StopAuthority:          authority,
			ReasonCode:             reason,
		})
	}
	sort.Slice(instances, func(left, right int) bool {
		if instances[left].ProcessStartedAtUnixMS != instances[right].ProcessStartedAtUnixMS {
			return instances[left].ProcessStartedAtUnixMS < instances[right].ProcessStartedAtUnixMS
		}
		return instances[left].PID < instances[right].PID
	})
	summary := RuntimeProcessInventorySummary{}
	for _, instance := range instances {
		if instance.StopAuthority == RuntimeProcessStopAutomatic {
			summary.Automatic++
		} else {
			summary.Blocked++
		}
	}
	inventory := TargetProcessInventory{
		SchemaVersion: TargetProcessInventorySchemaVersion,
		TargetRoot:    options.TargetRoot,
		UserIdentity:  scope.UserIdentity,
		NamespaceID:   scope.NamespaceID,
		Instances:     instances,
		Summary:       summary,
	}
	inventory.InventoryDigest = targetProcessInventoryDigest(inventory)
	return inventory
}

func targetProcessIdentityKey(instance TargetProcessInstance) string {
	return strings.Join([]string{
		strconv.Itoa(instance.PID),
		strconv.Itoa(instance.ParentPID),
		strconv.FormatInt(instance.ProcessStartedAtUnixMS, 10),
		instance.NamespaceID,
		instance.ExecutablePath,
		strconv.FormatUint(instance.ExecutableDevice, 10),
		strconv.FormatUint(instance.ExecutableInode, 10),
	}, "\x00")
}

func targetProcessInventoryDigest(inventory TargetProcessInventory) string {
	body, _ := json.Marshal(struct {
		SchemaVersion int                     `json:"schema_version"`
		TargetRoot    string                  `json:"target_root"`
		Instances     []TargetProcessInstance `json:"instances"`
	}{inventory.SchemaVersion, inventory.TargetRoot, inventory.Instances})
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func InspectTargetProcesses(ctx context.Context, options TargetProcessOptions) (TargetProcessInventory, error) {
	normalized, err := normalizeTargetProcessOptions(options)
	if err != nil {
		return TargetProcessInventory{}, err
	}
	snapshots, err := loadSystemProcessSnapshots(ctx, nil)
	if err != nil {
		return TargetProcessInventory{}, err
	}
	return buildTargetProcessInventory(normalized, currentRuntimeProcessExecutionScope(), snapshots), nil
}

func targetProcessInstanceByPID(inventory TargetProcessInventory, pid int) (TargetProcessInstance, bool) {
	for _, instance := range inventory.Instances {
		if instance.PID == pid {
			return instance, true
		}
	}
	return TargetProcessInstance{}, false
}

func targetProcessInstancesEqual(left TargetProcessInstance, right TargetProcessInstance) bool {
	return targetProcessIdentityKey(left) == targetProcessIdentityKey(right) && left.StopAuthority == right.StopAuthority
}

type targetProcessController interface {
	Inspect(context.Context, TargetProcessOptions) (TargetProcessInventory, error)
	Terminate(int) error
	Kill(int) error
	Wait(context.Context, time.Duration) error
}

type systemTargetProcessController struct{}

func (systemTargetProcessController) Inspect(ctx context.Context, options TargetProcessOptions) (TargetProcessInventory, error) {
	return InspectTargetProcesses(ctx, options)
}

func (systemTargetProcessController) Terminate(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(syscall.Signal(15))
}

func (systemTargetProcessController) Kill(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}

func (systemTargetProcessController) Wait(ctx context.Context, duration time.Duration) error {
	return runtimeProcessWait(ctx, duration)
}

func StopTargetProcesses(ctx context.Context, options TargetProcessOptions, expectedDigest string, gracePeriod time.Duration) (TargetProcessStopResult, error) {
	return stopTargetProcesses(ctx, systemTargetProcessController{}, options, expectedDigest, gracePeriod)
}

// StopTargetProcessesBestEffort is used only by destructive maintenance. It
// attempts to stop processes that are positively identified as Redeven-owned,
// skips entries whose identity is incomplete, and never turns an incomplete
// inventory into a lifecycle block. SIGKILL remains identity-checked.
func StopTargetProcessesBestEffort(ctx context.Context, options TargetProcessOptions, gracePeriod time.Duration) (TargetProcessStopResult, error) {
	return stopTargetProcessesBestEffort(ctx, systemTargetProcessController{}, options, gracePeriod)
}

func stopTargetProcessesBestEffort(ctx context.Context, controller targetProcessController, options TargetProcessOptions, gracePeriod time.Duration) (TargetProcessStopResult, error) {
	before, err := controller.Inspect(ctx, options)
	if err != nil {
		return TargetProcessStopResult{}, err
	}
	result := TargetProcessStopResult{SchemaVersion: TargetProcessInventorySchemaVersion, Before: before, After: before}
	for _, target := range before.Instances {
		if target.StopAuthority != RuntimeProcessStopAutomatic {
			continue
		}
		current, inspectErr := controller.Inspect(ctx, options)
		if inspectErr != nil {
			return result, inspectErr
		}
		candidate, exists := targetProcessInstanceByPID(current, target.PID)
		if !exists || !targetProcessInstancesEqual(target, candidate) {
			continue
		}
		if signalErr := controller.Terminate(target.PID); signalErr != nil && !errors.Is(signalErr, os.ErrProcessDone) {
			return result, signalErr
		}
	}
	if gracePeriod <= 0 {
		gracePeriod = 5 * time.Second
	}
	deadline := time.Now().Add(gracePeriod)
	for time.Now().Before(deadline) {
		after, inspectErr := controller.Inspect(ctx, options)
		if inspectErr != nil {
			return result, inspectErr
		}
		result.After = after
		if len(after.Instances) == 0 {
			return result, nil
		}
		if err := controller.Wait(ctx, 100*time.Millisecond); err != nil {
			return result, err
		}
	}
	observed, err := controller.Inspect(ctx, options)
	if err != nil {
		return result, err
	}
	for _, target := range before.Instances {
		if target.StopAuthority != RuntimeProcessStopAutomatic {
			continue
		}
		candidate, exists := targetProcessInstanceByPID(observed, target.PID)
		if !exists || !targetProcessInstancesEqual(target, candidate) {
			continue
		}
		if killErr := controller.Kill(target.PID); killErr != nil && !errors.Is(killErr, os.ErrProcessDone) {
			return result, killErr
		}
	}
	result.After, err = controller.Inspect(ctx, options)
	return result, err
}

func stopTargetProcesses(ctx context.Context, controller targetProcessController, options TargetProcessOptions, expectedDigest string, gracePeriod time.Duration) (TargetProcessStopResult, error) {
	before, err := controller.Inspect(ctx, options)
	if err != nil {
		return TargetProcessStopResult{}, err
	}
	result := TargetProcessStopResult{SchemaVersion: TargetProcessInventorySchemaVersion, Before: before, After: before}
	if strings.TrimSpace(expectedDigest) == "" || before.InventoryDigest != strings.TrimSpace(expectedDigest) {
		return result, runtimeProcessOperationError(RuntimeProcessErrorInventoryChanged, "Redeven target process inventory changed before stop")
	}
	if before.Summary.Blocked > 0 {
		return result, runtimeProcessOperationError(RuntimeProcessErrorInventoryBlocked, "Redeven target contains a process whose identity cannot be safely verified")
	}
	if len(before.Instances) == 0 {
		return result, nil
	}
	committed, err := controller.Inspect(ctx, options)
	if err != nil {
		return result, err
	}
	if committed.InventoryDigest != before.InventoryDigest {
		return result, runtimeProcessOperationError(RuntimeProcessErrorInventoryChanged, "Redeven target process inventory changed before signals")
	}
	for _, target := range before.Instances {
		// Re-read the identity immediately before signalling each PID. This
		// keeps PID reuse fail-closed even when another process exits between
		// the committed inventory check and the signal loop.
		current, inspectErr := controller.Inspect(ctx, options)
		if inspectErr != nil {
			return result, inspectErr
		}
		candidate, exists := targetProcessInstanceByPID(current, target.PID)
		if !exists {
			continue
		}
		if !targetProcessInstancesEqual(target, candidate) {
			return result, runtimeProcessOperationError(RuntimeProcessErrorIdentityChanged, fmt.Sprintf("Redeven target process %d changed identity before signal", target.PID))
		}
		if signalErr := controller.Terminate(target.PID); signalErr != nil && !errors.Is(signalErr, os.ErrProcessDone) {
			return result, signalErr
		}
	}
	if gracePeriod <= 0 {
		gracePeriod = 5 * time.Second
	}
	waitUntil := time.Now().Add(gracePeriod)
	for time.Now().Before(waitUntil) {
		observed, inspectErr := controller.Inspect(ctx, options)
		if inspectErr != nil {
			return result, inspectErr
		}
		remaining := false
		for _, target := range before.Instances {
			candidate, exists := targetProcessInstanceByPID(observed, target.PID)
			if exists && targetProcessInstancesEqual(target, candidate) {
				remaining = true
				break
			}
		}
		if !remaining {
			break
		}
		if err := controller.Wait(ctx, 100*time.Millisecond); err != nil {
			return result, err
		}
	}
	observed, err := controller.Inspect(ctx, options)
	if err != nil {
		return result, err
	}
	for _, target := range before.Instances {
		candidate, exists := targetProcessInstanceByPID(observed, target.PID)
		if !exists {
			continue
		}
		if !targetProcessInstancesEqual(target, candidate) {
			return result, runtimeProcessOperationError(RuntimeProcessErrorIdentityChanged, fmt.Sprintf("Redeven target process %d changed identity", target.PID))
		}
		if killErr := controller.Kill(target.PID); killErr != nil && !errors.Is(killErr, os.ErrProcessDone) {
			return result, killErr
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		after, inspectErr := controller.Inspect(ctx, options)
		if inspectErr != nil {
			return result, inspectErr
		}
		result.After = after
		result.Stopped = append([]TargetProcessInstance(nil), before.Instances...)
		if len(after.Instances) == 0 {
			return result, nil
		}
		if !time.Now().Before(deadline) {
			return result, runtimeProcessOperationError(RuntimeProcessErrorStopTimeout, fmt.Sprintf("%d Redeven target process(es) remained", len(after.Instances)))
		}
		if err := controller.Wait(ctx, 100*time.Millisecond); err != nil {
			return result, err
		}
	}
}
