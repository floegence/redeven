package containerengine

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
)

type resourceArchiveFixture struct {
	name     string
	typeflag byte
	linkname string
	data     []byte
}

func buildResourceArchive(t *testing.T, fixtures ...resourceArchiveFixture) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for _, fixture := range fixtures {
		size := int64(len(fixture.data))
		if fixture.typeflag == tar.TypeDir || fixture.typeflag == tar.TypeSymlink || fixture.typeflag == tar.TypeLink {
			size = 0
		}
		if err := writer.WriteHeader(&tar.Header{Name: fixture.name, Typeflag: fixture.typeflag, Linkname: fixture.linkname, Mode: 0o644, Size: size}); err != nil {
			t.Fatal(err)
		}
		if size > 0 {
			if _, err := writer.Write(fixture.data); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestValidateResourceFilePathRejectsTraversal(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"relative", "/safe/../secret", "/../secret", "/safe\nsecret"} {
		if _, err := validateResourceFilePath(value); err == nil {
			t.Fatalf("validateResourceFilePath(%q) succeeded", value)
		}
	}
	if got, err := validateResourceFilePath("/safe//child"); err != nil || got != "/safe/child" {
		t.Fatalf("validateResourceFilePath() = %q, %v", got, err)
	}
}

func TestResourceArchiveRejectsEscapingPathsAndLinks(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		fixture resourceArchiveFixture
	}{
		{name: "absolute", fixture: resourceArchiveFixture{name: "/etc/shadow", typeflag: tar.TypeReg, data: []byte("secret")}},
		{name: "parent", fixture: resourceArchiveFixture{name: "../shadow", typeflag: tar.TypeReg, data: []byte("secret")}},
		{name: "escaping symlink", fixture: resourceArchiveFixture{name: "safe/link", typeflag: tar.TypeSymlink, linkname: "../../shadow"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := safeArchiveEntries(buildResourceArchive(t, tt.fixture)); err == nil {
				t.Fatal("safeArchiveEntries() succeeded")
			}
		})
	}
}

func TestResourceArchiveListingIsFlatSortedAndBounded(t *testing.T) {
	t.Parallel()
	raw := buildResourceArchive(t,
		resourceArchiveFixture{name: "root/", typeflag: tar.TypeDir},
		resourceArchiveFixture{name: "root/z.txt", typeflag: tar.TypeReg, data: []byte("z")},
		resourceArchiveFixture{name: "root/a/", typeflag: tar.TypeDir},
		resourceArchiveFixture{name: "root/a/child.txt", typeflag: tar.TypeReg, data: []byte("child")},
	)
	listing, err := parseResourceArchiveListing(raw, "/root")
	if err != nil {
		t.Fatal(err)
	}
	want := []ResourceFileEntry{{Name: "a", Path: "/root/a", Kind: "directory", Mode: "drw-r--r--"}, {Name: "z.txt", Path: "/root/z.txt", Kind: "file", SizeBytes: 1, Mode: "-rw-r--r--"}}
	for index := range want {
		want[index].ModifiedAtUnixMs = listing.Entries[index].ModifiedAtUnixMs
	}
	if !reflect.DeepEqual(listing.Entries, want) || listing.Truncated {
		t.Fatalf("listing = %#v", listing)
	}
}

func TestResourceArchiveContentSelectsRequestedFile(t *testing.T) {
	t.Parallel()
	raw := buildResourceArchive(t,
		resourceArchiveFixture{name: "unrelated.txt", typeflag: tar.TypeReg, data: []byte("wrong")},
		resourceArchiveFixture{name: "folder/wanted.txt", typeflag: tar.TypeReg, data: []byte("right")},
	)
	content, err := parseResourceArchiveContent(raw, "/folder/wanted.txt")
	if err != nil {
		t.Fatal(err)
	}
	if content.Name != "wanted.txt" || string(content.Data) != "right" || content.MediaType != "text/plain; charset=utf-8" {
		t.Fatalf("content = %+v", content)
	}
	if _, err := parseResourceArchiveContent(raw, "/folder/missing.txt"); err == nil {
		t.Fatal("missing content succeeded")
	}
}

