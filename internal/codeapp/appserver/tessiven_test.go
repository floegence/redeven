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
	cap.Read = false
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
