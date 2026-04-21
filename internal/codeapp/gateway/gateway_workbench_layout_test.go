package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

func openGatewayWorkbenchLayoutService(t *testing.T) *workbenchlayout.Service {
	t.Helper()

	svc, err := workbenchlayout.Open(filepath.Join(t.TempDir(), "layout.sqlite"))
	if err != nil {
		t.Fatalf("workbenchlayout.Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	return svc
}

func newWorkbenchLayoutGatewayForTest(t *testing.T, svc *workbenchlayout.Service, cap config.PermissionSet) *Gateway {
	t.Helper()
	return &Gateway{
		layouts:            svc,
		localPermissionCap: &cap,
	}
}

func performWorkbenchLayoutRequest(t *testing.T, gw *Gateway, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := WithLocalUIEnvRoute(httptest.NewRequest(method, path, bytes.NewBufferString(body)))
	if strings.TrimSpace(body) != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	gw.handleAPI(rr, req)
	return rr
}

func decodeWorkbenchLayoutResponse[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
	t.Helper()

	var resp apiResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal(apiResp) error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("api response not ok: %s", rr.Body.String())
	}
	var out T
	raw, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("json.Marshal(data) error = %v", err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("json.Unmarshal(data) error = %v", err)
	}
	return out
}

func sampleWorkbenchLayoutRequestJSON() string {
	return `{
  "base_revision": 0,
  "widgets": [
    {
      "widget_id": "widget-files-1",
      "widget_type": "redeven.files",
      "x": 120,
      "y": 80,
      "width": 760,
      "height": 560,
      "z_index": 1,
      "created_at_unix_ms": 1700000000000
    }
  ]
}`
}

func readWorkbenchLayoutSSEEvent(t *testing.T, reader *bufio.Reader) workbenchlayout.Event {
	t.Helper()

	var dataLines []string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("ReadString() error = %v", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(line, "data: ") {
			dataLines = append(dataLines, strings.TrimPrefix(line, "data: "))
		}
	}
	if len(dataLines) == 0 {
		t.Fatal("sse event missing data")
	}
	var event workbenchlayout.Event
	if err := json.Unmarshal([]byte(strings.Join(dataLines, "\n")), &event); err != nil {
		t.Fatalf("json.Unmarshal(sse data) error = %v", err)
	}
	return event
}

func TestGatewayWorkbenchLayoutFlow(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	snapshotResp := performWorkbenchLayoutRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/workbench/layout/snapshot", "")
	if snapshotResp.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %s", snapshotResp.Code, snapshotResp.Body.String())
	}
	initialSnapshot := decodeWorkbenchLayoutResponse[workbenchlayout.Snapshot](t, snapshotResp)
	if initialSnapshot.Revision != 0 || len(initialSnapshot.Widgets) != 0 {
		t.Fatalf("initial snapshot = %#v, want empty revision 0", initialSnapshot)
	}

	putResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", sampleWorkbenchLayoutRequestJSON())
	if putResp.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", putResp.Code, putResp.Body.String())
	}
	putSnapshot := decodeWorkbenchLayoutResponse[workbenchlayout.Snapshot](t, putResp)
	if putSnapshot.Revision != 1 || putSnapshot.Seq != 1 {
		t.Fatalf("put snapshot = %#v, want revision 1 seq 1", putSnapshot)
	}
	if len(putSnapshot.Widgets) != 1 || putSnapshot.Widgets[0].WidgetID != "widget-files-1" {
		t.Fatalf("put snapshot widgets = %#v, want widget-files-1", putSnapshot.Widgets)
	}

	latestSnapshotResp := performWorkbenchLayoutRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/workbench/layout/snapshot", "")
	if latestSnapshotResp.Code != http.StatusOK {
		t.Fatalf("latest snapshot status = %d, body = %s", latestSnapshotResp.Code, latestSnapshotResp.Body.String())
	}
	latestSnapshot := decodeWorkbenchLayoutResponse[workbenchlayout.Snapshot](t, latestSnapshotResp)
	if latestSnapshot.Revision != putSnapshot.Revision || latestSnapshot.Seq != putSnapshot.Seq {
		t.Fatalf("latest snapshot = %#v, want %#v", latestSnapshot, putSnapshot)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/workbench/layout/events?after_seq=0", nil).WithContext(ctx))
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		gw.handleAPI(rr, req)
		close(done)
	}()

	time.Sleep(40 * time.Millisecond)
	cancel()
	<-done

	if rr.Code != http.StatusOK {
		t.Fatalf("event stream status = %d, body = %s", rr.Code, rr.Body.String())
	}
	reader := bufio.NewReader(strings.NewReader(rr.Body.String()))
	event := readWorkbenchLayoutSSEEvent(t, reader)
	if event.Type != workbenchlayout.EventTypeLayoutReplaced {
		t.Fatalf("event type = %q, want %q", event.Type, workbenchlayout.EventTypeLayoutReplaced)
	}
}

func TestGatewayWorkbenchLayoutWriteRequiresPermission(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: false, Execute: true})

	rr := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", sampleWorkbenchLayoutRequestJSON())
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body = %s", rr.Code, rr.Body.String())
	}
}

func TestGatewayWorkbenchLayoutReadRequiresPermission(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: false, Write: true, Execute: true})

	rr := performWorkbenchLayoutRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/workbench/layout/snapshot", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body = %s", rr.Code, rr.Body.String())
	}
}

func TestGatewayWorkbenchLayoutConflictReturnsCurrentRevision(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	first := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", sampleWorkbenchLayoutRequestJSON())
	if first.Code != http.StatusOK {
		t.Fatalf("first put status = %d, body = %s", first.Code, first.Body.String())
	}

	conflictBody := `{
  "base_revision": 0,
  "widgets": [
    {
      "widget_id": "widget-terminal-1",
      "widget_type": "redeven.terminal",
      "x": 40,
      "y": 60,
      "width": 840,
      "height": 500,
      "z_index": 1,
      "created_at_unix_ms": 1700000000100
    }
  ]
}`
	conflictResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", conflictBody)
	if conflictResp.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d, want 409, body = %s", conflictResp.Code, conflictResp.Body.String())
	}

	var resp apiResp
	if err := json.Unmarshal(conflictResp.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal(apiResp) error = %v", err)
	}
	if resp.ErrorCode != workbenchLayoutConflictErrorCode {
		t.Fatalf("error_code = %q, want %q", resp.ErrorCode, workbenchLayoutConflictErrorCode)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatalf("data = %#v, want map", resp.Data)
	}
	if currentRevision := int(data["current_revision"].(float64)); currentRevision != 1 {
		t.Fatalf("current_revision = %v, want 1", data["current_revision"])
	}
}
