package redevpluginruntime

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const binaryName = "redevplugin-runtime"

// InstallAt writes the minimal executable needed to exercise Linux runtime
// admission without starting a worker. Other platforms do not admit workers.
func InstallAt(root string) (func() error, error) {
	if runtime.GOOS != "linux" {
		return func() error { return nil }, nil
	}
	header, err := elfHeader(runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve ReDevPlugin fixture root: %w", err)
	}
	path := filepath.Join(root, binaryName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o500)
	if errors.Is(err, os.ErrExist) {
		return preserveExistingFixture(path, header)
	}
	if err != nil {
		return nil, fmt.Errorf("create ReDevPlugin runtime fixture: %w", err)
	}
	created := true
	cleanup := func() error {
		if !created {
			return nil
		}
		created = false
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove ReDevPlugin runtime fixture: %w", err)
		}
		return nil
	}
	if written, err := file.Write(header); err != nil || written != len(header) {
		_ = file.Close()
		_ = cleanup()
		if err != nil {
			return nil, fmt.Errorf("write ReDevPlugin runtime fixture: %w", err)
		}
		return nil, fmt.Errorf("write ReDevPlugin runtime fixture: wrote %d of %d bytes", written, len(header))
	}
	if err := file.Close(); err != nil {
		_ = cleanup()
		return nil, fmt.Errorf("close ReDevPlugin runtime fixture: %w", err)
	}
	return cleanup, nil
}

// InstallSiblingOfCurrentExecutable follows the same canonical sibling rule as
// the production Redeven runtime resolver.
func InstallSiblingOfCurrentExecutable() (func() error, error) {
	if runtime.GOOS != "linux" {
		return func() error { return nil }, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve test executable: %w", err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, fmt.Errorf("resolve test executable symlinks: %w", err)
	}
	return InstallAt(filepath.Dir(executable))
}

func preserveExistingFixture(path string, expected []byte) (func() error, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect existing ReDevPlugin runtime fixture: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o500 {
		return nil, fmt.Errorf("refuse to replace existing ReDevPlugin runtime fixture %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read existing ReDevPlugin runtime fixture: %w", err)
	}
	if !bytes.Equal(data, expected) {
		return nil, fmt.Errorf("refuse to replace existing ReDevPlugin runtime fixture %q", path)
	}
	return func() error { return nil }, nil
}

func elfHeader(goarch string) ([]byte, error) {
	var machine uint16
	switch goarch {
	case "amd64":
		machine = 62
	case "arm64":
		machine = 183
	default:
		return nil, fmt.Errorf("unsupported ReDevPlugin runtime fixture architecture %q", goarch)
	}

	header := make([]byte, 64)
	copy(header, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(header[16:], 3)
	binary.LittleEndian.PutUint16(header[18:], machine)
	binary.LittleEndian.PutUint32(header[20:], 1)
	binary.LittleEndian.PutUint16(header[52:], 64)
	binary.LittleEndian.PutUint16(header[54:], 56)
	binary.LittleEndian.PutUint16(header[58:], 64)
	return header, nil
}
