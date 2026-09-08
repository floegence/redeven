//go:build darwin || linux

package managedwebservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestLegacyManagementReviewPreservesProcessAndPrivateSession(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	manager.host = driver
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	legacy := strings.Replace(identity, "host:v3:", "host:v2:", 1)
	legacy = legacy[:strings.LastIndex(legacy, ":")+1] + strings.Repeat("0", 64)
	service.RuntimeIdentity = legacy
	if err := manager.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &legacy}); err != nil {
		t.Fatal(err)
	}
	if err := driver.writeOpenSession(service, legacy, "/?token=preserved-session"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := driver.recoverPersistedProcess(service); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("legacy mismatch=%v", err)
	}
	review, err := manager.ReviewHostManagement(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	req := RestoreManagementRequest{SavedIdentity: review.SavedIdentity, Fingerprint: strings.Repeat("1", 64), Confirmed: true}
	if err := manager.RestoreHostManagement(context.Background(), service.ServiceID, req); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("changed review accepted: %v", err)
	}
	req.Fingerprint = review.Fingerprint
	if err := manager.RestoreHostManagement(context.Background(), service.ServiceID, req); err != nil {
		t.Fatal(err)
	}
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeIdentity != identity || stored.DesiredState != "running" {
		t.Fatal("restore replaced launch or lost intent")
	}
	appPath, err := driver.resolveOpenSession(stored)
	if err != nil || appPath != "/?token=preserved-session" {
		t.Fatal("restore lost the existing private session")
	}
	if _, err := os.Stat(filepath.Join(driver.instanceRoot(service), "identity-upgrade.json")); !os.IsNotExist(err) {
		t.Fatal("completed identity journal remained")
	}
}

func TestStableIdentityRejectsOtherBirthBootAndUser(t *testing.T) {
	initial := managedProcessSnapshot{PID: 123, Group: 123, BootID: "boot-session", Birth: "100.123456", User: "501", Namespace: "pid:[123]"}
	for _, mutate := range []func(*managedProcessSnapshot){
		func(p *managedProcessSnapshot) { p.BootID = "other-boot" },
		func(p *managedProcessSnapshot) { p.Birth = "200.123456" },
		func(p *managedProcessSnapshot) { p.User = "502" },
		func(p *managedProcessSnapshot) { p.Namespace = "pid:[456]" },
	} {
		changed := initial
		mutate(&changed)
		if changed.fingerprint() == initial.fingerprint() {
			t.Fatal("native identity change was accepted")
		}
	}
	// Display and clock formatting inputs are absent from the native identity.
	changed := initial
	changed.Command = "different display text"
	t.Setenv("TZ", "Pacific/Honolulu")
	if changed.fingerprint() != initial.fingerprint() {
		t.Fatal("display text changed the process identity")
	}
}

func TestOpenHookTimeoutAndCancellationNeverStopApplication(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	started := time.Now()
	_, err = driver.runPrivateHook(context.Background(), service, "exec sleep 60", "open", 50*time.Millisecond, true)
	if managedErrorCode(err) != "HOST_OPEN_HOOK_FAILED" || time.Since(started) > time.Second {
		t.Fatalf("bounded hook failed: %v", err)
	}
	if _, alive, err := driver.recoverPersistedProcess(service); err != nil || !alive {
		t.Fatal("hook timeout affected application group")
	}
}

func TestStopRejectsReusedPIDWithoutSignallingApplication(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	pid := hostPIDFromIdentity(identity)
	t.Cleanup(func() { _ = killManagedProcessPID(pid) })
	if err := killHostProcess(hostProcess{pid: pid, fingerprint: strings.Repeat("0", 64)}); managedErrorCode(err) != "HOST_PROCESS_IDENTITY_MISMATCH" {
		t.Fatalf("wrong birth identity stop=%v", err)
	}
	if !managedProcessRunning(pid) {
		t.Fatal("mismatched process was signalled")
	}
}

