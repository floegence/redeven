package automation

import (
	"encoding/json"
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
)

func validateJSONSchema(raw, data json.RawMessage) error {
	var schema jsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return fmt.Errorf("%w: output schema", ErrInvalid)
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return fmt.Errorf("%w: output schema: %v", ErrInvalid, err)
	}
	var value any
	if err = json.Unmarshal(data, &value); err != nil {
		return ErrInvalid
	}
	if err = resolved.Validate(value); err != nil {
		return fmt.Errorf("%w: result: %v", ErrInvalid, err)
	}
	return nil
}

func validateSchema(raw json.RawMessage) error {
	var schema jsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return ErrInvalid
	}
	_, err := schema.Resolve(nil)
	return err
}
