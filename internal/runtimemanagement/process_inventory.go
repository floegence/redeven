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

const RuntimeProcessInventorySchemaVersion = 1

const desktopOwnerIDEnvName = "REDEVEN_DESKTOP_OWNER_ID"

type RuntimeProcessClassification string

const (
	RuntimeProcessCurrentOwned    RuntimeProcessClassification = "current_owned"
	RuntimeProcessLegacyOwned     RuntimeProcessClassification = "legacy_owned"
	RuntimeProcessLegacyOwnerless RuntimeProcessClassification = "legacy_ownerless"
	RuntimeProcessForeignOwner    RuntimeProcessClassification = "foreign_owner"
	RuntimeProcessAmbiguous       RuntimeProcessClassification = "ambiguous"
)

type RuntimeProcessInventoryOptions struct {
	RuntimeRoot        string
	StateRoot          string
	DesktopOwnerID     string
	CurrentExecutables []string
	IncludeKnownLegacy bool
	LegacyRuntimeRoots []string
}

type RuntimeProcessScope struct {
	RuntimeRoot    string `json:"runtime_root"`
	StateRoot      string `json:"state_root"`
	DesktopOwnerID string `json:"desktop_owner_id,omitempty"`
	UserIdentity   string `json:"user_identity,omitempty"`
	NamespaceID    string `json:"namespace_id,omitempty"`
}

type RuntimeProcessInstance struct {
	PID                    int                          `json:"pid"`
	ProcessStartedAtUnixMS int64                        `json:"process_started_at_unix_ms"`
	InstanceID             string                       `json:"instance_id,omitempty"`
	DesktopOwnerID         string                       `json:"desktop_owner_id,omitempty"`
	StateRoot              string                       `json:"state_root"`
	ExecutablePath         string                       `json:"executable_path"`
	ExecutableDeleted      bool                         `json:"executable_deleted,omitempty"`
	NamespaceID            string                       `json:"namespace_id,omitempty"`
	ExecutableDevice       uint64                       `json:"executable_device,omitempty"`
	ExecutableInode        uint64                       `json:"executable_inode,omitempty"`
	RuntimeVersion         string                       `json:"runtime_version,omitempty"`
	Classification         RuntimeProcessClassification `json:"classification"`
	Stoppable              bool                         `json:"stoppable"`
	ReasonCode             string                       `json:"reason_code,omitempty"`
}

type RuntimeProcessInventorySummary struct {
	CurrentOwned    int `json:"current_owned"`
	LegacyOwned     int `json:"legacy_owned"`
	LegacyOwnerless int `json:"legacy_ownerless"`
	ForeignOwner    int `json:"foreign_owner"`
	Ambiguous       int `json:"ambiguous"`
	Stoppable       int `json:"stoppable"`
	Blocking        int `json:"blocking"`
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
	DesktopOwnerID         string
	InstanceID             string
	RuntimeVersion         string
}

type runtimeProcessExecutionScope struct {
	UserIdentity string
	NamespaceID  string
}

