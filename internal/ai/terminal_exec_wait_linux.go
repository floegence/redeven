package ai

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func terminalExecGroupRunning(pid int) (bool, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return false, err
	}
	group := strconv.Itoa(pid)
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		raw, err := os.ReadFile("/proc/" + entry.Name() + "/stat")
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return false, err
		}
		// The comm field can contain spaces and parentheses. Fields after its
		// closing parenthesis start with state, ppid, and pgrp.
		end := strings.LastIndexByte(string(raw), ')')
		fields := strings.Fields(string(raw[end+1:]))
		if end < 0 || len(fields) < 3 {
			return false, fmt.Errorf("invalid process stat for pid %s", entry.Name())
		}
		if fields[2] == group && fields[0] != "Z" && fields[0] != "X" {
			return true, nil
		}
	}
	return false, nil
}

func terminalExecExitWaiter(cmd *exec.Cmd) func() error {
	return func() error {
		for {
			var info unix.Siginfo
			err := unix.Waitid(unix.P_PID, cmd.Process.Pid, &info, unix.WEXITED|unix.WNOWAIT, nil)
			if errors.Is(err, unix.EINTR) {
				continue
			}
			return err
		}
	}
}
