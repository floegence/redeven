package ai

import (
	"encoding/json"
	"errors"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	fltools "github.com/floegence/floret/v7/tools"
)

const maxFlowerArgumentPreviewBytes = 1 << 20

func flowerArgumentPreviewFactory(name string) func() fltools.ArgumentPreviewer {
	switch name {
	case "file.edit", "file.write", "apply_patch":
		return func() fltools.ArgumentPreviewer {
			p := &flowerArgumentPreview{tool: name, fields: map[string]*previewString{}}
			return p.append
		}
	default:
		return nil
	}
}

type previewString struct {
	text     strings.Builder
	lines    int
	last     byte
	complete bool
}

func (s *previewString) append(text string) {
	s.text.WriteString(text)
	s.lines += strings.Count(text, "\n")
	if text != "" {
		s.last = text[len(text)-1]
	}
}
func (s *previewString) count() int {
	if s.text.Len() == 0 {
		return 0
	}
	if s.last == '\n' {
		return s.lines
	}
	return s.lines + 1
}

type previewJSONFrame struct {
	kind  byte
	phase byte
	key   string
	keys  map[string]bool
}

// This parser observes append-only JSON without repairing it or reading files.
// Its grammar stack prevents nested or repeated keys from changing root fields.
type flowerArgumentPreview struct {
	tool          string
	bytes         int
	stack         []previewJSONFrame
	rootDone      bool
	inString      bool
	isKey         bool
	key           strings.Builder
	field         *previewString
	escape        bool
	unicodeDigits string
	highSurrogate rune
	primitive     strings.Builder
	fields        map[string]*previewString
	patch         previewPatchCounter
	editStats     *fltools.ArgumentPreview
}

