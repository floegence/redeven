//go:build darwin || linux

package managedwebservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// These helpers use the test executable as the application and Runtime fixture.
// There is no product supervisor executable or process in the launch path.
func TestIndependentHTTPApplicationHelper(t *testing.T) {
	if os.Getenv("REDEVEN_BOUNDARY_HELPER") != "1" {
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	address := "http://" + listener.Addr().String()
	if err := os.WriteFile(filepath.Join(os.Getenv("REDEVEN_SERVICE_RUN_DIR"), "address"), []byte(address), 0600); err != nil {
		panic(err)
	}
	go func() {
		block := strings.Repeat("application-output", 4096) + "\n"
		for {
			_, _ = io.WriteString(os.Stdout, block)
			_, _ = io.WriteString(os.Stderr, block)
			time.Sleep(time.Millisecond)
		}
	}()
	_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "alive") }))
	os.Exit(2)
}

func TestIndependentRuntimeProcessHelper(t *testing.T) {
	if os.Getenv("REDEVEN_BOUNDARY_HELPER") != "1" {
		return
	}
	root := os.Getenv("REDEVEN_BOUNDARY_ROOT")
	executable, err := os.Executable()
	if err != nil {
		panic(err)
	}
	quote := "'" + strings.ReplaceAll(executable, "'", "'\"'\"'") + "'"
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec " + quote + " -test.run=^TestIndependentHTTPApplicationHelper$", OutputMode: os.Getenv("REDEVEN_BOUNDARY_OUTPUT")}}
	if os.Getenv("REDEVEN_BOUNDARY_BLOCK_HOOK") == "1" {
		spec.Host.AfterStartScript = `echo $$ > "$REDEVEN_SERVICE_RUN_DIR/hook-pid"; touch "$REDEVEN_WORKSPACE/hook-ready"; exec sleep 60`
	}
	manager, service := hostTestService(t, root, spec)
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	manager.host = driver
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		panic(err)
	}
	service.RuntimeIdentity = identity
	raw, _ := json.Marshal(service)
	if err := os.WriteFile(filepath.Join(root, "runtime-ready"), raw, 0600); err != nil {
		panic(err)
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	if err := manager.Close(); err != nil {
		panic(err)
	}
	os.Exit(0)
}

