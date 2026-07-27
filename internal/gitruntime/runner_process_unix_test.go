//go:build linux || darwin

package gitruntime

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRunnerEscapedPipeHelper(t *testing.T) {
	if os.Getenv("GITRUNTIME_ESCAPED_PIPE_HELPER") != "1" {
		return
	}
	if os.Getenv("GITRUNTIME_ESCAPED_PIPE_SETSID") == "1" {
		if _, err := syscall.Setsid(); err != nil {
			os.Exit(2)
		}
	}
	pidFile := os.Getenv("GITRUNTIME_ESCAPED_PIPE_PID_FILE")
	_ = os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0o600)
	time.Sleep(30 * time.Second)
	os.Exit(0)
}

func TestRunnerBoundsEscapedDescendantPipeLifetime(t *testing.T) {
	for _, escaped := range []bool{false, true} {
		for _, stream := range []bool{false, true} {
			name := "same-group-capture"
			if stream {
				name = "same-group-stream"
			}
			if escaped {
				name = strings.Replace(name, "same-group", "escaped", 1)
			}
			t.Run(name, func(t *testing.T) {
				bin := t.TempDir()
				marker := filepath.Join(bin, "first-call")
				pidFile := filepath.Join(bin, "helper.pid")
				script := filepath.Join(bin, "git")
				contents := "#!/bin/sh\n" +
					"if [ ! -f \"$GITRUNTIME_ESCAPED_PIPE_MARKER\" ]; then\n" +
					"  : > \"$GITRUNTIME_ESCAPED_PIPE_MARKER\"\n" +
					"  \"$GITRUNTIME_TEST_BINARY\" -test.run '^TestRunnerEscapedPipeHelper$' &\n" +
					"fi\n"
				if err := os.WriteFile(script, []byte(contents), 0o755); err != nil {
					t.Fatal(err)
				}
				t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
				t.Setenv("GITRUNTIME_TEST_BINARY", os.Args[0])
				t.Setenv("GITRUNTIME_ESCAPED_PIPE_HELPER", "1")
				t.Setenv("GITRUNTIME_ESCAPED_PIPE_MARKER", marker)
				t.Setenv("GITRUNTIME_ESCAPED_PIPE_PID_FILE", pidFile)
				if escaped {
					t.Setenv("GITRUNTIME_ESCAPED_PIPE_SETSID", "1")
				} else {
					t.Setenv("GITRUNTIME_ESCAPED_PIPE_SETSID", "0")
				}
				readHelperPID := func() int {
					rawPID, readErr := os.ReadFile(pidFile)
					if readErr != nil {
						return 0
					}
					pid, _ := strconv.Atoi(strings.TrimSpace(string(rawPID)))
					return pid
				}
				killHelper := func() {
					if pid := readHelperPID(); pid > 0 {
						_ = syscall.Kill(pid, syscall.SIGKILL)
					}
				}
				t.Cleanup(killHelper)

				runtime := New()
				started := time.Now()
				var result CommandResult
				var err error
				if stream {
					result, err = runtime.StreamRead(context.Background(), t.TempDir(), nil, func(reader io.Reader) error {
						_, copyErr := io.Copy(io.Discard, reader)
						return copyErr
					}, "status")
				} else {
					result, err = runtime.RunRead(context.Background(), t.TempDir(), nil, "status")
				}
				var commandErr *CommandError
				if !errors.As(err, &commandErr) || !commandErr.UnknownOutcome || !result.UnknownOutcome || !errors.Is(commandErr.Cause, errProcessPipeDrain) {
					t.Fatalf("escaped pipe result=%+v error=%v cause=%v", result, err, commandErr.Cause)
				}
				if elapsed := time.Since(started); elapsed > processCleanupDeadline+processPipeDrainGrace+2*time.Second {
					t.Fatalf("escaped pipe cleanup exceeded bound: %s", elapsed)
				}

				helperPID := readHelperPID()
				if helperPID <= 0 {
					t.Fatal("helper pid was not recorded")
				}
				if escaped {
					if aliveErr := syscall.Kill(helperPID, 0); aliveErr != nil {
						t.Fatalf("escaped helper was unexpectedly contained: %v", aliveErr)
					}
					killHelper()
				} else {
					deadline := time.Now().Add(time.Second)
					for syscall.Kill(helperPID, 0) == nil && time.Now().Before(deadline) {
						time.Sleep(10 * time.Millisecond)
					}
					if aliveErr := syscall.Kill(helperPID, 0); aliveErr == nil {
						t.Fatal("same-group helper survived process-group cleanup")
					}
				}
				if _, nextErr := runtime.RunRead(context.Background(), t.TempDir(), nil, "status"); nextErr != nil {
					t.Fatalf("next command after escaped pipe failed: %v", nextErr)
				}
			})
		}
	}
}