func (p *flowerArgumentPreview) append(delta string, complete bool) (*fltools.ArgumentPreview, error) {
	p.bytes += len(delta)
	if p.bytes > maxFlowerArgumentPreviewBytes {
		return nil, errors.New("argument preview exceeds size limit")
	}
	for i := 0; i < len(delta); i++ {
		if err := p.byte(delta[i]); err != nil {
			return nil, err
		}
	}
	if complete {
		if p.primitive.Len() > 0 {
			if err := p.endPrimitive(); err != nil {
				return nil, err
			}
		}
		if !p.rootDone || p.inString || len(p.stack) != 0 {
			return nil, errors.New("incomplete argument preview")
		}
	}
	out := &fltools.ArgumentPreview{}
	if field := p.fields["file_path"]; field != nil && field.complete {
		out.DisplayName = filepath.Base(strings.ReplaceAll(field.text.String(), `\`, "/"))
	}
	integer := func(n int) *int { return &n }
	switch p.tool {
	case "file.write":
		if field := p.fields["content"]; field != nil {
			out.Additions = integer(field.count())
		}
	case "file.edit":
		old, new := p.fields["old_string"], p.fields["new_string"]
		if old != nil {
			out.Deletions = integer(old.count())
		}
		if new != nil {
			out.Additions = integer(new.count())
		}
		if old != nil && new != nil && old.complete && new.complete {
			if p.editStats == nil {
				if old.count() > 100_000 || new.count() > 100_000 {
					return nil, errors.New("argument preview line limit")
				}
				adds, dels := 0, 0
				for _, h := range buildMutationDiffHunks(old.text.String(), new.text.String()) {
					adds += h.newCount
					dels += h.oldCount
				}
				p.editStats = &fltools.ArgumentPreview{Additions: integer(adds), Deletions: integer(dels)}
			}
			out.Additions = p.editStats.Additions
			out.Deletions = p.editStats.Deletions
		}
	case "apply_patch":
		if p.fields["input"] != nil {
			if p.patch.invalidUTF8 {
				return nil, errors.New("invalid patch utf8")
			}
			adds, dels := p.patch.count()
			out.Additions = integer(adds)
			out.Deletions = integer(dels)
			out.DisplayName = p.patch.displayName()
		}
	}
	return out, nil
}

func (p *flowerArgumentPreview) byte(b byte) error {
	if p.inString {
		return p.stringByte(b)
	}
	if p.primitive.Len() > 0 {
		if b == ',' || b == '}' || b == ']' || b == ' ' || b == '\n' || b == '\r' || b == '\t' {
			if err := p.endPrimitive(); err != nil {
				return err
			}
		} else {
			p.primitive.WriteByte(b)
			return nil
		}
	}
	if b == ' ' || b == '\n' || b == '\r' || b == '\t' {
		return nil
	}
	if p.rootDone {
		return errors.New("argument preview has trailing data")
	}
	if len(p.stack) == 0 {
		if b != '{' {
			return errors.New("arguments must be an object")
		}
		p.stack = append(p.stack, previewJSONFrame{kind: '{', phase: 'k', keys: map[string]bool{}})
		return nil
	}
	frame := &p.stack[len(p.stack)-1]
	switch frame.phase {
	case 'k', 'K':
		if b == '}' && frame.phase == 'k' {
			return p.closeContainer()
		}
		if b != '"' {
			return errors.New("expected argument key")
		}
		p.inString = true
		p.isKey = true
		p.key.Reset()
		return nil
	case ':':
		if b != ':' {
			return errors.New("expected argument colon")
		}
		frame.phase = 'v'
		return nil
	case ',':
		if b == '}' && frame.kind == '{' || b == ']' && frame.kind == '[' {
			return p.closeContainer()
		}
		if b != ',' {
			return errors.New("expected argument separator")
		}
		if frame.kind == '{' {
			frame.phase = 'K'
		} else {
			frame.phase = 'V'
		}
		return nil
	case 'v', 'V':
		if b == ']' && frame.kind == '[' && frame.phase == 'v' {
			return p.closeContainer()
		}
		if b == '"' {
			p.inString = true
			p.isKey = false
			p.field = nil
			if len(p.stack) == 1 && p.wants(frame.key) {
				p.field = &previewString{}
				p.fields[frame.key] = p.field
			}
			return nil
		}
		if len(p.stack) == 1 && p.wants(frame.key) {
			return errors.New("preview field must be a string")
		}
		if b == '{' || b == '[' {
			if len(p.stack) >= 64 {
				return errors.New("argument preview nesting limit")
			}
			phase := byte('v')
			if b == '{' {
				phase = 'k'
			}
			p.stack = append(p.stack, previewJSONFrame{kind: b, phase: phase, keys: map[string]bool{}})
			return nil
		}
		if b == '-' || b >= '0' && b <= '9' || b == 't' || b == 'f' || b == 'n' {
			p.primitive.WriteByte(b)
			return nil
		}
		return errors.New("invalid argument value")
	}
	return errors.New("invalid argument preview grammar")
}

func (p *flowerArgumentPreview) wants(key string) bool {
	switch key {
	case "file_path":
		return p.tool != "apply_patch"
	case "old_string", "new_string":
		return p.tool == "file.edit"
	case "content":
		return p.tool == "file.write"
	case "input":
		return p.tool == "apply_patch"
	}
	return false
}
func (p *flowerArgumentPreview) closeContainer() error {
	p.stack = p.stack[:len(p.stack)-1]
	if len(p.stack) == 0 {
		p.rootDone = true
	} else {
		p.stack[len(p.stack)-1].phase = ','
	}
	return nil
}
func (p *flowerArgumentPreview) endPrimitive() error {
	var value any
	if json.Unmarshal([]byte(p.primitive.String()), &value) != nil {
		return errors.New("invalid argument primitive")
	}
	p.primitive.Reset()
	p.stack[len(p.stack)-1].phase = ','
	return nil
}
func (p *flowerArgumentPreview) decoded(text string) {
	if p.isKey {
		p.key.WriteString(text)
	} else if p.field != nil {
		if p.tool == "apply_patch" {
			p.patch.append(text)
		} else {
			p.field.append(text)
		}
	}
}
func (p *flowerArgumentPreview) stringByte(b byte) error {
	if p.unicodeDigits != "" {
		if !strings.ContainsRune("0123456789abcdefABCDEF", rune(b)) {
			return errors.New("invalid unicode escape")
		}
		p.unicodeDigits += string(b)
		if len(p.unicodeDigits) < 5 {
			return nil
		}
		v, _ := strconv.ParseUint(p.unicodeDigits[1:], 16, 16)
		p.unicodeDigits = ""
		r := rune(v)
		if p.highSurrogate != 0 {
			if r < 0xdc00 || r > 0xdfff {
				return errors.New("invalid unicode surrogate")
			}
			r = utf16.DecodeRune(p.highSurrogate, r)
			p.highSurrogate = 0
		} else if r >= 0xd800 && r <= 0xdbff {
			p.highSurrogate = r
			return nil
		} else if r >= 0xdc00 && r <= 0xdfff {
			return errors.New("invalid unicode surrogate")
		}
		p.decoded(string(r))
		return nil
	}
	if p.escape {
		p.escape = false
		if p.highSurrogate != 0 && b != 'u' {
			return errors.New("invalid unicode surrogate")
		}
		switch b {
		case 'u':
			p.unicodeDigits = "u"
		case '"', '\\', '/':
			p.decoded(string(b))
		case 'n':
			p.decoded("\n")
		case 'r':
			p.decoded("\r")
		case 't':
			p.decoded("\t")
		case 'b':
			p.decoded("\b")
		case 'f':
			p.decoded("\f")
		default:
			return errors.New("invalid string escape")
		}
		return nil
	}
	if p.highSurrogate != 0 && b != '\\' {
		return errors.New("incomplete unicode surrogate")
	}
	if b == '\\' {
		p.escape = true
		return nil
	}
	if b == '"' {
		p.inString = false
		frame := &p.stack[len(p.stack)-1]
		if p.isKey {
			key := p.key.String()
			if !utf8.ValidString(key) || len(frame.keys) >= 128 {
				return errors.New("invalid or excessive argument keys")
			}
			if frame.keys[key] {
				return errors.New("duplicate argument field")
			}
			frame.keys[key] = true
			frame.key = key
			frame.phase = ':'
		} else {
			if p.field != nil {
				if !utf8.ValidString(p.field.text.String()) || p.tool == "apply_patch" && !utf8.ValidString(p.patch.line.String()) {
					return errors.New("invalid argument utf8")
				}
				p.field.complete = true
			}
			frame.phase = ','
		}
		p.field = nil
		return nil
	}
	if b < 0x20 {
		return errors.New("invalid string control")
	}
	p.decoded(string([]byte{b}))
	return nil
}

type previewPatchCounter struct {
	line                 strings.Builder
	hunk                 bool
	invalidUTF8          bool
	additions, deletions int
	canonical, ended     bool
	moveFrom             string
	files                []previewPatchFile
	moreFiles            bool
}

type previewPatchFile struct {
	path, destination string
}

func (p *previewPatchCounter) append(text string) {
	for _, b := range []byte(text) {
		if b == '\n' {
			p.invalidUTF8 = p.invalidUTF8 || !utf8.ValidString(p.line.String())
			p.consume(strings.TrimSuffix(p.line.String(), "\r"))
			p.line.Reset()
		} else {
			p.line.WriteByte(b)
		}
	}
}
func (p *previewPatchCounter) consume(line string) {
	p.consumeFileHeader(line)
	switch {
	case strings.HasPrefix(line, "*** Add File:"), strings.HasPrefix(line, "*** Update File:"):
		p.hunk = true
	case strings.HasPrefix(line, "*** Move to:"):
		// Moving a file does not leave its update body.
	case strings.HasPrefix(line, "*** "), strings.HasPrefix(line, "diff "):
		p.hunk = false
	case strings.HasPrefix(line, "@@"):
		p.hunk = true
	default:
		if p.hunk && strings.HasPrefix(line, "+") {
			p.additions++
		}
		if p.hunk && strings.HasPrefix(line, "-") {
			p.deletions++
		}
	}
}

// Only complete canonical operation headers describe candidate files. Body
// text, unfinished paths and preview names never become execution authority.
func (p *previewPatchCounter) consumeFileHeader(line string) {
	if p.ended {
		return
	}
	if line == "*** Begin Patch" {
		p.canonical = true
		return
	}
	if !p.canonical {
		return
	}
	if line == "*** End Patch" {
		p.ended = true
		return
	}
	for _, prefix := range []string{"*** Add File: ", "*** Update File: ", "*** Delete File: "} {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		filePath := previewPatchPath(strings.TrimPrefix(line, prefix))
		p.moveFrom = ""
		if filePath == "" {
			return
		}
		if prefix == "*** Update File: " {
			p.moveFrom = filePath
		}
		for _, file := range p.files {
			if file.path == filePath {
				return
			}
		}
		if len(p.files) >= 64 {
			p.moreFiles = true
			return
		}
		p.files = append(p.files, previewPatchFile{path: filePath})
		return
	}
	if p.moveFrom != "" && strings.HasPrefix(line, "*** Move to: ") {
		destination := previewPatchPath(strings.TrimPrefix(line, "*** Move to: "))
		if destination != "" {
			for i := range p.files {
				if p.files[i].path == p.moveFrom {
					p.files[i].destination = destination
					break
				}
			}
		}
	}
	p.moveFrom = ""
}

func previewPatchPath(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	if !utf8.ValidString(value) || strings.ContainsFunc(value, unicode.IsControl) {
		return ""
	}
	value = path.Clean(value)
	if value == "." || value == ".." || strings.HasPrefix(value, "../") || path.IsAbs(value) {
		return ""
	}
	return value
}

func (p *previewPatchCounter) displayName() string {
	// Floret sanitizes display names to 200 runes. Keep the omission explicit
	// before that boundary instead of cutting off a filename without a marker.
	const limit = 196
	var names []string
	length := 0
	for _, file := range p.files {
		name := path.Base(file.path)
		if file.destination != "" {
			name += " → " + path.Base(file.destination)
		}
		size := utf8.RuneCountInString(name)
		if length+size+2 > limit {
			if len(names) == 0 {
				return string([]rune(name)[:min(size, limit)]) + "…"
			}
			return strings.Join(names, ", ") + ", …"
		}
		names = append(names, name)
		length += size + 2
	}
	if p.moreFiles {
		return strings.Join(names, ", ") + ", …"
	}
	return strings.Join(names, ", ")
}

func (p *previewPatchCounter) count() (int, int) {
	copy := previewPatchCounter{hunk: p.hunk, additions: p.additions, deletions: p.deletions}
	if p.line.Len() > 0 {
		copy.consume(strings.TrimSuffix(p.line.String(), "\r"))
	}
	return copy.additions, copy.deletions
}
