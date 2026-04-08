package ai

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestNDJSONStreamCloseBeforeWriterLoopStartsStillCompletes(t *testing.T) {
	t.Parallel()

	for range 128 {
		stream := newNDJSONStream(httptest.NewRecorder(), 0)
		stream.close()

		done := make(chan struct{})
		go func() {
			stream.wait()
			close(done)
		}()

		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("stream.wait() blocked after immediate close")
		}
	}
}
