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
	"github.com/floegence/redeven/internal/terminal"
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

func newWorkbenchLayoutGatewayWithTerminalForTest(t *testing.T, svc *workbenchlayout.Service, cap config.PermissionSet) *Gateway {
	t.Helper()
	manager := terminal.NewManager("/bin/bash", t.TempDir(), nil)
	t.Cleanup(func() {
		manager.Cleanup()
	})
	return &Gateway{
		layouts:            svc,
		term:               manager,
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
  ],
  "sticky_notes": [
    {
      "id": "sticky-1",
      "kind": "sticky_note",
      "body": "Remember this decision",
      "color": "amber",
      "x": 220,
      "y": 140,
      "width": 260,
      "height": 184,
      "z_index": 2,
      "created_at_unix_ms": 1700000000100,
      "updated_at_unix_ms": 1700000000100
    }
  ],
  "annotations": [
    {
      "id": "text-1",
      "kind": "text",
      "text": "Review area",
      "font_family": "ui-serif, Georgia, serif",
      "font_size": 34,
      "font_weight": 760,
      "color": "#6b7280",
      "align": "left",
      "x": 320,
      "y": 180,
      "width": 360,
      "height": 96,
      "z_index": 3,
      "created_at_unix_ms": 1700000000200,
      "updated_at_unix_ms": 1700000000200
    }
  ],
  "background_layers": [
    {
      "id": "region-1",
      "name": "Focus area",
      "fill": "#9da8a1",
      "opacity": 0.72,
      "material": "dotted",
      "x": 80,
      "y": 60,
      "width": 560,
      "height": 360,
      "z_index": 0,
      "created_at_unix_ms": 1700000000300,
      "updated_at_unix_ms": 1700000000300
    }
  ]
}`
}

func sampleWorkbenchTerminalLayoutRequestJSON() string {
	return `{
  "base_revision": 0,
  "widgets": [
    {
      "widget_id": "widget-terminal-1",
      "widget_type": "redeven.terminal",
      "x": 80,
      "y": 60,
      "width": 840,
      "height": 500,
      "z_index": 1,
      "created_at_unix_ms": 1700000000200
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
	if len(putSnapshot.StickyNotes) != 1 || putSnapshot.StickyNotes[0].ID != "sticky-1" {
		t.Fatalf("put snapshot sticky notes = %#v, want sticky-1", putSnapshot.StickyNotes)
	}
	if len(putSnapshot.Annotations) != 1 || putSnapshot.Annotations[0].ID != "text-1" {
		t.Fatalf("put snapshot annotations = %#v, want text-1", putSnapshot.Annotations)
	}
	if len(putSnapshot.BackgroundLayers) != 1 || putSnapshot.BackgroundLayers[0].ID != "region-1" {
		t.Fatalf("put snapshot background layers = %#v, want region-1", putSnapshot.BackgroundLayers)
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
	var payload workbenchlayout.Snapshot
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("json.Unmarshal(event payload) error = %v", err)
	}
	if len(payload.StickyNotes) != 1 || len(payload.Annotations) != 1 || len(payload.BackgroundLayers) != 1 {
		t.Fatalf("event payload layered objects = %#v/%#v/%#v, want full snapshot", payload.StickyNotes, payload.Annotations, payload.BackgroundLayers)
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

	openResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/actions/open_preview", `{
  "item": {
    "path": "/workspace/demo.txt",
    "name": "demo.txt"
  }
}`)
	if openResp.Code != http.StatusForbidden {
		t.Fatalf("open preview status = %d, want 403, body = %s", openResp.Code, openResp.Body.String())
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

func TestGatewayWorkbenchWidgetStateFlow(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	putLayoutResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", sampleWorkbenchLayoutRequestJSON())
	if putLayoutResp.Code != http.StatusOK {
		t.Fatalf("layout put status = %d, body = %s", putLayoutResp.Code, putLayoutResp.Body.String())
	}

	stateResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/widgets/widget-files-1/state", `{
  "base_revision": 0,
  "widget_type": "redeven.files",
  "state": {
    "kind": "files",
    "current_path": "/workspace/src"
  }
}`)
	if stateResp.Code != http.StatusOK {
		t.Fatalf("state put status = %d, body = %s", stateResp.Code, stateResp.Body.String())
	}
	state := decodeWorkbenchLayoutResponse[workbenchlayout.WidgetState](t, stateResp)
	if state.WidgetID != "widget-files-1" || state.Revision != 1 || state.State.CurrentPath != "/workspace/src" {
		t.Fatalf("state = %#v, want files revision 1", state)
	}

	snapshotResp := performWorkbenchLayoutRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/workbench/layout/snapshot", "")
	if snapshotResp.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %s", snapshotResp.Code, snapshotResp.Body.String())
	}
	snapshot := decodeWorkbenchLayoutResponse[workbenchlayout.Snapshot](t, snapshotResp)
	if len(snapshot.WidgetStates) != 1 || snapshot.WidgetStates[0].State.CurrentPath != "/workspace/src" {
		t.Fatalf("snapshot widget states = %#v, want files path", snapshot.WidgetStates)
	}

	conflictResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/widgets/widget-files-1/state", `{
  "base_revision": 0,
  "widget_type": "redeven.files",
  "state": {
    "kind": "files",
    "current_path": "/workspace/other"
  }
}`)
	if conflictResp.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d, want 409, body = %s", conflictResp.Code, conflictResp.Body.String())
	}
	var resp apiResp
	if err := json.Unmarshal(conflictResp.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal(apiResp) error = %v", err)
	}
	if resp.ErrorCode != workbenchWidgetStateConflictErrorCode {
		t.Fatalf("error_code = %q, want %q", resp.ErrorCode, workbenchWidgetStateConflictErrorCode)
	}
}

func TestGatewayWorkbenchOpenPreviewAction(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	createResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/actions/open_preview", `{
  "request_id": "request-preview-create",
  "item": {
    "path": "/workspace/demo.txt",
    "name": "demo.txt",
    "size": 42
  },
  "viewport": {
    "center_x": 640,
    "center_y": 420,
    "default_width": 900,
    "default_height": 620
  }
}`)
	if createResp.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	created := decodeWorkbenchLayoutResponse[workbenchlayout.OpenPreviewResponse](t, createResp)
	if !created.Created || created.WidgetID == "" || created.WidgetState.State.Item == nil {
		t.Fatalf("created response = %#v, want created preview widget and state", created)
	}
	if created.RequestID != "request-preview-create" {
		t.Fatalf("request_id = %q, want request-preview-create", created.RequestID)
	}
	if len(created.Snapshot.Widgets) != 1 || len(created.Snapshot.WidgetStates) != 1 {
		t.Fatalf("snapshot = %#v, want widget and widget state", created.Snapshot)
	}
	if created.Snapshot.Widgets[0].WidgetID != created.Snapshot.WidgetStates[0].WidgetID {
		t.Fatalf("snapshot widget/state ids = %q/%q, want atomic preview shell", created.Snapshot.Widgets[0].WidgetID, created.Snapshot.WidgetStates[0].WidgetID)
	}

	reuseResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/actions/open_preview", `{
  "item": {
    "path": "/workspace/demo.txt",
    "name": "demo.txt"
  }
}`)
	if reuseResp.Code != http.StatusOK {
		t.Fatalf("reuse status = %d, body = %s", reuseResp.Code, reuseResp.Body.String())
	}
	reused := decodeWorkbenchLayoutResponse[workbenchlayout.OpenPreviewResponse](t, reuseResp)
	if reused.Created || reused.WidgetID != created.WidgetID {
		t.Fatalf("reuse response = %#v, want existing widget %q", reused, created.WidgetID)
	}

	forceResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/actions/open_preview", `{
  "item": {
    "path": "/workspace/demo.txt",
    "name": "demo.txt"
  },
  "open_strategy": "create_new"
}`)
	if forceResp.Code != http.StatusOK {
		t.Fatalf("force status = %d, body = %s", forceResp.Code, forceResp.Body.String())
	}
	forced := decodeWorkbenchLayoutResponse[workbenchlayout.OpenPreviewResponse](t, forceResp)
	if !forced.Created || forced.WidgetID == created.WidgetID || len(forced.Snapshot.Widgets) != 2 {
		t.Fatalf("force response = %#v, want second preview widget", forced)
	}
}

func TestGatewayWorkbenchOpenPreviewRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	resp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/actions/open_preview", `{
  "item": {
    "path": "relative.txt",
    "name": "relative.txt"
  }
}`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", resp.Code, resp.Body.String())
	}
}

func TestGatewayWorkbenchTerminalSessionAPIs(t *testing.T) {
	t.Parallel()

	svc := openGatewayWorkbenchLayoutService(t)
	gw := newWorkbenchLayoutGatewayWithTerminalForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	putLayoutResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/layout", sampleWorkbenchTerminalLayoutRequestJSON())
	if putLayoutResp.Code != http.StatusOK {
		t.Fatalf("layout put status = %d, body = %s", putLayoutResp.Code, putLayoutResp.Body.String())
	}

	createResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/widgets/widget-terminal-1/terminal/sessions", `{
  "name": "repo",
  "working_dir": ""
}`)
	if createResp.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", createResp.Code, createResp.Body.String())
	}
	createData := decodeWorkbenchLayoutResponse[struct {
		Session     terminal.SessionInfo        `json:"session"`
		WidgetState workbenchlayout.WidgetState `json:"widget_state"`
	}](t, createResp)
	if createData.Session.ID == "" {
		t.Fatalf("created session id is empty: %#v", createData.Session)
	}
	if createData.WidgetState.State.Kind != workbenchlayout.WidgetStateKindTerminal || len(createData.WidgetState.State.SessionIDs) != 1 {
		t.Fatalf("widget_state = %#v, want one terminal session", createData.WidgetState)
	}

	geometryBody, err := json.Marshal(map[string]any{
		"base_revision": createData.WidgetState.Revision,
		"widget_type":   workbenchlayout.WidgetTypeTerminal,
		"state": map[string]any{
			"kind":           workbenchlayout.WidgetStateKindTerminal,
			"session_ids":    createData.WidgetState.State.SessionIDs,
			"font_size":      14,
			"font_family_id": "jetbrains",
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(geometryBody) error = %v", err)
	}
	geometryResp := performWorkbenchLayoutRequest(t, gw, http.MethodPut, "/_redeven_proxy/api/workbench/widgets/widget-terminal-1/state", string(geometryBody))
	if geometryResp.Code != http.StatusOK {
		t.Fatalf("geometry put status = %d, body = %s", geometryResp.Code, geometryResp.Body.String())
	}
	geometryState := decodeWorkbenchLayoutResponse[workbenchlayout.WidgetState](t, geometryResp)
	if geometryState.State.FontSize == nil || *geometryState.State.FontSize != 14 || geometryState.State.FontFamilyID != "jetbrains" {
		t.Fatalf("geometry state = %#v, want font size 14 and jetbrains", geometryState.State)
	}

	createSecondResp := performWorkbenchLayoutRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/workbench/widgets/widget-terminal-1/terminal/sessions", `{
  "name": "server",
  "working_dir": ""
}`)
	if createSecondResp.Code != http.StatusOK {
		t.Fatalf("second create status = %d, body = %s", createSecondResp.Code, createSecondResp.Body.String())
	}
	createSecondData := decodeWorkbenchLayoutResponse[struct {
		Session     terminal.SessionInfo        `json:"session"`
		WidgetState workbenchlayout.WidgetState `json:"widget_state"`
	}](t, createSecondResp)
	if createSecondData.Session.ID == "" || createSecondData.Session.ID == createData.Session.ID {
		t.Fatalf("second created session is invalid: %#v", createSecondData.Session)
	}
	if got := createSecondData.WidgetState.State.SessionIDs; len(got) != 2 || got[0] != createData.Session.ID || got[1] != createSecondData.Session.ID {
		t.Fatalf("second widget sessions = %#v, want both terminal tabs", got)
	}
	if createSecondData.WidgetState.State.FontSize == nil || *createSecondData.WidgetState.State.FontSize != 14 || createSecondData.WidgetState.State.FontFamilyID != "jetbrains" {
		t.Fatalf("second widget geometry = %#v, want preserved terminal geometry", createSecondData.WidgetState.State)
	}

	deleteResp := performWorkbenchLayoutRequest(
		t,
		gw,
		http.MethodDelete,
		"/_redeven_proxy/api/workbench/widgets/widget-terminal-1/terminal/sessions/"+createData.Session.ID,
		"",
	)
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body = %s", deleteResp.Code, deleteResp.Body.String())
	}
	deletedState := decodeWorkbenchLayoutResponse[workbenchlayout.WidgetState](t, deleteResp)
	if deletedState.State.Kind != workbenchlayout.WidgetStateKindTerminal || len(deletedState.State.SessionIDs) != 1 || deletedState.State.SessionIDs[0] != createSecondData.Session.ID {
		t.Fatalf("deleted state = %#v, want only second terminal tab", deletedState)
	}
	if deletedState.State.FontSize == nil || *deletedState.State.FontSize != 14 || deletedState.State.FontFamilyID != "jetbrains" {
		t.Fatalf("deleted geometry = %#v, want preserved terminal geometry", deletedState.State)
	}

	deleteLastResp := performWorkbenchLayoutRequest(
		t,
		gw,
		http.MethodDelete,
		"/_redeven_proxy/api/workbench/widgets/widget-terminal-1/terminal/sessions/"+createSecondData.Session.ID,
		"",
	)
	if deleteLastResp.Code != http.StatusOK {
		t.Fatalf("delete last status = %d, body = %s", deleteLastResp.Code, deleteLastResp.Body.String())
	}
	deletedLastState := decodeWorkbenchLayoutResponse[workbenchlayout.WidgetState](t, deleteLastResp)
	if deletedLastState.State.Kind != workbenchlayout.WidgetStateKindTerminal || len(deletedLastState.State.SessionIDs) != 0 {
		t.Fatalf("deleted last state = %#v, want empty terminal state", deletedLastState)
	}
	if deletedLastState.State.FontSize == nil || *deletedLastState.State.FontSize != 14 || deletedLastState.State.FontFamilyID != "jetbrains" {
		t.Fatalf("deleted last geometry = %#v, want preserved terminal geometry", deletedLastState.State)
	}
}
