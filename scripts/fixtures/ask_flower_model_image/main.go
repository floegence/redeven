package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/floegence/floret/v7/provider"
)

// Qualification reads the published public image contract without host internals.
func main() {
	if len(os.Args) != 2 {
		panic("expected original screenshot path")
	}
	body, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	prepared, err := provider.PrepareModelImage(context.Background(), body, provider.ModelImageOptions{JPEGQuality: 85, MaxDimension: 2560, MaxSourceBytes: 32 << 20, MaxPixels: 32 << 20})
	if err != nil {
		panic(err)
	}
	out, err := json.Marshal(map[string]any{"sha256": prepared.SHA256, "sourceSHA256": prepared.SourceSHA256, "mimeType": prepared.MIMEType, "width": prepared.Width, "height": prepared.Height})
	if err != nil {
		panic(err)
	}
	fmt.Println(string(out))
}
