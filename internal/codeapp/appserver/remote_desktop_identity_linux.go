package appserver

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
)

// The executing Runtime owns this read; an ordinary SSH user cannot inspect a
// root Runtime's proc executable. The privileged manager revalidates every field.
func desktopRuntimeIdentity() (map[string]any, error) {
	start, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return nil, err
	}
	fields := strings.Fields(string(start)[strings.LastIndexByte(string(start), ')')+1:])
	if len(fields) < 20 {
		return nil, errors.New("invalid Runtime process identity")
	}
	image, err := os.Open("/proc/self/exe")
	if err != nil {
		return nil, err
	}
	defer image.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, image); err != nil {
		return nil, err
	}
	return map[string]any{"runtime_pid": os.Getpid(), "runtime_uid": os.Geteuid(), "runtime_gid": os.Getegid(), "runtime_start": fields[19], "runtime_sha256": hex.EncodeToString(hash.Sum(nil))}, nil
}