type runtimeLockMetadata struct {
	PID            int    `json:"pid"`
	InstanceID     string `json:"instance_id"`
	RuntimeVersion string `json:"runtime_version"`
	DesktopOwnerID string `json:"desktop_owner_id"`
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
	legacyRoots := make([]string, 0, len(options.LegacyRuntimeRoots)+4)
	for _, root := range options.LegacyRuntimeRoots {
		clean, cleanErr := absoluteCleanPath(root)
		if cleanErr != nil {
			return RuntimeProcessInventoryOptions{}, fmt.Errorf("resolve legacy runtime root %q: %w", root, cleanErr)
		}
		if clean != "" {
			legacyRoots = append(legacyRoots, clean)
		}
	}
	if options.IncludeKnownLegacy {
		legacyRoots = append(legacyRoots, knownLegacyRuntimeRoots()...)
	}
	return RuntimeProcessInventoryOptions{
		RuntimeRoot:        runtimeRoot,
		StateRoot:          stateRoot,
		DesktopOwnerID:     strings.TrimSpace(options.DesktopOwnerID),
		CurrentExecutables: uniqueCleanPaths(options.CurrentExecutables),
		IncludeKnownLegacy: options.IncludeKnownLegacy,
		LegacyRuntimeRoots: uniqueCleanPaths(legacyRoots),
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

func knownLegacyRuntimeRoots() []string {
	roots := make([]string, 0, 6)
	if cacheRoot := strings.TrimSpace(os.Getenv("XDG_CACHE_HOME")); cacheRoot != "" {
		roots = append(roots, filepath.Join(cacheRoot, "redeven-desktop", "runtime"))
	}
	if cacheRoot, err := os.UserCacheDir(); err == nil && strings.TrimSpace(cacheRoot) != "" {
		roots = append(roots, filepath.Join(cacheRoot, "redeven-desktop", "runtime"))
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		roots = append(roots, filepath.Join(home, ".cache", "redeven-desktop", "runtime"))
	}
	tempRoot := strings.TrimSpace(os.Getenv("TMPDIR"))
	if tempRoot == "" {
		tempRoot = os.TempDir()
	}
	labels := []string{strconv.Itoa(os.Geteuid())}
	if current, err := user.Current(); err == nil && strings.TrimSpace(current.Username) != "" {
		labels = append(labels, filepath.Base(current.Username))
	}
	for _, label := range labels {
		roots = append(roots, filepath.Join(tempRoot, "redeven-desktop-runtime-"+label))
	}
	return uniqueCleanPaths(roots)
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
	ownerID := ""
	if environ, environErr := candidate.EnvironWithContext(ctx); environErr == nil {
		for _, entry := range environ {
			if strings.HasPrefix(entry, desktopOwnerIDEnvName+"=") {
				ownerID = strings.TrimSpace(strings.TrimPrefix(entry, desktopOwnerIDEnvName+"="))
				break
			}
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
		DesktopOwnerID:         ownerID,
	}, nil
}

func runtimeProcessArgs(args []string) bool {
	if len(args) < 2 || filepath.Base(strings.TrimSpace(args[0])) != "redeven" || strings.TrimSpace(args[1]) != "run" {
		return false
	}
	for _, arg := range args[2:] {
		if arg == "--desktop-managed" {
			return true
		}
	}
	return false
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

func pathWithin(root string, candidate string) bool {
	root = comparableRuntimePath(root)
	candidate = comparableRuntimePath(candidate)
	if root == "." || candidate == "." || root == "" || candidate == "" {
		return false
	}
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
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

func legacyExecutable(options RuntimeProcessInventoryOptions, executablePath string) bool {
	clean := comparableRuntimePath(executablePath)
	if filepath.Base(clean) != "redeven" {
		return false
	}
	roots := append([]string{options.RuntimeRoot}, options.LegacyRuntimeRoots...)
	for _, root := range roots {
		root = comparableRuntimePath(root)
		if !pathWithin(root, clean) {
			continue
		}
		relative, err := filepath.Rel(root, clean)
		if err != nil {
			continue
		}
		relative = filepath.ToSlash(relative)
		if strings.HasPrefix(relative, "runtime/releases/") ||
			strings.HasPrefix(relative, "releases/") ||
			strings.HasPrefix(relative, "runtime/managed/") {
			return true
		}
	}
	return false
}

func legacyStateRoot(options RuntimeProcessInventoryOptions, stateRoot string) bool {
	if comparableRuntimePath(stateRoot) == comparableRuntimePath(options.StateRoot) {
		return true
	}
	for _, root := range append([]string{options.RuntimeRoot}, options.LegacyRuntimeRoots...) {
		root = comparableRuntimePath(root)
		stateRoot = comparableRuntimePath(stateRoot)
		if !pathWithin(root, stateRoot) {
			continue
		}
		relative, err := filepath.Rel(root, stateRoot)
		if err != nil {
			continue
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		if len(parts) == 1 && parts[0] == "." {
			return true
		}
		if len(parts) == 2 && ((parts[0] == "local-environment" || parts[0] == "machine") && parts[1] == "state") {
			return true
		}
		if len(parts) == 3 && parts[0] == "local-environment" && parts[1] == "state" && parts[2] == "local-environment" {
			return true
		}
		if len(parts) == 3 && parts[0] == "instances" && strings.HasPrefix(parts[1], "envinst_") && parts[2] == "state" {
			return true
		}
		if len(parts) == 3 && parts[0] == "scopes" && parts[1] == "local" && parts[2] == "default" {
			return true
		}
	}
	return false
}

func enrichRuntimeProcessSnapshot(snapshot runtimeProcessSnapshot, stateRoot string) runtimeProcessSnapshot {
	if snapshot.DesktopOwnerID != "" && snapshot.InstanceID != "" && snapshot.RuntimeVersion != "" {
		return snapshot
	}
	for _, lockPath := range runtimeLockPaths(stateRoot) {
		body, err := os.ReadFile(lockPath)
		if err != nil {
			continue
		}
		var metadata runtimeLockMetadata
		if json.Unmarshal(body, &metadata) != nil || metadata.PID != snapshot.PID {
			continue
		}
		if snapshot.DesktopOwnerID == "" {
			snapshot.DesktopOwnerID = strings.TrimSpace(metadata.DesktopOwnerID)
		}
		snapshot.InstanceID = strings.TrimSpace(metadata.InstanceID)
		snapshot.RuntimeVersion = strings.TrimSpace(metadata.RuntimeVersion)
		break
	}
	return snapshot
}

func runtimeLockPaths(stateRoot string) []string {
	return []string{
		filepath.Join(stateRoot, "local-environment", "agent.lock"),
		filepath.Join(stateRoot, "scopes", "local", "default", "agent.lock"),
		filepath.Join(stateRoot, "machine", "agent.lock"),
		filepath.Join(stateRoot, "agent.lock"),
	}
}

func classifyRuntimeProcess(
	options RuntimeProcessInventoryOptions,
	scope runtimeProcessExecutionScope,
	snapshot runtimeProcessSnapshot,
) (RuntimeProcessInstance, bool) {
	stateRoot := runtimeProcessStateRoot(snapshot.Args)
	if stateRoot == "" {
		return RuntimeProcessInstance{}, false
	}
	currentStateRoot := comparableRuntimePath(stateRoot) == comparableRuntimePath(options.StateRoot)
	currentExecutable := currentManagedExecutable(options, snapshot.ExecutablePath) && !snapshot.ExecutableDeleted
	legacyExecutableMatch := legacyExecutable(options, snapshot.ExecutablePath)
	legacyStateRootMatch := legacyStateRoot(options, stateRoot)
	if !currentStateRoot && !legacyStateRootMatch {
		return RuntimeProcessInstance{}, false
	}
	if !currentStateRoot && !legacyExecutableMatch {
		return RuntimeProcessInstance{}, false
	}
	if currentStateRoot && filepath.Base(snapshot.ExecutablePath) != "redeven" {
		return RuntimeProcessInstance{}, false
	}
	if scope.NamespaceID != "" && snapshot.NamespaceID != "" && scope.NamespaceID != snapshot.NamespaceID {
		return RuntimeProcessInstance{}, false
	}
	snapshot = enrichRuntimeProcessSnapshot(snapshot, stateRoot)
	var classification RuntimeProcessClassification
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
	ownerMatches := options.DesktopOwnerID != "" && snapshot.DesktopOwnerID == options.DesktopOwnerID
	ownerForeign := options.DesktopOwnerID != "" && snapshot.DesktopOwnerID != "" && snapshot.DesktopOwnerID != options.DesktopOwnerID
	legacy := !currentStateRoot || !currentExecutable || snapshot.ExecutableDeleted
	switch {
	case ownerForeign:
		classification = RuntimeProcessForeignOwner
		reasonCode = "runtime_owned_by_another_desktop"
	case !identityComplete:
		classification = RuntimeProcessAmbiguous
	case ownerMatches && !legacy:
		classification = RuntimeProcessCurrentOwned
		reasonCode = ""
	case ownerMatches && legacy:
		classification = RuntimeProcessLegacyOwned
		reasonCode = ""
	case snapshot.DesktopOwnerID == "" && legacy && legacyExecutableMatch && legacyStateRootMatch:
		classification = RuntimeProcessLegacyOwnerless
		reasonCode = ""
	default:
		classification = RuntimeProcessAmbiguous
	}
	stoppable := classification == RuntimeProcessCurrentOwned ||
		classification == RuntimeProcessLegacyOwned ||
		classification == RuntimeProcessLegacyOwnerless
	return RuntimeProcessInstance{
		PID:                    snapshot.PID,
		ProcessStartedAtUnixMS: snapshot.ProcessStartedAtUnixMS,
		InstanceID:             snapshot.InstanceID,
		DesktopOwnerID:         snapshot.DesktopOwnerID,
		StateRoot:              stateRoot,
		ExecutablePath:         snapshot.ExecutablePath,
		ExecutableDeleted:      snapshot.ExecutableDeleted,
		NamespaceID:            snapshot.NamespaceID,
		ExecutableDevice:       snapshot.ExecutableDevice,
		ExecutableInode:        snapshot.ExecutableInode,
		RuntimeVersion:         snapshot.RuntimeVersion,
		Classification:         classification,
		Stoppable:              stoppable,
		ReasonCode:             reasonCode,
	}, true
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
		switch instance.Classification {
		case RuntimeProcessCurrentOwned:
			summary.CurrentOwned++
		case RuntimeProcessLegacyOwned:
			summary.LegacyOwned++
		case RuntimeProcessLegacyOwnerless:
			summary.LegacyOwnerless++
		case RuntimeProcessForeignOwner:
			summary.ForeignOwner++
		case RuntimeProcessAmbiguous:
			summary.Ambiguous++
		}
		if instance.Stoppable {
			summary.Stoppable++
		} else {
			summary.Blocking++
		}
	}
	inventory := RuntimeProcessInventory{
		SchemaVersion: RuntimeProcessInventorySchemaVersion,
		Scope: RuntimeProcessScope{
			RuntimeRoot:    options.RuntimeRoot,
			StateRoot:      options.StateRoot,
			DesktopOwnerID: options.DesktopOwnerID,
			UserIdentity:   scope.UserIdentity,
			NamespaceID:    scope.NamespaceID,
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
		instance.DesktopOwnerID,
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

func RuntimeProcessInventoryHasBlockingInstances(inventory RuntimeProcessInventory) bool {
	return inventory.Summary.Blocking > 0
}

func runtimeProcessInstancesEqual(left RuntimeProcessInstance, right RuntimeProcessInstance) bool {
	return runtimeProcessIdentityKey(left) == runtimeProcessIdentityKey(right) &&
		left.Classification == right.Classification &&
		left.Stoppable == right.Stoppable
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
