package redevpluginintegration

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func testRuntimePath(t *testing.T, root string) string {
	t.Helper()
	machine := uint16(0)
	switch runtime.GOARCH {
	case "amd64":
		machine = 62
	case "arm64":
		machine = 183
	default:
		t.Fatalf("unsupported ReDevPlugin test runtime architecture %q", runtime.GOARCH)
	}

	header := make([]byte, 64)
	copy(header, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(header[16:], 3)
	binary.LittleEndian.PutUint16(header[18:], machine)
	binary.LittleEndian.PutUint32(header[20:], 1)
	binary.LittleEndian.PutUint16(header[52:], 64)
	binary.LittleEndian.PutUint16(header[54:], 56)
	binary.LittleEndian.PutUint16(header[58:], 64)

	path := filepath.Join(root, "redevplugin-runtime")
	if err := os.WriteFile(path, header, 0o500); err != nil {
		t.Fatalf("write test ReDevPlugin runtime: %v", err)
	}
	return path
}
