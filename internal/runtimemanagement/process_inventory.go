package runtimemanagement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	processlib "github.com/shirou/gopsutil/v4/process"
)

const RuntimeProcessInventorySchemaVersion = 3

type RuntimeProcessIdentityStatus string

const (
	RuntimeProcessIdentityVerified   RuntimeProcessIdentityStatus = "verified"
	RuntimeProcessIdentityIncomplete RuntimeProcessIdentityStatus = "incomplete"
)

type RuntimeProcessLayoutStatus string

const (
	RuntimeProcessLayoutCurrent           RuntimeProcessLayoutStatus = "current"
	RuntimeProcessLayoutVerifiedAlternate RuntimeProcessLayoutStatus = "verified_alternate"
	RuntimeProcessLayoutUnknown           RuntimeProcessLayoutStatus = "unknown"
)

type RuntimeProcessStopAuthority string

const (
	RuntimeProcessStopAutomatic RuntimeProcessStopAuthority = "automatic"
	RuntimeProcessStopBlocked   RuntimeProcessStopAuthority = "blocked"
)

type RuntimeProcessInventoryOptions struct {
	RuntimeRoot        string
	StateRoot          string
	CurrentExecutables []string
}

type RuntimeProcessScope struct {
	RuntimeRoot  string `json:"runtime_root"`
	StateRoot    string `json:"state_root"`
	UserIdentity string `json:"user_identity,omitempty"`
	NamespaceID  string `json:"namespace_id,omitempty"`
}

type RuntimeProcessInstance struct {
	PID                    int                          `json:"pid"`
	ProcessStartedAtUnixMS int64                        `json:"process_started_at_unix_ms"`
	InstanceID             string                       `json:"instance_id,omitempty"`
	StateRoot              string                       `json:"state_root"`
	ExecutablePath         string                       `json:"executable_path"`
	ExecutableDeleted      bool                         `json:"executable_deleted,omitempty"`
	NamespaceID            string                       `json:"namespace_id,omitempty"`
	ExecutableDevice       uint64                       `json:"executable_device,omitempty"`
	ExecutableInode        uint64                       `json:"executable_inode,omitempty"`
	RuntimeVersion         string                       `json:"runtime_version,omitempty"`
	ReasonCode             string                       `json:"reason_code,omitempty"`
	IdentityStatus         RuntimeProcessIdentityStatus `json:"identity_status"`
	LayoutStatus           RuntimeProcessLayoutStatus   `json:"layout_status"`
	StopAuthority          RuntimeProcessStopAuthority  `json:"stop_authority"`
}

type RuntimeProcessInventorySummary struct {
	Automatic int `json:"automatic"`
	Blocked   int `json:"blocked"`
}

type RuntimeProcessInventory struct {
	SchemaVersion   int                            `json:"schema_version"`
	Scope           RuntimeProcessScope            `json:"scope"`
	InventoryDigest string                         `json:"inventory_digest"`
	Instances       []RuntimeProcessInstance       `json:"instances"`
	Summary         RuntimeProcessInventorySummary `json:"summary"`
}

type runtimeProcessSnapshot struct {
	PID                    int
	ProcessStartedAtUnixMS int64
	UserIdentity           string
	NamespaceID            string
	ExecutablePath         string
	ExecutableDeleted      bool
	ExecutableDevice       uint64
	ExecutableInode        uint64
	Args                   []string
	InstanceID             string
	RuntimeVersion         string
	RuntimeLockVerified    bool
}

type runtimeProcessExecutionScope struct {
	UserIdentity string
	NamespaceID  string
}

type runtimeLockMetadata struct {
	PID            int    `json:"pid"`
	InstanceID     string `json:"instance_id"`
	RuntimeVersion string `json:"runtime_version"`
}

func normalizeRuntimeInventoryOptions(options RuntimeProcessInventoryOptions) (RuntimeProcessInventoryOptions, error) {
	runtimeRoot, err := absoluteCleanPath(options.RuntimeRoot)
	if err != nil {
		return RuntimeProcessInventoryOptions{}, fmt.Errorf("resolve runtime root: %w", err)
	}
	stateRoot, err := absoluteCleanPath(options.StateRoot)
	if err != nil {
		return RuntimeProcessInventoryOptions{}, fmt.Errorf("resolve state root: %w", err)
	}
	if runtimeRoot == "" {
		return RuntimeProcessInventoryOptions{}, errors.New("runtime root is required")
	}
	if stateRoot == "" {
		return RuntimeProcessInventoryOptions{}, errors.New("state root is required")
	}
	return RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          stateRoot,
		CurrentExecutables: uniqueCleanPaths(options.CurrentExecutables),
	}, nil
}

