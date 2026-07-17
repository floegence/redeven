package ai

import (
	"encoding/json"
	"io"
	"net/http"
)

func writeOpenAISSEJSON(w io.Writer, f http.Flusher, payload any) {
	b, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}