func TestIdentityUpgradeResumesAfterDatabaseCommit(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	legacy := strings.Replace(identity, "host:v3:", "host:v2:", 1)
	state, err := driver.readRunState(service)
	if err != nil {
		t.Fatal(err)
	}
	upgrade := hostIdentityUpgrade{OldIdentity: legacy, NewIdentity: identity, State: state, Session: &serviceOpenSessionState{SchemaVersion: 1, ServiceID: service.ServiceID, RuntimeSpecSHA256: service.RuntimeSpecSHA256, RuntimeIdentity: identity, AppPath: "/?token=retained"}}
	if err := writePrivateJSON(filepath.Join(driver.instanceRoot(service), "identity-upgrade.json"), upgrade); err != nil {
		t.Fatal(err)
	}
	if err := driver.writeOpenSession(service, legacy, "/?token=retained"); err != nil {
		t.Fatal(err)
	}
	if _, alive, err := driver.recoverPersistedProcess(service); err != nil || !alive {
		t.Fatalf("upgrade recovery failed: %v", err)
	}
	if path, err := driver.readOpenSession(service, identity); err != nil || path != "/?token=retained" {
		t.Fatal("journal recovery lost private session")
	}
}

func TestLaunchDoesNotExecuteBeforeIdentityPersistence(t *testing.T) {
	root := t.TempDir()
	manager, service := hostTestService(t, root, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: `touch "$REDEVEN_WORKSPACE/application-started"; exec sleep 60`}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	if err := manager.registry.DeleteManagedService(context.Background(), service.ServiceID); err != nil {
		t.Fatal(err)
	}
	if _, err := driver.Start(context.Background(), service); err == nil {
		t.Fatal("launch succeeded without a durable owner")
	}
	if _, err := os.Stat(filepath.Join(root, "application-started")); !os.IsNotExist(err) {
		t.Fatal("application ran before identity persistence")
	}
	if managedProcessRunning(hostPIDFromIdentity(service.RuntimeIdentity)) {
		t.Fatal("unreleased launch survived a failed persistence")
	}
}

func TestInterruptedHostUpdateAdoptsGatedTargetWithoutRestart(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	manager.host = driver
	resolved, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.DesiredState, service.ObservedState = "running", "running"
	service.RuntimeSpecSHA256 = strings.Repeat("0", 64)
	target := *service
	target.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	journal := containerUpdateJournal{Kind: managedServiceUpdateJournalKind, Phase: updatePhaseTargetCreating, Old: updateReleaseFromService(*service), Target: updateReleaseFromService(target)}
	if err := manager.writeContainerUpdateJournal(context.Background(), service.ServiceID, journal); err != nil {
		t.Fatal(err)
	}
	operation := pfregistry.ManagedOperation{OperationID: "mop-update-recovery", ServiceID: service.ServiceID, RequestID: "update-recovery", RequestFingerprint: "update", Action: "update", State: "interrupted", Stage: "starting"}
	if err := manager.registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}
	identity, err := driver.Start(context.Background(), &target)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := decodeContainerUpdateJournal(stored.RuntimeManifestJSON)
	if err != nil || saved.Target.RuntimeIdentity != identity {
		t.Fatal("launch identity was not stored in existing update journal before release")
	}
	if err := manager.recoverInterruptedHostUpdate(stored, &operation, driver); err != nil {
		t.Fatal(err)
	}
	current, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || current.RuntimeIdentity != identity || current.RuntimeManifestJSON != "{}" {
		t.Fatal("update recovery replaced the target or did not finalize")
	}
	if !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("update recovery stopped target")
	}
}

func TestNativeIdentityIgnoresBootTimeTextAndTimezone(t *testing.T) {
	manager, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}})
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	pid := hostPIDFromIdentity(identity)
	t.Cleanup(func() { _ = killManagedProcessPID(pid) })
	initial, err := readManagedProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	commands := t.TempDir()
	t.Setenv("PATH", commands)
	for _, test := range []struct{ zone, text string }{
		{"Pacific/Honolulu", "{ sec = 1787453476, usec = 377274 }"},
		{"Asia/Shanghai", "{ sec = 1787453476, usec = 108078 }"},
		{"UTC", "changed localized date display"},
	} {
		t.Setenv("TZ", test.zone)
		for _, name := range []string{"ps", "sysctl"} {
			if err := os.WriteFile(filepath.Join(commands, name), []byte("#!/bin/sh\nprintf '%s\\n' '"+test.text+"'\n"), 0700); err != nil {
				t.Fatal(err)
			}
		}
		current, err := readManagedProcess(pid)
		if err != nil || current.fingerprint() != initial.fingerprint() {
			t.Fatal("native process identity depended on boot-time or date text")
		}
		if recovered, alive, err := driver.recoverPersistedProcess(service); err != nil || !alive || recovered.identity != identity {
			t.Fatal("clock display changes prevented adoption")
		}
	}
}