func TestResourceArchiveContentEnforcesByteLimit(t *testing.T) {
	t.Parallel()
	raw := buildResourceArchive(t, resourceArchiveFixture{name: "large.bin", typeflag: tar.TypeReg, data: bytes.Repeat([]byte{'x'}, maxResourceFileBytes+1)})
	_, err := parseResourceArchiveContent(raw, "/large.bin")
	if !errors.Is(err, ErrResourceFileLimit) {
		t.Fatalf("error = %v, want ErrResourceFileLimit", err)
	}
}

func TestStreamingArchiveValidatesEntriesAfterRequestedFile(t *testing.T) {
	t.Parallel()
	raw := buildResourceArchive(t,
		resourceArchiveFixture{name: "wanted.txt", typeflag: tar.TypeReg, data: []byte("safe")},
		resourceArchiveFixture{name: "unsafe", typeflag: tar.TypeSymlink, linkname: "../secret"},
	)
	if _, err := parseResourceArchiveExactContent(bytes.NewReader(raw), "/wanted.txt"); err == nil {
		t.Fatal("streaming content accepted an escaping link after the requested file")
	}
}

type resourceOutputStreamRunner struct {
	raw       []byte
	calls     []string
	runCalled bool
}

func (r *resourceOutputStreamRunner) Run(context.Context, string, ...string) ([]byte, error) {
	r.runCalled = true
	return nil, errors.New("buffered command path must not be used")
}

func (r *resourceOutputStreamRunner) StreamOutput(_ context.Context, name string, args []string, consume func(io.Reader) error) error {
	r.calls = append(r.calls, strings.Join(append([]string{name}, args...), " "))
	return consume(bytes.NewReader(r.raw))
}

func TestPodmanVolumeFilesUseStreamingArchive(t *testing.T) {
	t.Parallel()
	runner := &resourceOutputStreamRunner{raw: buildResourceArchive(t,
		resourceArchiveFixture{name: "cache/", typeflag: tar.TypeDir},
		resourceArchiveFixture{name: "cache/index.json", typeflag: tar.TypeReg, data: []byte("{}")},
	)}
	adapter, err := NewAdapter(&CLIClient{Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	listing, err := adapter.ListVolumeFiles(context.Background(), VolumeFileRequest{Engine: EnginePodman, Name: "cache", Path: "/"})
	if err != nil {
		t.Fatal(err)
	}
	if runner.runCalled || !reflect.DeepEqual(runner.calls, []string{"podman volume export cache"}) {
		t.Fatalf("runner = %+v, runCalled = %v", runner.calls, runner.runCalled)
	}
	if len(listing.Entries) != 1 || listing.Entries[0].Name != "cache" || listing.Entries[0].Kind != "directory" {
		t.Fatalf("listing = %+v", listing)
	}
}

func TestCLIClientStatsManyUsesOneCollectionCommand(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker stats --no-stream --format json": strings.Join([]string{
			`{"ID":"one","CPUPerc":"1.5%","MemUsage":"10MiB / 1GiB","NetIO":"1kB / 2kB"}`,
			`{"ID":"two","CPUPerc":"2%","MemUsage":"20MiB / 2GiB","NetIO":"3kB / 4kB"}`,
		}, "\n"),
	}}
	client := &CLIClient{Runner: runner}
	samples, err := client.StatsMany(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 2 || samples[0].ContainerID != "one" || samples[1].ContainerID != "two" {
		t.Fatalf("samples = %+v", samples)
	}
	if len(runner.calls) != 1 || runner.calls[0] != "docker stats --no-stream --format json" {
		t.Fatalf("calls = %#v", runner.calls)
	}
}