func TestHostSurvivesRealRuntimeProcessExitWithHeavyOutput(t *testing.T) {
	if testing.Short() {
		t.Skip("cross-process lifecycle integration")
	}
	for _, mode := range []string{"discard", "private_file"} {
		for _, shutdown := range []string{"close", "kill"} {
			t.Run(mode+"/"+shutdown, func(t *testing.T) {
				root, err := filepath.EvalSymlinks(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				executable, _ := os.Executable()
				cmd := exec.Command(executable, "-test.run=^TestIndependentRuntimeProcessHelper$")
				cmd.Env = append(os.Environ(), "REDEVEN_BOUNDARY_HELPER=1", "REDEVEN_BOUNDARY_ROOT="+root, "REDEVEN_BOUNDARY_OUTPUT="+mode)
				diagnostics, err := os.Create(filepath.Join(root, "runtime-test-output"))
				if err != nil {
					t.Fatal(err)
				}
				defer diagnostics.Close()
				cmd.Stdout, cmd.Stderr = diagnostics, diagnostics
				input, err := cmd.StdinPipe()
				if err != nil {
					t.Fatal(err)
				}
				if err := cmd.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = cmd.Process.Kill(); _ = input.Close() })
				var service pfregistry.ManagedService
				waitBoundaryCondition(t, func() bool {
					raw, err := os.ReadFile(filepath.Join(root, "runtime-ready"))
					return err == nil && json.Unmarshal(raw, &service) == nil
				})
				pid := hostPIDFromIdentity(service.RuntimeIdentity)
				initial, err := readManagedProcess(pid)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = killHostProcess(hostProcess{pid: pid, fingerprint: initial.fingerprint()}) })
				registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				defer registry.Close()
				stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
				if err != nil || stored == nil {
					t.Fatalf("load persisted launch: %v", err)
				}
				service = *stored
				scope, err := filesystemscope.NewDefaultRegistry(root)
				if err != nil {
					t.Fatal(err)
				}
				catalog, err := LoadBuiltinCatalog()
				if err != nil {
					t.Fatal(err)
				}
				manager := &Manager{stateDir: root, registry: registry, scope: scope, catalog: catalog}
				driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
				manager.host = driver
				var address string
				t.Cleanup(func() {
					if t.Failed() {
						raw, _ := os.ReadFile(filepath.Join(driver.runDirectory(&service), "output"))
						t.Logf("application diagnostics: %.2048s", raw)
						t.Logf("service run directory: %s", driver.runDirectory(&service))
					}
				})
				waitBoundaryCondition(t, func() bool {
					raw, err := os.ReadFile(filepath.Join(driver.runDirectory(&service), "address"))
					address = string(raw)
					return err == nil && address != ""
				})
				client := &http.Client{Timeout: time.Second}
				checkHTTP := func() {
					response, err := client.Get(address)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					raw, _ := io.ReadAll(response.Body)
					if string(raw) != "alive" {
						t.Fatalf("application response=%q", raw)
					}
				}
				checkHTTP()
				if shutdown == "kill" {
					_ = cmd.Process.Kill()
				} else {
					_ = input.Close()
				}
				waitErr := cmd.Wait()
				if shutdown == "close" && waitErr != nil {
					raw, _ := os.ReadFile(diagnostics.Name())
					t.Fatalf("Runtime close: %v %s", waitErr, raw)
				}
				// Output continues well beyond the capacity of an inherited pipe.
				for i := 0; i < 10; i++ {
					checkHTTP()
					time.Sleep(20 * time.Millisecond)
				}
				recovered, running, err := driver.recoverPersistedProcess(&service)
				if err != nil || !running || recovered.identity != service.RuntimeIdentity {
					t.Fatalf("recovery=%+v running=%v err=%v", recovered, running, err)
				}
				current, err := readManagedProcess(pid)
				if err != nil || current.fingerprint() != initial.fingerprint() {
					t.Fatal("Runtime exit replaced the application")
				}
				if mode == "private_file" {
					path := filepath.Join(driver.runDirectory(&service), "output")
					info, err := os.Stat(path)
					if err != nil || info.Size() <= hostPrivateOutputLimit {
						t.Fatalf("output did not cross truncation threshold: %v %v", info, err)
					}
					if err := truncatePrivateOutput(path, hostPrivateOutputLimit); err != nil {
						t.Fatal(err)
					}
					after, _ := os.Stat(path)
					if !os.SameFile(info, after) {
						t.Fatal("output file descriptor was replaced")
					}
					checkHTTP()
				}
			})
		}
	}
}

func waitBoundaryCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(fmt.Sprintf("process boundary condition timed out after %s", 10*time.Second))
}

func TestRuntimeKilledDuringOpeningHookPreservesApplicationAndEndsHook(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	executable, _ := os.Executable()
	cmd := exec.Command(executable, "-test.run=^TestIndependentRuntimeProcessHelper$")
	cmd.Env = append(os.Environ(), "REDEVEN_BOUNDARY_HELPER=1", "REDEVEN_BOUNDARY_ROOT="+root, "REDEVEN_BOUNDARY_OUTPUT=discard", "REDEVEN_BOUNDARY_BLOCK_HOOK=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	waitBoundaryCondition(t, func() bool { _, err := os.Stat(filepath.Join(root, "hook-ready")); return err == nil })
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service, err := registry.GetManagedService(context.Background(), "mws_host_test")
	if err != nil {
		t.Fatal(err)
	}
	pid := hostPIDFromIdentity(service.RuntimeIdentity)
	t.Cleanup(func() { _ = killManagedProcessPID(pid) })
	manager := &Manager{stateDir: root, registry: registry}
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	raw, err := os.ReadFile(filepath.Join(driver.runDirectory(service), "hook-pid"))
	if err != nil {
		t.Fatal(err)
	}
	hookPID, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	waitBoundaryCondition(t, func() bool { return !managedProcessRunning(hookPID) })
	if _, alive, err := driver.recoverPersistedProcess(service); err != nil || !alive {
		t.Fatalf("hook cleanup affected application: %v", err)
	}
	raw, err = os.ReadFile(filepath.Join(driver.runDirectory(service), "address"))
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("application stopped responding")
	}
}
