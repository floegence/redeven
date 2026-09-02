package managedwebservice

import (
	"context"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestNativeDeepSeekHarnessReleaseInstallAndWeb(t *testing.T) {
	if os.Getenv("REDEVEN_TEST_NATIVE_DEEPSEEK_HARNESS") != "1" {
		t.Skip("set REDEVEN_TEST_NATIVE_DEEPSEEK_HARNESS=1 to run the release download smoke test")
	}
	artifact, ok := auditedNativeArtifact(currentPlatformKey())
	if !ok {
		t.Skip("the current platform does not have a release-locked native runtime")
	}
	stateDir := t.TempDir()
	installer := &nativeDriver{
		stateDir:      stateDir,
		client:        defaultPackageDownloadClient().packageHTTPClient(),
		packageOrigin: defaultNodePackageOrigin,
	}
	workspace := t.TempDir()
	snapshot, snapshotDigest, err := canonicalTemplateSpec(deepSeekHostTemplateSpec())
	if err != nil {
		t.Fatal(err)
	}
	configuration, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_native_release_smoke", TemplateID: DeepSeekHarnessHostTemplateID, TemplateSource: "builtin", ServiceFamilyID: DeepSeekHarnessHostTemplateID,
		WorkspacePath: workspace, Version: DeepSeekHarnessVersion, TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: snapshotDigest,
		ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
	}
	installRoot := filepath.Join(stateDir, DeepSeekHarnessProductID, "native", DeepSeekHarnessVersion, currentPlatformKey())
	executable, err := installer.installRuntimeBundle(context.Background(), service, artifact, installRoot, func(stage string, _ int64, _ ...pfregistry.ManagedOperationTransferProgress) { t.Log(stage) })
	if err != nil {
		t.Fatal(err)
	}
	versionOutput, err := exec.Command(executable, "--version").CombinedOutput()
	if err != nil || !strings.Contains(string(versionOutput), DeepSeekHarnessVersion) {
		t.Fatalf("DeepSeek Harness version output=%q err=%v", versionOutput, err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimePort = listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	service.ArtifactReference = executable
	setLegacyDeepSeekReleaseIdentity(t, service)
	driver := &hostScriptDriver{manager: &Manager{stateDir: stateDir}, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	t.Cleanup(func() { _ = driver.Stop(context.Background(), service) })
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(60 * time.Second)
	for {
		response, requestErr := client.Get("http://127.0.0.1:" + strconv.Itoa(service.RuntimePort) + "/")
		if requestErr == nil {
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 500 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("DeepSeek Harness did not become healthy: %v", requestErr)
		}
		time.Sleep(250 * time.Millisecond)
	}
	if err := driver.Stop(context.Background(), service); err != nil {
		t.Fatal(err)
	}
}
