package managedwebservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
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

func TestVerifyNPMRuntimeAcceptsFinalInstalledLayout(t *testing.T) {
	root := t.TempDir()
	artifact, ok := auditedNodeRuntimeArtifact(currentPlatformKey())
	if !ok {
		t.Skip("managed Node.js Runtime is unavailable on this platform")
	}
	nodePath := filepath.Join(root, filepath.FromSlash(artifact.NodeRelPath))
	if err := os.MkdirAll(filepath.Dir(nodePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nodePath, []byte("node"), 0o700); err != nil {
		t.Fatal(err)
	}
	nodeDigest, err := fileSHA256(nodePath)
	if err != nil {
		t.Fatal(err)
	}
	runtimeDigest, err := managedNodeRuntimeDigest(root)
	if err != nil {
		t.Fatal(err)
	}

	spec := NPMHostPackageSpec{PackageName: "@scope/package", Version: "1.2.3", RegistryURL: "https://registry.npmjs.org/", Executable: "package-cli"}
	appRoot := filepath.Join(root, "app")
	packageRoot := filepath.Join(appRoot, "node_modules", "@scope", "package")
	binRoot := filepath.Join(appRoot, "node_modules", ".bin")
	if err := os.MkdirAll(packageRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(binRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := writeNPMApplicationManifest(appRoot, spec); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageRoot, "package.json"), []byte(`{"name":"@scope/package","version":"1.2.3"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binRoot, spec.Executable), []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	launcherPath := filepath.Join(root, "bin", "managed-service")
	if err := os.MkdirAll(filepath.Dir(launcherPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(launcherPath, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	identity := ReleaseIdentity{Integrity: testNPMIntegrity("installed")}
	manifest := npmRuntimeManifest{
		SchemaVersion: 1, PackageName: spec.PackageName, PackageVersion: spec.Version,
		PackageIntegrity: identity.Integrity, Registry: normalizedRegistryURL(spec.RegistryURL),
		Executable: spec.Executable, Platform: currentPlatformKey(), NodeSHA256: nodeDigest, RuntimeSHA256: runtimeDigest,
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "redeven-npm-runtime.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := verifyNPMRuntime(root, spec, identity); err != nil {
		t.Fatalf("final installed layout was not reusable: %v", err)
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

func TestNPMCommandEnvironmentEmitsInformationalInstallOutput(t *testing.T) {
	environment := npmCommandEnvironment(
		"/managed/node/bin/node",
		"/managed/home",
		"/managed/cache",
		"/managed/config/user.npmrc",
		"/managed/config/global.npmrc",
		"https://registry.npmjs.org/",
	)
	if !slices.Contains(environment, "npm_config_loglevel=info") {
		t.Fatalf("environment does not enable informational npm output: %#v", environment)
	}
	if slices.Contains(environment, "npm_config_loglevel=warn") {
		t.Fatalf("environment still suppresses normal npm install output: %#v", environment)
	}
}

func TestRunManagedNPMCommandCapturesBothStreamsAndTrailingOutput(t *testing.T) {
	root := t.TempDir()
	fakeNode := filepath.Join(root, "fake-node")
	if err := os.WriteFile(fakeNode, []byte("#!/bin/sh\nprintf 'resolving package\\ninstall complete'\nprintf 'lifecycle warning\\n' >&2\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	operation := pfregistry.ManagedOperation{
		OperationID: "mop_npm_output", ServiceID: "mws_npm_output", RequestID: "req_npm_output", RequestFingerprint: "fingerprint",
		Action: "install", State: "running", Stage: "installing", ProgressTotal: operationProgressTotal,
	}
	if err := registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	reporter := newOperationReporter(manager, &operation, nil)
	ctx := withOperationReporter(context.Background(), reporter)
	if err := runManagedNPMCommand(ctx, "npm-install", "<managed-node> install", fakeNode, nil, root, os.Environ()); err != nil {
		t.Fatal(err)
	}
	reporter.Close()

	persisted, err := registry.GetManagedOperation(context.Background(), operation.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted == nil || persisted.ProgressDetail == nil {
		t.Fatal("npm command progress was not persisted")
	}
	if len(persisted.ProgressDetail.Commands) != 1 || persisted.ProgressDetail.Commands[0].State != "succeeded" {
		t.Fatalf("commands = %#v", persisted.ProgressDetail.Commands)
	}
	got := make(map[string]string, len(persisted.ProgressDetail.Output))
	for _, line := range persisted.ProgressDetail.Output {
		got[line.Text] = line.Stream
	}
	for text, stream := range map[string]string{
		"resolving package": "stdout",
		"install complete":  "stdout",
		"lifecycle warning": "stderr",
	} {
		if got[text] != stream {
			t.Fatalf("output = %#v, want %q on %s", persisted.ProgressDetail.Output, text, stream)
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
