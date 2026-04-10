package runtimeproxy

import (
	"github.com/floegence/flowersec/flowersec-go/endpoint/serve"
	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	fsproxy "github.com/floegence/flowersec/flowersec-go/proxy"
	fsproxypreset "github.com/floegence/flowersec/flowersec-go/proxy/preset"
)

const (
	PresetID        = "redeven-runtime"
	MaxWSFrameBytes = 32 * 1024 * 1024
)

// Manifest returns the stable Redeven-owned proxy preset manifest used for runtime flows.
func Manifest() *fsproxypreset.Manifest {
	maxJSON := jsonframe.DefaultMaxJSONFrameBytes
	maxChunk := fsproxy.DefaultMaxChunkBytes
	maxBody := int64(fsproxy.DefaultMaxBodyBytes)
	maxWS := MaxWSFrameBytes

	return &fsproxypreset.Manifest{
		V:        1,
		PresetID: PresetID,
		Limits: fsproxypreset.Limits{
			MaxJSONFrameBytes: &maxJSON,
			MaxChunkBytes:     &maxChunk,
			MaxBodyBytes:      &maxBody,
			MaxWSFrameBytes:   &maxWS,
		},
	}
}

// ApplyOptions applies the Redeven runtime preset manifest to proxy options.
func ApplyOptions(opts fsproxy.Options) fsproxy.Options {
	bridge := fsproxy.BridgeOptions{
		MaxJSONFrameBytes:           opts.MaxJSONFrameBytes,
		MaxChunkBytes:               opts.MaxChunkBytes,
		MaxBodyBytes:                opts.MaxBodyBytes,
		MaxWSFrameBytes:             opts.MaxWSFrameBytes,
		DefaultHTTPRequestTimeoutMS: opts.DefaultHTTPRequestTimeoutMS,
		ExtraRequestHeaders:         append([]string(nil), opts.ExtraRequestHeaders...),
		ExtraResponseHeaders:        append([]string(nil), opts.ExtraResponseHeaders...),
		ExtraWSHeaders:              append([]string(nil), opts.ExtraWSHeaders...),
		ForbiddenCookieNames:        append([]string(nil), opts.ForbiddenCookieNames...),
		ForbiddenCookieNamePrefixes: append([]string(nil), opts.ForbiddenCookieNamePrefixes...),
	}
	bridge = fsproxypreset.ApplyBridgeOptions(bridge, Manifest())
	opts.ContractOptions = fsproxy.ContractOptions(bridge)
	return opts
}

// Register wires the runtime proxy handlers with the Redeven runtime preset applied.
func Register(srv *serve.Server, opts fsproxy.Options) error {
	return fsproxy.Register(srv, ApplyOptions(opts))
}
