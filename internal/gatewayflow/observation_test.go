package gatewayflow

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestObservationsExcludeErrorPayloads(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	secret := "credential-must-not-appear"
	Observe(t.Context(), "cloud.recover", time.Now().Add(-time.Second), errors.New(secret))
	if strings.Contains(output.String(), secret) {
		t.Fatal("error payload leaked")
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["operation"] != "cloud.recover" || record["outcome"] != "failed" || record["duration_ms"].(float64) < 1000 {
		t.Fatal(record)
	}
	output.Reset()
	Observe(t.Context(), "access.open", time.Now(), errors.Join(context.Canceled, errors.New(secret)))
	if strings.Contains(output.String(), secret) || !strings.Contains(output.String(), `"outcome":"canceled"`) {
		t.Fatal("cancellation was not safely classified")
	}
}
