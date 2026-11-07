package redevpluginintegration

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/floegence/redevplugin/v3/pkg/authoring"
	"github.com/floegence/redevplugin/v3/pkg/manifest"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
)

const generatedPluginIconSource = "ui/assets/plugin-icon.svg"
const generatedPluginIconRaster = "ui/assets/plugin-icon.png"

// Product qualification only, not an SVG admission parser or sanitizer. The
// platform validates package and raster evidence; the host never renders SVG.
func checkGeneratedPluginIcon(source []byte, pkg pluginpkg.Package) (pluginpkg.PresentationIconAsset, error) {
	fail := func(message string) (pluginpkg.PresentationIconAsset, error) {
		return pluginpkg.PresentationIconAsset{}, fmt.Errorf("generated icon: %s", message)
	}
	if len(source) == 0 || len(source) > 512<<10 {
		return fail("missing or oversized SVG source")
	}
	if !bytes.Equal(source, pkg.Files[generatedPluginIconSource]) {
		return fail("packaged SVG must match the editable source")
	}
	decoder := xml.NewDecoder(bytes.NewReader(source))
	depth, roots, shapes := 0, 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fail("invalid SVG XML")
		}
		switch element := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || element.Name.Space != "http://www.w3.org/2000/svg" || element.Name.Local != "svg" {
					return fail("expected one SVG document")
				}
				var viewBox []string
				for _, attr := range element.Attr {
					if attr.Name.Local == "viewBox" {
						viewBox = strings.Fields(strings.ReplaceAll(attr.Value, ",", " "))
					}
				}
				if len(viewBox) != 4 {
					return fail("a square viewBox is required")
				}
				var values [4]float64
				for index, value := range viewBox {
					number, err := strconv.ParseFloat(value, 64)
					if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
						return fail("invalid viewBox coordinate")
					}
					values[index] = number
				}
				if values[2] <= 0 || values[2] != values[3] {
					return fail("a positive square viewBox is required")
				}
			}
			depth++
			for _, attr := range element.Attr {
				name := strings.ToLower(attr.Name.Local)
				if strings.HasPrefix(name, "on") || name == "style" || (name == "href" && !strings.HasPrefix(attr.Value, "#")) {
					return fail("use explicit geometry without handlers or external resources")
				}
			}
			switch element.Name.Local {
			case "script", "foreignObject", "image", "text", "style":
				return fail("use self-contained vector geometry")
			case "path", "circle", "ellipse", "rect", "line", "polyline", "polygon":
				if element.Name.Space == "http://www.w3.org/2000/svg" {
					shapes++
				}
			}
		case xml.EndElement:
			depth--
		case xml.Directive:
			return fail("XML directives are not icon geometry")
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(element)) != "" {
				return fail("unexpected content outside SVG")
			}
		}
	}
	if roots != 1 || depth != 0 || shapes == 0 {
		return fail("SVG must contain vector geometry")
	}
	icon, _, err := pluginpkg.ReadPresentationIcon(pkg)
	if err != nil {
		return icon, err
	}
	if icon.Path != generatedPluginIconRaster || icon.MediaType != "image/png" || icon.Width != 256 || icon.Height != 256 {
		return fail("presentation must reference the generated 256x256 PNG")
	}
	return icon, nil
}

func TestGeneratedPluginIconQualification(t *testing.T) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#2864dc"/></svg>`
	for _, tc := range []struct {
		name string
		edit func(*[]byte, *pluginpkg.Package)
	}{
		{name: "complete"},
		{name: "missing source", edit: func(source *[]byte, _ *pluginpkg.Package) { *source = nil }},
		{name: "missing packaged SVG", edit: func(_ *[]byte, pkg *pluginpkg.Package) { delete(pkg.Files, generatedPluginIconSource) }},
		{name: "stale packaged SVG", edit: func(_ *[]byte, pkg *pluginpkg.Package) {
			pkg.Files[generatedPluginIconSource] = []byte(strings.ReplaceAll(svg, "#2864dc", "#000000"))
		}},
		{name: "missing manifest icon", edit: func(_ *[]byte, pkg *pluginpkg.Package) { pkg.Manifest.Presentation.Icon = nil }},
		{name: "missing PNG", edit: func(_ *[]byte, pkg *pluginpkg.Package) { delete(pkg.Files, generatedPluginIconRaster) }},
		{name: "SVG disguised as PNG", edit: func(_ *[]byte, pkg *pluginpkg.Package) { pkg.Files[generatedPluginIconRaster] = []byte(svg) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := []byte(svg)
			pkg := generatedIconQualificationFixture(t, source)
			if tc.edit != nil {
				tc.edit(&source, &pkg)
			}
			_, err := checkGeneratedPluginIcon(source, pkg)
			if (err == nil) != (tc.name == "complete") {
				t.Fatalf("acceptance result: %v", err)
			}
		})
	}
	for name, source := range map[string]string{
		"empty":              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>`,
		"malformed":          strings.TrimSuffix(svg, "</svg>"),
		"non square":         strings.ReplaceAll(svg, "0 0 24 24", "0 0 24 32"),
		"invalid viewBox":    strings.ReplaceAll(svg, "0 0 24 24", "0 0 NaN NaN"),
		"script":             strings.ReplaceAll(svg, "</svg>", "<script>alert(1)</script></svg>"),
		"raster wrapper":     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="icon.png"/></svg>`,
		"two documents":      svg + svg,
		"event handler":      strings.ReplaceAll(svg, "<circle", `<circle onload="alert(1)"`),
		"external reference": strings.ReplaceAll(svg, "</svg>", `<use href="https://example.com/icon.svg#shape"/></svg>`),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := checkGeneratedPluginIcon([]byte(source), generatedIconQualificationFixture(t, []byte(source))); err == nil {
				t.Fatal("invalid vector deliverable accepted")
			}
		})
	}
}

func TestGeneratedPluginIconPublishedPackageRoundTrip(t *testing.T) {
	root := filepath.Join(t.TempDir(), "icon-plugin")
	if _, err := authoring.Init("icon-qualification", "Icon qualification", root, "web"); err != nil {
		t.Fatal(err)
	}
	source := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#2864dc"/></svg>`)
	fixture := generatedIconQualificationFixture(t, source)
	output := filepath.Join(root, "dist")
	for name, content := range fixture.Files {
		if err := os.WriteFile(filepath.Join(output, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(filepath.Join(output, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document["presentation"].(map[string]any)["icon"] = map[string]any{"path": generatedPluginIconRaster}
	raw, err = json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(output, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if _, err := pluginpkg.BuildFromDir(t.Context(), output, &archive, pluginpkg.DefaultReadLimits()); err != nil {
		t.Fatal(err)
	}
	pkg, err := pluginpkg.Read(t.Context(), bytes.NewReader(archive.Bytes()), int64(archive.Len()), pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := checkGeneratedPluginIcon(source, pkg); err != nil {
		t.Fatal(err)
	}
}

func generatedIconQualificationFixture(t *testing.T, svg []byte) pluginpkg.Package {
	t.Helper()
	var raster bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	img.SetNRGBA(128, 128, color.NRGBA{R: 40, G: 100, B: 220, A: 255})
	if err := png.Encode(&raster, img); err != nil {
		t.Fatal(err)
	}
	var pkg pluginpkg.Package
	pkg.Manifest.Presentation.Icon = &manifest.PresentationIconSpec{Path: generatedPluginIconRaster}
	pkg.Files = map[string][]byte{generatedPluginIconSource: svg, generatedPluginIconRaster: raster.Bytes()}
	return pkg
}
