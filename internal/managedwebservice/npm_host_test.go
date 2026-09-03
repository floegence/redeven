package managedwebservice

import (
	"context"
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
	if err := writeNPMApplicationManifest(appRoot, NPMHostPackageSpec{PackageName: "@scope/package", Version: "1.2.3"}); err != nil {
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

func TestNPMInstallArgumentsPinApplicationRootAndExactLayout(t *testing.T) {
	arguments := npmPackageInstallArguments("@scope/package", "1.2.3", "/managed/app")
	want := []string{
		"install", "@scope/package@1.2.3", "--prefix=/managed/app", "--omit=dev",
		"--package-lock=false", "--save-exact", "--install-strategy=hoisted", "--ignore-scripts",
		"--legacy-peer-deps=false", "--no-audit", "--fund=false", "--progress=false",
	}
	if len(arguments) != len(want) {
		t.Fatalf("arguments = %#v", arguments)
	}
	for index := range want {
		if arguments[index] != want[index] {
			t.Fatalf("argument %d = %q, want %q", index, arguments[index], want[index])
		}
	}
}

func TestRunNPMReleaseInstallUsesOneExactApplicationRoot(t *testing.T) {
	root := t.TempDir()
	appRoot := filepath.Join(root, "app")
	if err := os.MkdirAll(appRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	fakeNode := filepath.Join(root, "node")
	const fakeNodeScript = `#!/bin/sh
set -eu
shift
command="$1"
shift
prefix=""
for argument in "$@"; do
  case "$argument" in
    --prefix=*) prefix="${argument#--prefix=}" ;;
  esac
done
test -n "$prefix"
test "$(cat "$prefix/package.json")" = '{"private":true,"dependencies":{"@scope/package":"1.2.3"}}'
case "$command" in
  install)
    mkdir -p "$prefix/node_modules/@scope/package" "$prefix/node_modules/.bin"
    printf '%s' '{"name":"@scope/package","version":"1.2.3"}' > "$prefix/node_modules/@scope/package/package.json"
    printf '%s\n' '#!/bin/sh' > "$prefix/node_modules/.bin/package-cli"
    chmod 700 "$prefix/node_modules/.bin/package-cli"
    ;;
  rebuild)
    test -f "$prefix/node_modules/@scope/package/package.json"
    ;;
  *) exit 2 ;;
esac
`
	if err := os.WriteFile(fakeNode, []byte(fakeNodeScript), 0o700); err != nil {
		t.Fatal(err)
	}
	spec := NPMHostPackageSpec{PackageName: "@scope/package", Version: "1.2.3", RegistryURL: "https://registry.npmjs.org/", Executable: "package-cli"}
	if err := runNPMReleaseInstall(context.Background(), fakeNode, filepath.Join(root, "npm-cli.js"), appRoot, filepath.Join(root, "task"), spec, "secret-token"); err != nil {
		t.Fatal(err)
	}
	if err := verifyInstalledNPMPackage(appRoot, spec); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(appRoot, "package-lock.json")); !os.IsNotExist(err) {
		t.Fatalf("package lock exists or could not be checked: %v", err)
	}
}
