package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gopkg.in/yaml.v3"
)

const maxExtensionIconBytes = 64 << 10

// ExtensionIcon is catalog-only presentation. It never enters model context or
// tool identity, and carries self-contained image data rather than host paths.
type ExtensionIcon struct {
	Source string `json:"src"`
	Theme  string `json:"theme,omitempty"`
}

func extensionIconData(data []byte) string {
	if len(data) == 0 || len(data) > maxExtensionIconBytes {
		return ""
	}
	mime := ""
	if config, format, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		if config.Width < 1 || config.Height < 1 || config.Width > 2048 || config.Height > 2048 {
			return ""
		}
		switch format {
		case "png", "jpeg", "gif":
			mime = "image/" + format
		}
	} else if validExtensionSVG(data) {
		mime = "image/svg+xml"
	}
	if mime == "" {
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// SVGs are displayed only in an isolated image document, never inserted into the
// page DOM. Reject active markup and file/network references as an extra boundary.
func validExtensionSVG(data []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	depth, elements := 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return elements > 0 && depth == 0
		}
		if err != nil {
			return false
		}
		switch token := token.(type) {
		case xml.StartElement:
			if depth == 0 && (elements != 0 || token.Name.Local != "svg" || token.Name.Space != "http://www.w3.org/2000/svg") {
				return false
			}
			depth++
			elements++
			if depth > 64 || elements > 4096 || token.Name.Local == "script" || token.Name.Local == "foreignObject" {
				return false
			}
			for _, attr := range token.Attr {
				name := strings.ToLower(attr.Name.Local)
				if strings.HasPrefix(name, "on") || (name == "href" && !strings.HasPrefix(attr.Value, "#")) {
					return false
				}
			}
		case xml.EndElement:
			depth--
		case xml.Directive:
			return false
		case xml.ProcInst:
			if token.Target != "xml" {
				return false
			}
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(token)) != "" {
				return false
			}
		}
	}
}

func extensionIconFromDataURI(source string) string {
	if len(source) > 88_000 {
		return ""
	}
	header, body, found := strings.Cut(source, ",")
	if !found || !strings.HasPrefix(header, "data:image/") || !strings.HasSuffix(header, ";base64") {
		return ""
	}
	data, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return ""
	}
	return extensionIconData(data)
}

func extensionIconByteSize(source string) int {
	_, encoded, _ := strings.Cut(source, ",")
	return base64.StdEncoding.DecodedLen(len(encoded)) - (len(encoded) - len(strings.TrimRight(encoded, "=")))
}

func skillCatalogIcons(skillPath string) []ExtensionIcon {
	if strings.HasPrefix(skillPath, "system:") {
		return nil
	}
	root, err := os.OpenRoot(filepath.Dir(skillPath))
	if err != nil {
		return nil
	}
	defer root.Close()
	read := func(name string, limit int64) []byte {
		if !filepath.IsLocal(name) {
			return nil
		}
		info, err := root.Stat(name)
		if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
			return nil
		}
		file, err := root.Open(name)
		if err != nil {
			return nil
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, limit+1))
		if err != nil || int64(len(data)) > limit {
			return nil
		}
		return data
	}
	var metadata struct {
		Interface struct {
			Small string `yaml:"icon_small"`
			Large string `yaml:"icon_large"`
		} `yaml:"interface"`
	}
	if yaml.Unmarshal(read("agents/openai.yaml", 32<<10), &metadata) != nil {
		return nil
	}
	for _, path := range []string{metadata.Interface.Small, metadata.Interface.Large} {
		if source := extensionIconData(read(path, maxExtensionIconBytes)); source != "" {
			return []ExtensionIcon{{Source: source}}
		}
	}
	return nil
}

// Discovery alone fetches icons, with a separate, credential-free HTTP client.
// HTTP servers may serve same-origin icons; stdio servers may supply data URIs.
// No icon request can redirect or expand the configured server's network scope.
func mcpCatalogIcons(ctx context.Context, input MCPServerInput, icons []mcp.Icon) []ExtensionIcon {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("MCP icon redirects are not allowed")
	}}
	endpoint, _ := url.Parse(input.URL)
	seen := map[string]bool{}
	var result []ExtensionIcon
	remaining := maxExtensionIconBytes
	for index, icon := range icons {
		if index >= 8 || remaining <= 0 {
			break
		}
		theme := string(icon.Theme)
		if seen[theme] || (theme != "" && theme != "light" && theme != "dark") {
			continue
		}
		source := extensionIconFromDataURI(icon.Source)
		if source == "" && input.Transport == "http" && len(icon.Source) <= 8192 {
			location, err := url.Parse(icon.Source)
			if err != nil || endpoint == nil || location.Scheme != endpoint.Scheme || !strings.EqualFold(location.Host, endpoint.Host) || location.User != nil || location.Fragment != "" {
				continue
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, location.String(), nil)
			if err != nil {
				continue
			}
			response, err := client.Do(request)
			if err != nil {
				continue
			}
			data, err := io.ReadAll(io.LimitReader(response.Body, int64(remaining)+1))
			_ = response.Body.Close()
			if err == nil && response.StatusCode == http.StatusOK {
				source = extensionIconData(data)
			}
		}
		size := extensionIconByteSize(source)
		if source != "" && size <= remaining {
			result = append(result, ExtensionIcon{Source: source, Theme: theme})
			seen[theme] = true
			remaining -= size
		}
	}
	return result
}

func validMCPCatalogIcons(icons []ExtensionIcon) bool {
	seen := map[string]bool{}
	size := 0
	for _, icon := range icons {
		if seen[icon.Theme] || (icon.Theme != "" && icon.Theme != "light" && icon.Theme != "dark") || icon.Source == "" || extensionIconFromDataURI(icon.Source) != icon.Source {
			return false
		}
		seen[icon.Theme] = true
		size += extensionIconByteSize(icon.Source)
	}
	return size <= maxExtensionIconBytes
}
