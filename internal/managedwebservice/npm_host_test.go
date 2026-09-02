package managedwebservice

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyInstalledNPMPackageUsesScopedPackageDirectory(t *testing.T) {
	appRoot := t.TempDir()
	packageRoot := filepath.Join(appRoot, "node_modules", "@scope", "package")
	binRoot := filepath.Join(appRoot, "node_modules", ".bin")
	if err := os.MkdirAll(packageRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(binRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageRoot, "package.json"), []byte(`{"name":"@scope/package","version":"1.2.3"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binRoot, "package-cli"), []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}

	if err := verifyInstalledNPMPackage(appRoot, NPMHostPackageSpec{PackageName: "@scope/package", Version: "1.2.3", Executable: "package-cli"}); err != nil {
		t.Fatal(err)
	}
}
