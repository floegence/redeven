package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/tessiven"
)

func TestTessivenWorksWithoutAIAndEnforcesPermissions(t *testing.T) {
	svc, err := tessiven.Open(filepath.Join(t.TempDir(), "canvas.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	cap := config.PermissionSet{Read: true, Write: true, Execute: true}
	srv := &Server{tessiven: svc, localPermissionCap: &cap}
	payload, _ := json.Marshal(map[string]string{"request_id": "create-1", "title": "Test business"})
	created := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases", string(payload))
	if created.Code != 200 {
		t.Fatalf("create: %s", created.Body.String())
	}
	value := decodeWorkbenchLayoutResponse[tessiven.SaveResult](t, created)
	retried := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases", string(payload))
	retry := decodeWorkbenchLayoutResponse[tessiven.SaveResult](t, retried)
	if retry.Canvas.ID != value.Canvas.ID || retry.Version.Number != 1 {
		t.Fatal("creation retry must return the original empty canvas")
	}
	if len(value.Version.Document.Nodes) != 0 || value.Version.Source != "created" {
		t.Fatal("new canvas must start empty")
	}
	manual := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases", `{"request_id":"manual","title":"Manual","document_yaml":"invalid"}`)
	if manual.Code != 400 {
		t.Fatalf("manual content rejected: %s", manual.Body.String())
	}
	for _, route := range []string{"versions", "rename", "duplicate", "restore"} {
		response := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases/"+value.Canvas.ID+"/"+route, `{}`)
		if response.Code != 404 {
			t.Fatalf("manual %s must be unavailable: %d", route, response.Code)
		}
	}
	cap.Write = false
	denied := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases", string(payload))
	if denied.Code != 403 {
		t.Fatalf("write permission: %d", denied.Code)
	}
	historical := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/canvases/"+value.Canvas.ID+"/versions/1", "")
	if historical.Code != 200 || !strings.Contains(historical.Body.String(), "Test business") {
		t.Fatalf("historical read: %s", historical.Body.String())
	}
	contract := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/presentation-contract", "")
	if contract.Code != 200 {
		t.Fatal(contract.Body.String())
	}
	presentationPath := tessivenAPIBase + "/canvases/" + value.Canvas.ID + "/versions/1/presentation?format=" + tessiven.PresentationFormat + "&capabilities=group_layouts"
	response := performWorkbenchLayoutRequest(t, srv, http.MethodGet, presentationPath, "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	presentation := decodeWorkbenchLayoutResponse[tessiven.PresentationSnapshot](t, response)
	if presentation.Canvas.ID != value.Canvas.ID || presentation.Version.Number != 1 || presentation.Version.View.Format != tessiven.PresentationFormat || presentation.Version.DocumentYAML != value.Version.DocumentYAML || presentation.Version.Digest != value.Version.Digest {
		t.Fatal("presentation/source identity drift")
	}
	for _, query := range []string{"format=future", "format=" + tessiven.PresentationFormat + "&capabilities=group_layouts,group_layouts", "format=" + tessiven.PresentationFormat + "&target=remote"} {
		response := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/canvases/"+value.Canvas.ID+"/versions/1/presentation?"+query, "")
		if response.Code != 400 && response.Code != 409 {
			t.Fatal("invalid presentation negotiation was accepted")
		}
	}
	cap.Read = false
	for _, path := range []string{tessivenAPIBase + "/presentation-contract", presentationPath} {
		if result := performWorkbenchLayoutRequest(t, srv, http.MethodGet, path, ""); result.Code != 403 {
			t.Fatal("presentation bypassed read permission")
		}
	}
	denied = performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/canvases", "")
	if denied.Code != 403 {
		t.Fatalf("read permission: %d", denied.Code)
	}
	cap.Read = true
	cap.Write = true
	bad := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/canvases/"+value.Canvas.ID+"/versions", `{"request_id":"bad","expected_version":1,"document_yaml":"invalid"}`)
	if bad.Code != 404 {
		t.Fatalf("validation: %s", bad.Body.String())
	}
	current, err := svc.Canvas(context.Background(), value.Canvas.ID)
	if err != nil || current.LatestVersion != 1 {
		t.Fatal("failed request modified canvas")
	}
}

func TestTessivenSchemaUsesExactDSLVersion(t *testing.T) {
	svc, err := tessiven.Open(filepath.Join(t.TempDir(), "canvas.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	cap := config.PermissionSet{Read: true}
	srv := &Server{tessiven: svc, localPermissionCap: &cap}
	for query, version := range map[string]string{"": "v1.1.0", "?version=v1": "v1", "?version=v1.0.0": "v1.0.0", "?version=v1.1.0": "v1.1.0"} {
		response := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/schema"+query, "")
		if response.Code != 200 {
			t.Fatal(response.Body.String())
		}
		schema := decodeWorkbenchLayoutResponse[map[string]any](t, response)
		if schema["properties"].(map[string]any)["apiVersion"].(map[string]any)["const"] != "redeven.io/tessiven/"+version {
			t.Fatal("schema version mismatch")
		}
	}
	for _, query := range []string{"?version=v1.2.3", "?version=v1&version=v1.0.0", "?version=", "?future=true"} {
		response := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/schema"+query, "")
		if response.Code != 400 {
			t.Fatalf("unsupported schema selector: %s %d", query, response.Code)
		}
	}
	cap.Read = false
	response := performWorkbenchLayoutRequest(t, srv, http.MethodGet, tessivenAPIBase+"/schema?version=v1", "")
	if response.Code != 403 {
		t.Fatal("version selector bypassed read permission")
	}
}

func TestTessivenBusinessRejectsSelfDeclaredAuthorityAndRemoteTarget(t *testing.T) {
	svc, err := tessiven.Open(filepath.Join(t.TempDir(), "canvas.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	cap := config.PermissionSet{Read: true, Write: true, Execute: true}
	srv := &Server{tessiven: svc, localPermissionCap: &cap, tessivenResources: &tessiven.ResourceBackend{RuntimeIdentity: func() string { return "actual" }}}
	for _, body := range []string{
		`{"identity":"actual","permissions":{"read":true,"write":true,"execute":true},"request":{"runtime_ref":"local:local","action":"list"}}`,
		`{"identity":"actual","request":{"runtime_ref":"ssh:other","action":"list"}}`,
		`{"identity":"actual","request":{"runtime_ref":"local:local","action":"update"}}`,
	} {
		response := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/business", body)
		if response.Code != 400 {
			t.Fatalf("untrusted business payload accepted: %d %s", response.Code, response.Body.String())
		}
	}
	response := performWorkbenchLayoutRequest(t, srv, http.MethodPost, tessivenAPIBase+"/business", `{"identity":"actual","request":{"runtime_ref":"local:local","action":"list"}}`)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}
