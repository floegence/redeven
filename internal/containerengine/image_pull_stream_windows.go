//go:build windows

package containerengine

import (
	"context"
	"io"
)

func (execRunner) StreamImagePull(ctx context.Context, name string, args []string, sink func([]byte) error) error {
	return streamCommandOutput(ctx, name, args, func(reader io.Reader) error {
		return readImagePullLines(reader, sink)
	}, true)
}