func absoluteCleanPath(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

func uniqueCleanPaths(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		clean := filepath.Clean(strings.TrimSpace(value))
		if clean == "." || clean == "" {
			continue
		}
		if _, exists := seen[clean]; exists {
			continue
		}
		seen[clean] = struct{}{}
		result = append(result, clean)
	}
	sort.Strings(result)
	return result
}

func currentRuntimeProcessExecutionScope() runtimeProcessExecutionScope {
	identity := strconv.Itoa(os.Geteuid())
	if current, err := user.Current(); err == nil && strings.TrimSpace(current.Username) != "" {
		identity = strings.TrimSpace(current.Username)
	}
	return runtimeProcessExecutionScope{
		UserIdentity: identity,
		NamespaceID:  processMountNamespace(os.Getpid()),
	}
}

func processMountNamespace(pid int) string {
	if runtime.GOOS != "linux" || pid <= 0 {
		return ""
	}
	value, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "ns", "mnt"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func processExecutableIdentity(pid int, executablePath string) (uint64, uint64) {
	path := strings.TrimSpace(executablePath)
	if runtime.GOOS == "linux" && pid > 0 {
		path = filepath.Join("/proc", strconv.Itoa(pid), "exe")
	}
	if path == "" {
		return 0, 0
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, 0
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return 0, 0
	}
	return numericReflectField(value, "Dev"), numericReflectField(value, "Ino")
}

func numericReflectField(value reflect.Value, name string) uint64 {
	field := value.FieldByName(name)
	if !field.IsValid() {
		return 0
	}
	switch field.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return uint64(field.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return field.Uint()
	default:
		return 0
	}
}

func loadSystemRuntimeProcessSnapshots(ctx context.Context) ([]runtimeProcessSnapshot, error) {
	processes, err := processlib.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	snapshots := make([]runtimeProcessSnapshot, 0, len(processes))
	for _, candidate := range processes {
		args, argsErr := candidate.CmdlineSliceWithContext(ctx)
		if argsErr != nil || !runtimeProcessArgs(args) {
			continue
		}
		snapshot, snapshotErr := loadSystemRuntimeProcessSnapshot(ctx, candidate, args)
		if snapshotErr != nil {
			continue
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func loadSystemRuntimeProcessSnapshot(ctx context.Context, candidate *processlib.Process, args []string) (runtimeProcessSnapshot, error) {
	if candidate == nil || candidate.Pid <= 0 {
		return runtimeProcessSnapshot{}, errors.New("invalid process")
	}
	startedAt, err := candidate.CreateTimeWithContext(ctx)
	if err != nil || startedAt <= 0 {
		return runtimeProcessSnapshot{}, errors.New("process create time unavailable")
	}
	executablePath, _ := candidate.ExeWithContext(ctx)
	executableDeleted := strings.HasSuffix(strings.TrimSpace(executablePath), " (deleted)")
	executablePath = strings.TrimSuffix(strings.TrimSpace(executablePath), " (deleted)")
	if executablePath == "" && len(args) > 0 {
		executablePath = strings.TrimSuffix(strings.TrimSpace(args[0]), " (deleted)")
	}
	username, _ := candidate.UsernameWithContext(ctx)
	if strings.TrimSpace(username) == "" {
		if uids, uidErr := candidate.UidsWithContext(ctx); uidErr == nil && len(uids) > 0 {
			username = strconv.FormatUint(uint64(uids[0]), 10)
		}
	}
	device, inode := processExecutableIdentity(int(candidate.Pid), executablePath)
	return runtimeProcessSnapshot{
		PID:                    int(candidate.Pid),
		ProcessStartedAtUnixMS: startedAt,
		UserIdentity:           strings.TrimSpace(username),
		NamespaceID:            processMountNamespace(int(candidate.Pid)),
		ExecutablePath:         executablePath,
		ExecutableDeleted:      executableDeleted,
		ExecutableDevice:       device,
		ExecutableInode:        inode,
		Args:                   append([]string(nil), args...),
	}, nil
}

func runtimeProcessArgs(args []string) bool {
	return len(args) >= 2 && filepath.Base(strings.TrimSpace(args[0])) == "redeven" && strings.TrimSpace(args[1]) == "run"
}

func runtimeProcessStateRoot(args []string) string {
	for index := 2; index < len(args); index++ {
		arg := strings.TrimSpace(args[index])
		if arg == "--state-root" && index+1 < len(args) {
			clean, _ := absoluteCleanPath(args[index+1])
			return clean
		}
		if strings.HasPrefix(arg, "--state-root=") {
			clean, _ := absoluteCleanPath(strings.TrimPrefix(arg, "--state-root="))
			return clean
		}
	}
	return ""
}

func comparableRuntimePath(raw string) string {
	clean := filepath.Clean(strings.TrimSpace(raw))
	if clean == "." || clean == "" {
		return clean
	}
	if resolved, err := filepath.EvalSymlinks(clean); err == nil && strings.TrimSpace(resolved) != "" {
		return filepath.Clean(resolved)
	}
	return clean
}

func currentManagedExecutable(options RuntimeProcessInventoryOptions, executablePath string) bool {
	candidates := append([]string{
		filepath.Join(options.RuntimeRoot, "runtime", "managed", "bin", "redeven"),
	}, options.CurrentExecutables...)
	clean := comparableRuntimePath(executablePath)
	for _, expected := range candidates {
		if clean == comparableRuntimePath(expected) {
			return true
		}
	}
	return false
}

func managedRuntimeRootForExecutable(executablePath string) (string, bool) {
	clean := comparableRuntimePath(executablePath)
	suffix := filepath.Join("runtime", "managed", "bin", "redeven")
	marker := string(filepath.Separator) + suffix
	if !strings.HasSuffix(clean, marker) {
		return "", false
	}
	root := strings.TrimSuffix(clean, marker)
	if root == "" {
		return "", false
	}
	return filepath.Clean(root), true
}

func enrichRuntimeProcessSnapshot(snapshot runtimeProcessSnapshot, stateRoot string) runtimeProcessSnapshot {
	for _, lockPath := range runtimeLockPaths(stateRoot) {
		body, err := os.ReadFile(lockPath)
		if err != nil {
			continue
		}
		var metadata runtimeLockMetadata
		if json.Unmarshal(body, &metadata) != nil || metadata.PID != snapshot.PID {
			continue
		}
		snapshot.InstanceID = strings.TrimSpace(metadata.InstanceID)
		snapshot.RuntimeVersion = strings.TrimSpace(metadata.RuntimeVersion)
		snapshot.RuntimeLockVerified = snapshot.InstanceID != "" && snapshot.RuntimeVersion != ""
		break
	}
	return snapshot
}

func runtimeLockPaths(stateRoot string) []string {
	return []string{
		filepath.Join(stateRoot, "local-environment", "agent.lock"),
	}
}

func classifyRuntimeProcess(
	options RuntimeProcessInventoryOptions,
	scope runtimeProcessExecutionScope,
	snapshot runtimeProcessSnapshot,
) (RuntimeProcessInstance, bool) {
	stateRoot := runtimeProcessStateRoot(snapshot.Args)
	if stateRoot == "" || comparableRuntimePath(stateRoot) != comparableRuntimePath(options.StateRoot) {
		return RuntimeProcessInstance{}, false
	}
	if filepath.Base(snapshot.ExecutablePath) != "redeven" {
		return RuntimeProcessInstance{}, false
	}
	if managedRuntimeRoot, managed := managedRuntimeRootForExecutable(snapshot.ExecutablePath); managed &&
		comparableRuntimePath(managedRuntimeRoot) != comparableRuntimePath(options.RuntimeRoot) {
		return RuntimeProcessInstance{}, false
	}
	if scope.NamespaceID != "" && snapshot.NamespaceID != "" && scope.NamespaceID != snapshot.NamespaceID {
		return RuntimeProcessInstance{}, false
	}
	snapshot = enrichRuntimeProcessSnapshot(snapshot, stateRoot)
	reasonCode := "runtime_identity_incomplete"
	identityComplete := snapshot.PID > 0 &&
		snapshot.ProcessStartedAtUnixMS > 0 &&
		snapshot.ExecutablePath != "" &&
		snapshot.ExecutableDevice > 0 &&
		snapshot.ExecutableInode > 0
	if scope.UserIdentity != "" && snapshot.UserIdentity != "" && scope.UserIdentity != snapshot.UserIdentity {
		return RuntimeProcessInstance{}, false
	}
	if scope.UserIdentity != "" && snapshot.UserIdentity == "" {
		identityComplete = false
		reasonCode = "runtime_user_identity_unavailable"
	}
	if scope.NamespaceID != "" && snapshot.NamespaceID == "" {
		identityComplete = false
		reasonCode = "runtime_namespace_unavailable"
	}
	layoutStatus := RuntimeProcessLayoutUnknown
	if currentManagedExecutable(options, snapshot.ExecutablePath) {
		layoutStatus = RuntimeProcessLayoutCurrent
	} else if snapshot.RuntimeLockVerified {
		layoutStatus = RuntimeProcessLayoutVerifiedAlternate
	}
	if layoutStatus == RuntimeProcessLayoutUnknown {
		identityComplete = false
		reasonCode = "runtime_layout_untrusted"
	}
	identityStatus := RuntimeProcessIdentityIncomplete
	if identityComplete {
		identityStatus = RuntimeProcessIdentityVerified
	}
	stopAuthority := RuntimeProcessStopBlocked
	if identityComplete {
		stopAuthority = RuntimeProcessStopAutomatic
	}
	if identityComplete {
		reasonCode = ""
	}
	instance := RuntimeProcessInstance{
		PID:                    snapshot.PID,
		ProcessStartedAtUnixMS: snapshot.ProcessStartedAtUnixMS,
		InstanceID:             snapshot.InstanceID,
		StateRoot:              stateRoot,
		ExecutablePath:         snapshot.ExecutablePath,
		ExecutableDeleted:      snapshot.ExecutableDeleted,
		NamespaceID:            snapshot.NamespaceID,
		ExecutableDevice:       snapshot.ExecutableDevice,
		ExecutableInode:        snapshot.ExecutableInode,
		RuntimeVersion:         snapshot.RuntimeVersion,
		ReasonCode:             reasonCode,
		IdentityStatus:         identityStatus,
		LayoutStatus:           layoutStatus,
		StopAuthority:          stopAuthority,
	}
	return instance, true
}

func buildRuntimeProcessInventory(
	options RuntimeProcessInventoryOptions,
	scope runtimeProcessExecutionScope,
	snapshots []runtimeProcessSnapshot,
) RuntimeProcessInventory {
	instances := make([]RuntimeProcessInstance, 0, len(snapshots))
	seen := make(map[string]struct{}, len(snapshots))
	for _, snapshot := range snapshots {
		instance, matched := classifyRuntimeProcess(options, scope, snapshot)
		if !matched {
			continue
		}
		key := runtimeProcessIdentityKey(instance)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		instances = append(instances, instance)
	}
	sort.Slice(instances, func(left, right int) bool {
		if instances[left].ProcessStartedAtUnixMS != instances[right].ProcessStartedAtUnixMS {
			return instances[left].ProcessStartedAtUnixMS < instances[right].ProcessStartedAtUnixMS
		}
		return instances[left].PID < instances[right].PID
	})
	summary := RuntimeProcessInventorySummary{}
	for _, instance := range instances {
		switch instance.StopAuthority {
		case RuntimeProcessStopAutomatic:
			summary.Automatic++
		case RuntimeProcessStopBlocked:
			summary.Blocked++
		}
	}
	inventory := RuntimeProcessInventory{
		SchemaVersion: RuntimeProcessInventorySchemaVersion,
		Scope: RuntimeProcessScope{
			RuntimeRoot:  options.RuntimeRoot,
			StateRoot:    options.StateRoot,
			UserIdentity: scope.UserIdentity,
			NamespaceID:  scope.NamespaceID,
		},
		Instances: instances,
		Summary:   summary,
	}
	inventory.InventoryDigest = runtimeProcessInventoryDigest(inventory)
	return inventory
}

func runtimeProcessIdentityKey(instance RuntimeProcessInstance) string {
	return strings.Join([]string{
		strconv.Itoa(instance.PID),
		strconv.FormatInt(instance.ProcessStartedAtUnixMS, 10),
		instance.NamespaceID,
		instance.StateRoot,
		instance.ExecutablePath,
		strconv.FormatUint(instance.ExecutableDevice, 10),
		strconv.FormatUint(instance.ExecutableInode, 10),
	}, "\x00")
}

func runtimeProcessInventoryDigest(inventory RuntimeProcessInventory) string {
	type digestEnvelope struct {
		SchemaVersion int                      `json:"schema_version"`
		Scope         RuntimeProcessScope      `json:"scope"`
		Instances     []RuntimeProcessInstance `json:"instances"`
	}
	body, _ := json.Marshal(digestEnvelope{
		SchemaVersion: inventory.SchemaVersion,
		Scope:         inventory.Scope,
		Instances:     inventory.Instances,
	})
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func InspectRuntimeProcesses(ctx context.Context, options RuntimeProcessInventoryOptions) (RuntimeProcessInventory, error) {
	normalized, err := normalizeRuntimeInventoryOptions(options)
	if err != nil {
		return RuntimeProcessInventory{}, err
	}
	snapshots, err := loadSystemRuntimeProcessSnapshots(ctx)
	if err != nil {
		return RuntimeProcessInventory{}, err
	}
	return buildRuntimeProcessInventory(normalized, currentRuntimeProcessExecutionScope(), snapshots), nil
}

func runtimeProcessInstancesEqual(left RuntimeProcessInstance, right RuntimeProcessInstance) bool {
	return runtimeProcessIdentityKey(left) == runtimeProcessIdentityKey(right) &&
		left.IdentityStatus == right.IdentityStatus &&
		left.LayoutStatus == right.LayoutStatus &&
		left.StopAuthority == right.StopAuthority
}

func runtimeProcessWait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
