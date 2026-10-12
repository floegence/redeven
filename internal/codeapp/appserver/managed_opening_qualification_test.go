//go:build darwin || linux

package appserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/managedwebservice"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

func TestProtectedOpeningHTTPHelper(t *testing.T) {
	if os.Getenv("REDEVEN_PROTECTED_OPENING_HELPER") != "1" {
		return
	}
	port, token := os.Getenv("REDEVEN_SERVICE_PORT"), fmt.Sprintf("launch-%d", time.Now().UnixNano())
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		panic(err)
	}
	fmt.Printf("web: http://127.0.0.1:%s/?token=%s\n", port, token)
	_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") == token {
			http.SetCookie(w, &http.Cookie{Name: "managed_auth", Value: token, Path: "/", HttpOnly: true})
			http.Redirect(w, r, "/", 302)
			return
		}
		cookie, err := r.Cookie("managed_auth")
		if err != nil || cookie.Value != token {
			w.WriteHeader(401)
			return
		}
		fmt.Fprint(w, "<!doctype html><html><body><h1>Authenticated managed service through Redeven</h1></body></html>")
	}))
}

func TestManagedProtectedOpeningQualification(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_OPENING_QUALIFICATION") != "1" {
		t.Skip("dedicated managed entrance qualification only")
	}
	ctx := context.Background()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	manager, err := managedwebservice.New(managedwebservice.ManagerOptions{StateDir: filepath.Join(root, "state"), Scope: scope, Registry: registry})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	executable, _ := os.Executable()
	quote := "'" + strings.ReplaceAll(executable, "'", "'\"'\"'") + "'"
	spec := managedwebservice.TemplateSpec{SchemaVersion: 7, Kind: managedwebservice.DeploymentHost, Endpoint: managedwebservice.WebEndpointSpec{Scheme: "http", StartupTimeout: 10}, StartupURL: &templatecontract.StartupURLSpec{LinePrefix: "web: "}, Host: &managedwebservice.HostTemplateSpec{OutputMode: "private_file", StartScript: "REDEVEN_PROTECTED_OPENING_HELPER=1 exec " + quote + " -test.run=^TestProtectedOpeningHTTPHelper$"}}
	template, err := manager.CreateTemplate(ctx, managedwebservice.TemplateWriteRequest{RequestID: "protected-template", Name: "Protected entrance qualification", Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	req := managedwebservice.CreateRequest{RequestID: "protected-install", TemplateID: template.TemplateID, Deployment: managedwebservice.DeploymentHost, WorkspacePath: filepath.Join(root, "workspace")}
	plan, err := manager.PreflightInstall(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest = plan.PlanDigest
	created, err := manager.Create(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	id, forwardID := created.Service.ServiceID, created.Service.ForwardID
	defer func() {
		service, _ := registry.GetManagedService(ctx, id)
		if service == nil || service.ManagementState == "uninstalled" {
			return
		}
		op, err := manager.Operate(ctx, id, managedwebservice.OperationRequest{RequestID: "protected-stop", Action: managedwebservice.ActionStop})
		if err != nil {
			t.Error(err)
			return
		}
		waitProtectedOperation(t, manager, op.OperationID)
	}()
	waitProtectedOperation(t, manager, created.Operation.OperationID)
	channelID := "ch_managed_qualification"
	srv, err := New(Options{Backend: &stubBackend{}, ManagedWebServices: manager, PortForward: &revocableForwardBackend{registry: registry}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}}, ConfigPath: writeLocalUITestConfig(t), ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})})
	if err != nil {
		t.Fatal(err)
	}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/pf/"+forwardID+"/") {
			r = WithLocalUIPortForwardRoute(r, forwardID)
		}
		srv.serveHTTP(w, r)
	}))
	defer gateway.Close()
	request, _ := http.NewRequest("POST", gateway.URL+managedServicesAPIBase+"/"+id+"/open-session", strings.NewReader(`{"request_id":"protected-open"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("protected opening API did not return a private handoff", response.StatusCode)
	}
	var envelope struct {
		Data managedwebservice.OpenSession `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Data.State != "ready" || envelope.Data.ManagedEntrance == nil {
		t.Fatal("Runtime did not prepare a declared entrance")
	}
	entrance := gateway.URL + "/pf/" + forwardID + envelope.Data.AppPath
	input, _ := json.Marshal(map[string]string{"url": entrance, "rootURL": gateway.URL + "/pf/" + forwardID + "/"})
	cmd := exec.Command("node", "../../../desktop/scripts/check-managed-opening-electron.mjs")
	cmd.Stdin = strings.NewReader(string(input))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("protected real page failed: %v\n%s", err, output)
	}
	t.Logf("owned protected gateway pid=%d port=%s state=%s", os.Getpid(), gateway.Listener.Addr(), root)
	t.Log(strings.TrimSpace(string(output)))
	uninstallPlan, err := manager.PreflightManagement(ctx, id, managedwebservice.ManagementPlanRequest{Action: managedwebservice.ActionUninstall, DeleteData: false, DeleteWorkspace: false})
	if err != nil {
		t.Fatal(err)
	}
	uninstall, err := manager.Operate(ctx, id, managedwebservice.OperationRequest{RequestID: "protected-uninstall", Action: managedwebservice.ActionUninstall, PlanDigest: uninstallPlan.PlanDigest, Administrator: true})
	if err != nil {
		t.Fatal(err)
	}
	waitProtectedOperation(t, manager, uninstall.OperationID)
	revoked, err := http.Get(gateway.URL + "/pf/" + forwardID + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer revoked.Body.Close()
	if revoked.StatusCode < 400 {
		t.Fatal("revoked route remained accessible")
	}
}

func waitProtectedOperation(t *testing.T, m *managedwebservice.Manager, id string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		op, err := m.Operation(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "succeeded" {
			return
		}
		if op.State == "failed" || op.State == "cancelled" {
			t.Fatalf("operation failed: %s", op.ErrorCode)
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("owned qualification operation timed out")
}
