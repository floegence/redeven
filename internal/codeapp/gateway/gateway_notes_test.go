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
	"github.com/floegence/redeven/internal/notes"
)

func openGatewayNotesService(t *testing.T) *notes.Service {
	t.Helper()

	svc, err := notes.Open(filepath.Join(t.TempDir(), "notes.db"))
	if err != nil {
		t.Fatalf("notes.Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	return svc
}

func newNotesGatewayForTest(t *testing.T, svc *notes.Service, cap config.PermissionSet) *Gateway {
	t.Helper()
	return &Gateway{
		notes:              svc,
		localPermissionCap: &cap,
	}
}

func performNotesRequest(t *testing.T, gw *Gateway, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := WithLocalUIEnvRoute(httptest.NewRequest(method, path, bytes.NewBufferString(body)))
	if strings.TrimSpace(body) != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	gw.handleAPI(rr, req)
	return rr
}

func decodeNotesResponse[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
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

func hasTopic(topics []notes.Topic, predicate func(notes.Topic) bool) bool {
	for _, topic := range topics {
		if predicate(topic) {
			return true
		}
	}
	return false
}

func hasItem(items []notes.Item, predicate func(notes.Item) bool) bool {
	for _, item := range items {
		if predicate(item) {
			return true
		}
	}
	return false
}

func readNotesSSEEvent(t *testing.T, reader *bufio.Reader) notes.Event {
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
	var event notes.Event
	if err := json.Unmarshal([]byte(strings.Join(dataLines, "\n")), &event); err != nil {
		t.Fatalf("json.Unmarshal(sse data) error = %v", err)
	}
	return event
}

func TestGatewayNotesCRUDFlow(t *testing.T) {
	t.Parallel()

	svc := openGatewayNotesService(t)
	gw := newNotesGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	type topicEnvelope struct {
		Topic notes.Topic `json:"topic"`
	}
	type itemEnvelope struct {
		Item notes.Item `json:"item"`
	}

	createTopicResp := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/topics", `{"name":"Research"}`)
	if createTopicResp.Code != http.StatusOK {
		t.Fatalf("create topic status = %d, body = %s", createTopicResp.Code, createTopicResp.Body.String())
	}
	createdTopic := decodeNotesResponse[topicEnvelope](t, createTopicResp).Topic

	renameResp := performNotesRequest(t, gw, http.MethodPatch, "/_redeven_proxy/api/notes/topics/"+createdTopic.TopicID, `{"name":"Research Alpha"}`)
	if renameResp.Code != http.StatusOK {
		t.Fatalf("rename topic status = %d, body = %s", renameResp.Code, renameResp.Body.String())
	}

	createItemResp := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/items", `{"topic_id":"`+createdTopic.TopicID+`","body":"gateway body","color_token":"sage","x":320,"y":240}`)
	if createItemResp.Code != http.StatusOK {
		t.Fatalf("create item status = %d, body = %s", createItemResp.Code, createItemResp.Body.String())
	}
	createdItem := decodeNotesResponse[itemEnvelope](t, createItemResp).Item

	snapshotResp := performNotesRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/notes/snapshot", "")
	if snapshotResp.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %s", snapshotResp.Code, snapshotResp.Body.String())
	}
	snapshot := decodeNotesResponse[notes.Snapshot](t, snapshotResp)
	if !hasTopic(snapshot.Topics, func(topic notes.Topic) bool {
		return topic.TopicID == createdTopic.TopicID && topic.Name == "Research Alpha"
	}) {
		t.Fatalf("snapshot topics = %#v, want renamed topic", snapshot.Topics)
	}
	if !hasItem(snapshot.Items, func(item notes.Item) bool {
		return item.NoteID == createdItem.NoteID
	}) {
		t.Fatalf("snapshot items = %#v, want created item", snapshot.Items)
	}

	deleteResp := performNotesRequest(t, gw, http.MethodDelete, "/_redeven_proxy/api/notes/items/"+createdItem.NoteID, "")
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("delete item status = %d, body = %s", deleteResp.Code, deleteResp.Body.String())
	}

	restoreResp := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/items/"+createdItem.NoteID+"/restore", "")
	if restoreResp.Code != http.StatusOK {
		t.Fatalf("restore item status = %d, body = %s", restoreResp.Code, restoreResp.Body.String())
	}
	restoredItem := decodeNotesResponse[itemEnvelope](t, restoreResp).Item
	if restoredItem.X != createdItem.X || restoredItem.Y != createdItem.Y {
		t.Fatalf("restored coordinates = (%v, %v), want (%v, %v)", restoredItem.X, restoredItem.Y, createdItem.X, createdItem.Y)
	}
}

func TestGatewayNotesDeleteTrashedItemPermanently(t *testing.T) {
	t.Parallel()

	svc := openGatewayNotesService(t)
	gw := newNotesGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	type topicEnvelope struct {
		Topic notes.Topic `json:"topic"`
	}

	createTopicResp := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/topics", `{"name":"Archive"}`)
	if createTopicResp.Code != http.StatusOK {
		t.Fatalf("create topic status = %d, body = %s", createTopicResp.Code, createTopicResp.Body.String())
	}
	createdTopic := decodeNotesResponse[topicEnvelope](t, createTopicResp).Topic

	createItemResp := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/items", `{"topic_id":"`+createdTopic.TopicID+`","body":"trash me","x":12,"y":18}`)
	if createItemResp.Code != http.StatusOK {
		t.Fatalf("create item status = %d, body = %s", createItemResp.Code, createItemResp.Body.String())
	}
	createdItem := decodeNotesResponse[struct {
		Item notes.Item `json:"item"`
	}](t, createItemResp).Item

	deleteResp := performNotesRequest(t, gw, http.MethodDelete, "/_redeven_proxy/api/notes/items/"+createdItem.NoteID, "")
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("delete item status = %d, body = %s", deleteResp.Code, deleteResp.Body.String())
	}

	deleteTrashResp := performNotesRequest(t, gw, http.MethodDelete, "/_redeven_proxy/api/notes/trash/items/"+createdItem.NoteID, "")
	if deleteTrashResp.Code != http.StatusOK {
		t.Fatalf("delete trashed item status = %d, body = %s", deleteTrashResp.Code, deleteTrashResp.Body.String())
	}

	snapshotResp := performNotesRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/notes/snapshot", "")
	if snapshotResp.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %s", snapshotResp.Code, snapshotResp.Body.String())
	}
	snapshot := decodeNotesResponse[notes.Snapshot](t, snapshotResp)
	if len(snapshot.TrashItems) != 0 {
		t.Fatalf("snapshot trash = %#v, want empty", snapshot.TrashItems)
	}
}

