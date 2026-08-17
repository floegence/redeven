package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestSupervisorEnrollRejectsEnrollmentCodeArgumentsWithoutEchoingSecret(t *testing.T) {
	secret := "rec_demo.0.rpn_demo.ren_never_echo"
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI([]string{
		"supervisor", "enroll", "--provider", "https://provider.example", "--environment", "env_demo", "--code=" + secret,
	}, strings.NewReader(""), &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("exit code = %d, want 2", exitCode)
	}
	combined := stdout.String() + stderr.String()
	if strings.Contains(combined, secret) || strings.Contains(combined, "ren_never_echo") {
		t.Fatalf("CLI echoed enrollment secret: %q", combined)
	}
}

func TestReadEnrollmentCodeUsesStdinWithoutEcho(t *testing.T) {
	secret := "rec_demo.0.rpn_demo.ren_stdin_only"
	var prompt bytes.Buffer
	got, err := readEnrollmentCode(strings.NewReader(secret+"\n"), &prompt)
	if err != nil {
		t.Fatal(err)
	}
	if got != secret {
		t.Fatalf("enrollment code = %q", got)
	}
	if strings.Contains(prompt.String(), secret) {
		t.Fatal("stdin enrollment code was echoed")
	}
}

func TestServiceProcessMatchesRejectsReusedPIDMetadata(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	status := serviceStatus{
		PID:                    os.Getpid(),
		Executable:             executable,
		ProcessStartedAtUnixMS: processStartedAtUnixMS(os.Getpid()),
	}
	if !serviceProcessMatches(status) {
		t.Fatal("current Gateway process did not match its recorded identity")
	}
	status.ProcessStartedAtUnixMS++
	if serviceProcessMatches(status) {
		t.Fatal("service status accepted a reused PID with a different start time")
	}
}
