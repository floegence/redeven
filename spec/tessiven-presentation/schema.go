// Package tessivenpresentation embeds the frozen, data-only display schema.
package tessivenpresentation

import _ "embed"

//go:embed v1.schema.json
var Schema []byte
