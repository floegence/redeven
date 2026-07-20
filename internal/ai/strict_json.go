package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

func decodeStrictJSON(raw string, out any) error {
	if strings.TrimSpace(raw) == "" {
		return errors.New("empty JSON payload")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return nil
}
