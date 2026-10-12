//go:build darwin || linux

package managedwebservice

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	templatecontract "github.com/floegence/redeven-service-templates/template"
)

func TestManagedOpeningHTTPHelper(t *testing.T) {
	if os.Getenv("REDEVEN_OPENING_HTTP_HELPER") != "1" {
		return
	}
	port := os.Getenv("REDEVEN_SERVICE_PORT")
	token := fmt.Sprintf("launch-%d", time.Now().UnixNano())
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		panic(err)
	}
	fmt.Printf("web: http://127.0.0.1:%s/?token=%s (LAN: http://192.168.1.1:%s/)\n", port, token, port)
	http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") == token {
			http.SetCookie(w, &http.Cookie{Name: "managed_auth", Value: token, Path: "/", HttpOnly: true})
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		cookie, err := r.Cookie("managed_auth")
		if err != nil || cookie.Value != token {
			w.WriteHeader(401)
			return
		}
		fmt.Fprint(w, "<!doctype html><html><body><h1>Authenticated managed service</h1></body></html>")
	}))
}

func TestManagedHostOpeningQualification(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_OPENING_QUALIFICATION") != "1" {
		t.Skip("dedicated managed entrance qualification only")
	}
	executable, _ := os.Executable()
	quote := "'" + strings.ReplaceAll(executable, "'", "'\"'\"'") + "'"
	spec := TemplateSpec{SchemaVersion: 7, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", StartupTimeout: 10}, StartupURL: &templatecontract.StartupURLSpec{LinePrefix: "web: "}, Host: &HostTemplateSpec{OutputMode: "private_file", StartScript: "REDEVEN_OPENING_HTTP_HELPER=1 exec " + quote + " -test.run=^TestManagedOpeningHTTPHelper$"}}
	m, service := hostTestService(t, t.TempDir(), spec)
	driver := &hostScriptDriver{manager: m, processes: map[string]hostProcess{}}
	m.host = driver
	identity, err := m.startRuntime(context.Background(), service, driver)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = driver.Stop(context.Background(), service) })
	t.Logf("owned Host pid=%d port=%d state=%s", hostPIDFromIdentity(identity), service.RuntimePort, m.stateDir)
	dockerLifecycleHealthy(t, context.Background(), m, service)
	first, err := m.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "qualification-first"})
	if err != nil {
		t.Fatal(err)
	}
	if err := driver.Stop(context.Background(), service); err != nil {
		t.Fatal(err)
	}
	identity, err = m.startRuntime(context.Background(), service, driver)
	if err != nil {
		t.Fatal(err)
	}
	dockerLifecycleHealthy(t, context.Background(), m, service)
	second, err := m.OpenSession(context.Background(), service.ServiceID, OpenSessionRequest{RequestID: "qualification-restarted"})
	if err != nil || first.AppPath == second.AppPath || first.LaunchGeneration == second.LaunchGeneration {
		t.Fatal("Host restart reused old authentication entrance", err)
	}
}

func TestManagedComposeOpeningQualification(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_OPENING_QUALIFICATION") != "1" {
		t.Skip("dedicated managed entrance qualification only")
	}
	home, _ := os.UserHomeDir()
	root, err := os.MkdirTemp(home, ".redeven-compose-opening-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	m := openDockerManagementTest(t, root, false)
	image := "ghcr.io/runzhliu/deepseek-harness@" + os.Getenv("REDEVEN_MANAGED_COMPOSE_DIGEST")
	if strings.HasSuffix(image, "@") {
		t.Fatal("exact Compose qualification digest is required")
	}
	// A decoy sibling emits an unsafe URL. Only the verified Web mapping may supply the entrance.
	spec := TemplateSpec{SchemaVersion: 7, Kind: DeploymentCompose, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3080, StartupTimeout: 120}, StartupURL: &templatecontract.StartupURLSpec{LinePrefix: "dsh web: "}, Compose: &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: " + image + "\n    user: 1000:1000\n    environment:\n      DSH_DESKTOP_ENABLED: '0'\n    volumes:\n      - data:/home/node/.dsh\n      - workspace:/workspace\n  decoy:\n    image: " + image + "\n    user: 1000:1000\n    entrypoint: /bin/sh\n    command: ['-c', 'echo dsh web: http://evil.invalid:3080/; sleep 600']\nvolumes:\n  data: {}\n  workspace: {}\n"}}
	template, err := m.CreateTemplate(context.Background(), TemplateWriteRequest{RequestID: "compose-opening-template", Name: "Opening qualification", Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	req := CreateRequest{RequestID: "compose-opening-install", TemplateID: template.TemplateID, Deployment: DeploymentCompose, WorkspacePath: filepath.Join(root, "workspace")}
	plan, err := m.PreflightInstall(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest = plan.PlanDigest
	created, err := m.Create(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	id := created.Service.ServiceID
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		p, err := m.PreflightManagement(ctx, id, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
		if err != nil {
			t.Error(err)
			return
		}
		op, err := m.Operate(ctx, id, OperationRequest{RequestID: "compose-opening-cleanup", Action: ActionUninstall, PlanDigest: p.PlanDigest, DeleteData: true, DeleteWorkspace: true, Administrator: true})
		if err != nil {
			t.Error(err)
			return
		}
		dockerLifecycleOperation(t, ctx, m, op)
	})
	dockerLifecycleOperation(t, context.Background(), m, &created.Operation)
	service := dockerLifecycleService(t, context.Background(), m, id)
	t.Logf("owned Compose runtime pid=%d port=%d state=%s", os.Getpid(), service.RuntimePort, root)
	dockerLifecycleHealthy(t, context.Background(), m, service)
	first, err := m.OpenSession(context.Background(), id, OpenSessionRequest{RequestID: "compose-opening-first"})
	if err != nil {
		t.Fatal(err)
	}
	op, err := m.Operate(context.Background(), id, OperationRequest{RequestID: "compose-opening-restart", Action: ActionRestart})
	if err != nil {
		t.Fatal(err)
	}
	dockerLifecycleOperation(t, context.Background(), m, op)
	service = dockerLifecycleService(t, context.Background(), m, id)
	dockerLifecycleHealthy(t, context.Background(), m, service)
	second, err := m.OpenSession(context.Background(), id, OpenSessionRequest{RequestID: "compose-opening-second"})
	if err != nil || first.LaunchGeneration == second.LaunchGeneration || first.AppPath == second.AppPath {
		t.Fatal("Compose restart reused authentication entrance", err)
	}
}

func qualifyManagedOpeningBrowser(t *testing.T, port int, appPath string) {
	t.Helper()
	if os.Getenv("REDEVEN_MANAGED_OPENING_QUALIFICATION") != "1" {
		return
	}
	input := fmt.Sprintf("{\"url\":%q}", "http://127.0.0.1:"+strconv.Itoa(port)+appPath)
	cmd := exec.Command("node", "../../desktop/scripts/check-managed-opening-electron.mjs")
	cmd.Stdin = strings.NewReader(input)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real managed page qualification failed: %v\n%s", err, output)
	}
	t.Log(strings.TrimSpace(string(output)))
}
