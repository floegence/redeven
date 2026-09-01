//go:build darwin || linux

package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

func configureManagedProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func terminateManagedProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
func killManagedProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
func managedProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func managedProcessRunning(pid int) bool {
	if !managedProcessAlive(pid) {
		return false
	}
	output, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "stat=").Output()
	if err != nil {
		return false
	}
	state := strings.TrimSpace(string(output))
	return state != "" && !strings.HasPrefix(strings.ToUpper(state), "Z")
}

func managedProcessDetails(pid int) (fingerprint string, processGroup int, command string, err error) {
	if pid <= 0 {
		return "", 0, "", errors.New("managed process PID is invalid")
	}
	var started string
	if runtime.GOOS == "linux" {
		raw, readErr := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if readErr != nil {
			return "", 0, "", readErr
		}
		text := string(raw)
		end := strings.LastIndex(text, ")")
		if end < 0 {
			return "", 0, "", errors.New("managed process stat is invalid")
		}
		fields := strings.Fields(text[end+1:])
		if len(fields) <= 19 {
			return "", 0, "", errors.New("managed process stat is incomplete")
		}
		processGroup, err = strconv.Atoi(fields[2])
		if err != nil {
			return "", 0, "", err
		}
		started = fields[19]
		cmdline, readErr := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		if readErr != nil {
			return "", 0, "", readErr
		}
		command = strings.TrimSpace(strings.ReplaceAll(string(cmdline), "\x00", " "))
	} else {
		output, commandErr := exec.Command("ps", "-ww", "-p", strconv.Itoa(pid), "-o", "pgid=", "-o", "lstart=", "-o", "command=").Output()
		if commandErr != nil {
			return "", 0, "", commandErr
		}
		fields := strings.Fields(strings.TrimSpace(string(output)))
		if len(fields) < 8 {
			return "", 0, "", errors.New("managed process details are incomplete")
		}
		processGroup, err = strconv.Atoi(fields[0])
		if err != nil {
			return "", 0, "", err
		}
		started = strings.Join(fields[1:6], " ")
		command = strings.Join(fields[6:], " ")
	}
	if processGroup != pid || started == "" || command == "" {
		return "", processGroup, command, errors.New("managed process is not an isolated process-group leader")
	}
	bootIdentity, err := managedSystemBootIdentity()
	if err != nil {
		return "", processGroup, command, err
	}
	digest := sha256.Sum256([]byte(bootIdentity + "\n" + strconv.Itoa(pid) + "\n" + started))
	return hex.EncodeToString(digest[:]), processGroup, command, nil
}

func managedSystemBootIdentity() (string, error) {
	if runtime.GOOS == "linux" {
		raw, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
		if err != nil {
			return "", err
		}
		identity := strings.TrimSpace(string(raw))
		if identity == "" {
			return "", errors.New("system boot identity is empty")
		}
		return identity, nil
	}
	output, err := exec.Command("sysctl", "-n", "kern.boottime").Output()
	if err != nil {
		return "", err
	}
	identity := strings.TrimSpace(string(output))
	if identity == "" {
		return "", errors.New("system boot identity is empty")
	}
	return identity, nil
}

func terminateManagedProcessPID(pid int) error {
	err := syscall.Kill(-pid, syscall.SIGTERM)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func killManagedProcessPID(pid int) error {
	err := syscall.Kill(-pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