func TestGatewayNotesFreshSnapshotIncludesWelcomeSeed(t *testing.T) {
	t.Parallel()

	svc := openGatewayNotesService(t)
	gw := newNotesGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})

	snapshotResp := performNotesRequest(t, gw, http.MethodGet, "/_redeven_proxy/api/notes/snapshot", "")
	if snapshotResp.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %s", snapshotResp.Code, snapshotResp.Body.String())
	}

	snapshot := decodeNotesResponse[notes.Snapshot](t, snapshotResp)
	if !hasTopic(snapshot.Topics, func(topic notes.Topic) bool { return topic.Name == "Welcome" }) {
		t.Fatalf("snapshot topics = %#v, want Welcome seed", snapshot.Topics)
	}
	if !hasItem(snapshot.Items, func(item notes.Item) bool { return strings.Contains(item.Body, "Welcome to Notes.") }) {
		t.Fatalf("snapshot items = %#v, want welcome note", snapshot.Items)
	}
}

func TestGatewayNotesWriteRequiresPermission(t *testing.T) {
	t.Parallel()

	svc := openGatewayNotesService(t)
	gw := newNotesGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: false, Execute: true})

	rr := performNotesRequest(t, gw, http.MethodPost, "/_redeven_proxy/api/notes/topics", `{"name":"Blocked"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body = %s", rr.Code, rr.Body.String())
	}
}

func TestGatewayNotesEventStreamBaselineAndIncremental(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	svc := openGatewayNotesService(t)
	topic, err := svc.CreateTopic(ctx, notes.CreateTopicRequest{Name: "Realtime"})
	if err != nil {
		t.Fatalf("CreateTopic() error = %v", err)
	}

	gw := newNotesGatewayForTest(t, svc, config.PermissionSet{Read: true, Write: true, Execute: true})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gw.handleAPI(w, WithLocalUIEnvRoute(r))
	}))
	defer server.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/_redeven_proxy/api/notes/events?after_seq=0", nil)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}

	reader := bufio.NewReader(resp.Body)
	baselineWelcomeTopic := readNotesSSEEvent(t, reader)
	baselineWelcomeItem := readNotesSSEEvent(t, reader)
	baselineRealtimeTopic := readNotesSSEEvent(t, reader)
	if baselineWelcomeTopic.Type != "topic.created" {
		t.Fatalf("welcome baseline type = %q, want topic.created", baselineWelcomeTopic.Type)
	}
	if baselineWelcomeItem.Type != "item.created" {
		t.Fatalf("welcome item baseline type = %q, want item.created", baselineWelcomeItem.Type)
	}
	if baselineRealtimeTopic.Type != "topic.created" {
		t.Fatalf("realtime baseline type = %q, want topic.created", baselineRealtimeTopic.Type)
	}
	if baselineRealtimeTopic.EntityID != topic.TopicID {
		t.Fatalf("realtime baseline entity = %q, want %q", baselineRealtimeTopic.EntityID, topic.TopicID)
	}

	if _, err := svc.CreateItem(ctx, notes.CreateItemRequest{
		TopicID: topic.TopicID,
		Body:    "incremental",
		X:       18,
		Y:       24,
	}); err != nil {
		t.Fatalf("CreateItem() error = %v", err)
	}

	incremental := readNotesSSEEvent(t, reader)
	if incremental.Type != "item.created" {
		t.Fatalf("incremental type = %q, want item.created", incremental.Type)
	}
}
