package main

import (
	"errors"
	"os"
	"testing"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

func TestDiagnoseRuntimeAttachFailureUsesLockMetadataAsRuntimeIdentity(t *testing.T) {
	metadata := &agentLockMetadata{
		PID:                      os.Getpid(),
		Mode:                     "desktop",
		InstanceID:               "rt_owner",
		StartedAtUnixMS:          1234,
		RuntimeVersion:           "v1.2.3",
		RuntimeCommit:            "abc123",
		BinaryPath:               "/opt/redeven/bin/redeven",
		DesktopManaged:           true,
		DesktopOwnerID:           "desktop-owner",
		LocalUIEnabled:           true,
		StateRoot:                "/root/.redeven",
		StateDir:                 "/root/.redeven/local-environment",
		RuntimeControlSocketPath: "/root/.redeven/local-environment/runtime/control.sock",
	}

	status := diagnoseRuntimeAttachFailure(
		"/root/.redeven/local-environment/agent.lock",
		"/root/.redeven/local-environment/runtime/control.sock",
		metadata,
		errors.New("dial unix control.sock: connect: no such file or directory"),
	)

	if status.State != runtimemanagement.AttachStateLiveProcessWithoutSocket {
		t.Fatalf("State = %q", status.State)
	}
	if status.Identity.PID != os.Getpid() || status.Identity.InstanceID != "rt_owner" {
		t.Fatalf("unexpected identity: %#v", status.Identity)
	}
	if !status.Identity.DesktopManaged || status.Identity.DesktopOwnerID != "desktop-owner" {
		t.Fatalf("unexpected desktop owner identity: %#v", status.Identity)
	}
	if status.Diagnostics.LockPID != os.Getpid() || !status.Diagnostics.PIDAlive {
		t.Fatalf("unexpected diagnostics: %#v", status.Diagnostics)
	}
}
