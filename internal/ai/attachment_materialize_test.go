package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/floegence/redeven/internal/session"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentMaterializeIndependentCopiesAndFailureCleanup(t *testing.T) {
	space, err := prepareTaskFiles(t.TempDir(), "thread_materialize")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("original attachment\n")
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	write := func(ctx context.Context, data []byte, name, hash string, size int64) (map[string]any, error) {
		return materializeAttachment(ctx, space, bytes.NewReader(data), name, "text/plain", size, hash)
	}
	first, err := write(t.Context(), body, "notes.txt", digest, int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	firstPath := first["file_path"].(string)
	if !taskPathWithin(firstPath, space.Scratch) {
		t.Fatal("copy escaped scratch")
	}
	if err := os.WriteFile(firstPath, []byte("user edit"), 0600); err != nil {
		t.Fatal(err)
	}
	second, err := write(t.Context(), body, "notes.txt", digest, int64(len(body)))
	if err != nil || second["file_path"] == firstPath {
		t.Fatalf("overwritten copy: %v %v", second, err)
	}
	if b, _ := os.ReadFile(firstPath); string(b) != "user edit" {
		t.Fatal("edited copy overwritten")
	}
	if b, _ := os.ReadFile(second["file_path"].(string)); !bytes.Equal(b, body) {
		t.Fatal("incorrect bytes")
	}
	for _, name := range []string{"../escape", "x/y", "x\\y", "bad\nname"} {
		if _, err := write(t.Context(), body, name, digest, int64(len(body))); err == nil {
			t.Fatalf("accepted unsafe name %q", name)
		}
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	for _, test := range []struct {
		ctx  context.Context
		data []byte
		hash string
		size int64
	}{
		{t.Context(), body, strings.Repeat("0", 64), int64(len(body))},
		{t.Context(), body, digest, int64(len(body)) - 1},
		{t.Context(), body, digest, int64(len(body)) + 1},
		{canceled, body, digest, int64(len(body))},
	} {
		if _, err := write(test.ctx, test.data, "bad.txt", test.hash, test.size); err == nil {
			t.Fatal("invalid copy accepted")
		}
	}
	entries, err := os.ReadDir(space.Scratch)
	if err != nil || len(entries) != 2 {
		t.Fatalf("failed copy leaked: %d %v", len(entries), err)
	}
	for _, entry := range entries {
		if _, err := os.Stat(filepath.Join(space.Scratch, entry.Name(), ".partial")); !os.IsNotExist(err) {
			t.Fatal("partial remains")
		}
	}
}

type measuredAttachmentReader struct {
	remaining int
	maxRead   int
}

func (r *measuredAttachmentReader) Read(p []byte) (int, error) {
	if len(p) > r.maxRead {
		r.maxRead = len(p)
	}
	if r.remaining == 0 {
		return 0, os.ErrClosed
	}
	n := min(len(p), r.remaining)
	clear(p[:n])
	r.remaining -= n
	return n, nil
}
func TestAttachmentMaterializeBoundsReads(t *testing.T) {
	space, err := prepareTaskFiles(t.TempDir(), "thread_bounded")
	if err != nil {
		t.Fatal(err)
	}
	reader := &measuredAttachmentReader{remaining: 4 << 20}
	_, _ = materializeAttachment(t.Context(), space, reader, "data.bin", "application/octet-stream", 4<<20, strings.Repeat("0", 64))
	if reader.maxRead > 32<<10 {
		t.Fatalf("unbounded read: %d", reader.maxRead)
	}
}

func TestAttachmentMaterializeCanonicalBinaryAndScope(t *testing.T) {
	body := []byte{0, 255, 128, 1, 2}
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	path := filepath.Join(t.TempDir(), "original.bin")
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	const id = "upl_bbbbbbbbbbbbbbbbbbbbbbbb"
	info := &UploadResponse{AttachmentID: id, Name: "input.bin", DetectedMediaType: "application/octet-stream", SizeBytes: int64(len(body)), ContentSHA256: digest}
	r := &run{id: "run", threadID: "thread", endpointID: "endpoint", userPublicID: "user", channelID: "channel", stateDir: t.TempDir()}
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, "turn", true)
	calls := 0
	r.host.openLiveAttachment = func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error) {
		calls++
		return openedCanonicalAttachment{Membership: CanonicalAttachmentMembership{ThreadID: r.threadID, TurnID: "turn", AttachmentID: id, ContentSHA256: digest, Name: info.Name, DetectedMediaType: info.DetectedMediaType, SizeBytes: info.SizeBytes}, Upload: &OpenUploadResult{Info: info, FilePath: path}}, nil
	}
	meta := &session.Meta{EndpointID: r.endpointID, UserPublicID: r.userPublicID, ChannelID: r.channelID, CanRead: true, CanWrite: true, CanExecute: true}
	locator := logicalAttachmentLocator(id, info.Name)
	result, err := r.toolAttachmentMaterialize(t.Context(), meta, locator)
	if err != nil {
		t.Fatal(err)
	}
	if result["file_path"] == path {
		t.Fatal("exposed original path")
	}
	if err := os.WriteFile(result["file_path"].(string), []byte("edited"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, body) {
		t.Fatal("original changed")
	}
	for _, field := range []string{"user", "endpoint", "channel", "permission"} {
		foreign := *meta
		switch field {
		case "user":
			foreign.UserPublicID = "foreign"
		case "endpoint":
			foreign.EndpointID = "foreign"
		case "channel":
			foreign.ChannelID = "foreign"
		case "permission":
			foreign.CanWrite = false
		}
		before := calls
		if _, err := r.toolAttachmentMaterialize(t.Context(), &foreign, locator); err == nil {
			t.Fatalf("accepted %s", field)
		}
		if calls != before {
			t.Fatal("opened bytes before scope validation")
		}
	}
	if _, err := r.toolAttachmentMaterialize(t.Context(), meta, logicalAttachmentLocator(id, "other.bin")); err == nil {
		t.Fatal("accepted altered display name")
	}
}

func BenchmarkAttachmentMaterialize(b *testing.B) {
	space, err := prepareTaskFiles(b.TempDir(), "thread_benchmark")
	if err != nil {
		b.Fatal(err)
	}
	body := bytes.Repeat([]byte{0, 1, 128, 255}, 2<<20)
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		result, err := materializeAttachment(b.Context(), space, bytes.NewReader(body), "input.bin", "application/octet-stream", int64(len(body)), digest)
		if err != nil {
			b.Fatal(err)
		}
		if err := os.RemoveAll(filepath.Dir(result["file_path"].(string))); err != nil {
			b.Fatal(err)
		}
	}
}
