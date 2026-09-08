package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

type managedProcessSnapshot struct {
	PID       int
	Group     int
	BootID    string
	Birth     string
	User      string
	Namespace string
	Command   string
}

func (s managedProcessSnapshot) fingerprint() string {
	digest := sha256.Sum256([]byte(strings.Join([]string{s.BootID, strconv.Itoa(s.PID), s.Birth, s.User, s.Namespace}, "\n")))
	return hex.EncodeToString(digest[:])
}

func managedProcessDetails(pid int) (string, int, string, error) {
	snapshot, err := readManagedProcess(pid)
	if err != nil {
		return "", 0, "", err
	}
	if snapshot.Group != pid {
		return "", snapshot.Group, snapshot.Command, errors.New("managed process is not an isolated process-group leader")
	}
	return snapshot.fingerprint(), snapshot.Group, snapshot.Command, nil
}
