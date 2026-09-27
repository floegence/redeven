//go:build unix

package hostapps

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSessionLaunchDisablesAudioSubsystem(t *testing.T) {
	m := macFixture(t)
	a := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("a", 64)}}
	arguments := m.applicationArgs(a)
	options := map[string]string{}
	for _, argument := range arguments {
		if name, value, ok := strings.Cut(argument, "="); ok {
			options[name] = value
		}
	}
	for name, want := range map[string]string{"--audio": "no", "--pulseaudio": "no", "--speaker": "disabled", "--microphone": "disabled"} {
		if options[name] != want {
			t.Errorf("silent application session must disable %s; got %q", name, options[name])
		}
	}
}

func TestApplicationInputUsesPrivateLauncherWithoutApplicationHTML(t *testing.T) {
	m := macFixture(t)
	a := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("a", 64)}}
	arguments := m.applicationArgs(a)
	joined := strings.Join(arguments, "\n")
	if strings.Contains(joined, "--input-method=none") || !strings.Contains(joined, "--input-method=keep") {
		t.Fatal("application launch does not select the published client input environment")
	}
	if !strings.Contains(joined, "--html=no\n") {
		t.Fatal("application launch retains an application-owned viewer resource tree")
	}
}

func TestWindowReadinessCancellationReapsProbeChildren(t *testing.T) {
	dir, err := os.MkdirTemp("", "xpra-cancel-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	listener, err := net.Listen("unix", filepath.Join(dir, "socket"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	probe := filepath.Join(dir, "probe")
	// A child inheriting stdout must not hold readiness open after cancellation.
	if err = os.WriteFile(probe, []byte("#!/bin/sh\nsleep 5 &\ntouch "+quoteArgv([]string{filepath.Join(dir, "started")})+"\nwait\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan bool, 1)
	go func() { finished <- sessionHasWindows(ctx, probe, dir) }()
	// Wait until the probe really spawned its child before cancelling it.
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "started")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("probe did not start")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case ready := <-finished:
		if ready {
			t.Fatal("cancelled probe reported a window")
		}
	case <-time.After(time.Second):
		t.Fatal("probe outlived session cancellation")
	}
}

func TestIndependentBackendDoesNotShareRuntimeProcessGroup(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	configureIndependentProcess(cmd)
	if !cmd.SysProcAttr.Setsid || cmd.SysProcAttr.Setpgid {
		t.Fatal("backend did not request an independent session")
	}
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
}

func TestClientInputCapabilityUsesExactServerInterpreter(t *testing.T) {
	root := t.TempDir()
	python := filepath.Join(root, "python-xpra")
	xpra := filepath.Join(root, "xpra")
	if err := os.WriteFile(xpra, []byte("#!"+python+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, supported := range []bool{false, true} {
		body := "#!/bin/sh\nexit 1\n"
		if supported {
			body = "#!/bin/sh\nprintf '%s' '{\"version\":1,\"xpra_version\":\"6.5.3\"}'\n"
		}
		if err := os.WriteFile(python, []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
		availability, tools := clientInputTools(context.Background(), Availability{Supported: true, Ready: true}, hostTools{xpra: xpra, python: "independent-gio-python"})
		if availability.Ready != supported || tools.python != "independent-gio-python" {
			t.Fatal("client capability changed GIO ownership or accepted an unsupported server")
		}
		if supported && tools.inputPython != python {
			t.Fatal("client input substituted another Python interpreter")
		}
		if !supported && (availability.Reason != "missing_dependencies" || len(availability.Requirements) != 1) {
			t.Fatal("missing input capability has no explicit preparation guidance")
		}
	}
}
